// Mock test suite for the Aevum x402 seller — PHASE 1.
// Spawns server.mjs on a test port, runs the 402 handshake cases against
// the mock settlement ledger, prints PASS/FAIL counts, exits non-zero on
// any failure. No chain calls, no keys persisted.
// Written 2026-11-16, inside the Aevum build window. Node stdlib only.
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { CONFIG } from "./config.mjs";
import { transferWithAuthorizationDigest } from "./eip712.mjs";
import { signDigest, setCryptoRandom, publicKeyToAddress, _test } from "./secp256k1.mjs";

setCryptoRandom(crypto);

const TEST_PORT = 18787;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

const priv = crypto.randomBytes(32);
const d = BigInt("0x" + priv.toString("hex"));
const address = publicKeyToAddress(_test.pointMul(d, _test.G));

function buildPayment(overrides = {}, token = CONFIG.token, includeAsset = true) {
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: address,
    to: CONFIG.seller,
    value: CONFIG.price,
    validAfter: 0,
    validBefore: now + CONFIG.authTtlSeconds,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
    ...overrides,
  };
  const domain = {
    name: token.name,
    version: token.version,
    chainId: CONFIG.chainId,
    verifyingContract: token.address,
  };
  const digest = transferWithAuthorizationDigest(domain, auth);
  const sig = signDigest(digest, priv);
  const payment = {
    x402Version: 1,
    scheme: "eip3009",
    network: CONFIG.network,
    payload: { ...auth, signature: "0x" + sig.toString("hex") },
  };
  if (includeAsset) payment.asset = token.address;
  return payment;
}

function header(payment) {
  return Buffer.from(JSON.stringify(payment)).toString("base64url");
}

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
}

async function waitHealth(server) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await get("/health");
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const server = spawn("node", ["server.mjs"], {
  cwd: new URL(".", import.meta.url).pathname,
  env: { ...process.env, PORT: String(TEST_PORT) },
  stdio: "ignore",
});

try {
  if (!(await waitHealth(server))) {
    console.log("FAIL server did not come up on port " + TEST_PORT);
    process.exit(1);
  }

  const health = await get("/health");
  check("health 200 + fields", health.status === 200 && health.body.ok === true &&
    health.body.chain === CONFIG.network && health.body.settlement === "mock",
    JSON.stringify(health.body).slice(0, 120));

  const radar402 = await get("/radar");
  check("GET /radar without payment -> 402", radar402.status === 402);
  check("402 offer is eip3009/$0.01/seller",
    radar402.body.accepts && radar402.body.accepts[0].scheme === "eip3009" &&
    radar402.body.accepts[0].network === CONFIG.network &&
    radar402.body.accepts[0].amount === String(CONFIG.price) &&
    radar402.body.accepts[0].payTo === CONFIG.seller);
  check("402 offers BOTH tokens (aUSD + tUSD8)",
    Array.isArray(radar402.body.accepts) && radar402.body.accepts.length === 2 &&
    radar402.body.accepts.some((o) => o.asset.toLowerCase() === CONFIG.tokens.tusd8.address.toLowerCase()) &&
    radar402.body.accepts.some((o) => o.asset.toLowerCase() === CONFIG.token.address.toLowerCase()));

  const bounty402 = await get("/bounty");
  check("GET /bounty without payment -> 402", bounty402.status === 402);

  const garbage = await get("/radar", { "x-payment": "not-base64!!!" });
  check("garbage X-PAYMENT -> 402", garbage.status === 402);

  const good = buildPayment();
  const paid = await get("/radar", { "x-payment": header(good) });
  check("valid payment /radar -> 200", paid.status === 200);
  check("/radar returns 3 sample mints",
    paid.status === 200 && Array.isArray(paid.body.mints) && paid.body.mints.length === 3);
  const respHeader = paid.headers.get("x-payment-response");
  const resp = respHeader ? JSON.parse(Buffer.from(respHeader, "base64url").toString("utf8")) : null;
  check("X-PAYMENT-RESPONSE success + mock settlement",
    resp && resp.success === true && resp.settlement === "mock" && resp.txHash === null &&
    resp.payer.toLowerCase() === address.toLowerCase());

  const replay = await get("/radar", { "x-payment": header(good) });
  check("replay of same payment -> 402", replay.status === 402);

  const wrongAmount = await get("/radar", { "x-payment": header(buildPayment({ value: CONFIG.price + 1 })) });
  check("wrong amount -> 402", wrongAmount.status === 402);

  const expired = await get("/radar", {
    "x-payment": header(buildPayment({ validBefore: Math.floor(Date.now() / 1000) - 10 })),
  });
  check("expired authorization -> 402", expired.status === 402);

  const wrongTo = await get("/radar", {
    "x-payment": header(buildPayment({ to: "0x2222222222222222222222222222222222222222" })),
  });
  check("wrong recipient -> 402", wrongTo.status === 402);

  const bountyPaid = await get("/bounty", { "x-payment": header(buildPayment()) });
  check("valid payment /bounty -> 200 + 3 programs",
    bountyPaid.status === 200 && Array.isArray(bountyPaid.body.programs) && bountyPaid.body.programs.length === 3);

  // Phase 3 — dual-token (mock settlement: signature verification only).
  const tusd8Paid = await get("/radar", {
    "x-payment": header(buildPayment({}, CONFIG.tokens.tusd8)),
  });
  check("tUSD8 payment /radar -> 200 (mock)", tusd8Paid.status === 200);
  const tusd8RespHeader = tusd8Paid.headers.get("x-payment-response");
  const tusd8Resp = tusd8RespHeader ? JSON.parse(Buffer.from(tusd8RespHeader, "base64url").toString("utf8")) : null;
  check("tUSD8 response names tUSD8 asset",
    tusd8Resp && tusd8Resp.assetSymbol === "tUSD8" &&
    tusd8Resp.asset.toLowerCase() === CONFIG.tokens.tusd8.address.toLowerCase());

  const unknownAssetPay = buildPayment({}, CONFIG.tokens.tusd8);
  unknownAssetPay.asset = "0x0000000000000000000000000000000000000001";
  const unknownAsset = await get("/radar", { "x-payment": header(unknownAssetPay) });
  check("unknown asset -> 402", unknownAsset.status === 402);

  const legacyNoAsset = await get("/bounty", { "x-payment": header(buildPayment({}, CONFIG.token, false)) });
  check("aUSD payment without asset field -> 200 (backward compat)", legacyNoAsset.status === 200);

  const reg = await get("/registration.json");
  check("/registration.json 200 + name", reg.status === 200 && reg.body.name === "Mint Radar");

  const root = await get("/");
  check("GET / -> 200", root.status === 200);
} finally {
  server.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} mock tests pass`);
process.exit(passed === results.length ? 0 : 1);
