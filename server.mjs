// x402 seller agent — PHASE 2 (live on-chain settlement on Aevum testnet).
// One seller, two paid endpoints (/radar, /bounty) behind the same 402
// paywall. First request -> HTTP 402 with the price; buyer signs an
// EIP-3009 transferWithAuthorization, retries with X-PAYMENT; the server
// verifies the EIP-712 signature (real ecrecover, pure JS), then settles
// ON-CHAIN by submitting transferWithAuthorization itself (paying gas)
// and returns the data with X-PAYMENT-RESPONSE carrying the real tx hash.
//
// Modes:
//   AEVUM_LIVE=1 + .deployer.json present -> LIVE settlement on chain 44005.
//   Otherwise -> MOCK settlement (in-memory ledger), exactly as phase 1,
//   so the mock test suite (test.mjs) keeps passing unchanged.
// Written 2026-11-16, inside the Aevum build window. Node stdlib only.
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIG } from "./config.mjs";
import { transferWithAuthorizationDigest } from "./eip712.mjs";
import { ecrecover, publicKeyToAddress, setCryptoRandom, _test } from "./secp256k1.mjs";
setCryptoRandom(crypto);
import {
  getTokenNonce, getAuthorizationState, sendTransaction, waitReceipt,
  encodeTransferWithAuthorization,
} from "./chain.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const REGISTRATION = JSON.parse(readFileSync(join(DIR, "registration.json"), "utf8"));

// --- Settlement mode ---
const LIVE = process.env.AEVUM_LIVE === "1";
let SELLER = CONFIG.seller;
let SELLER_KEY = null;
if (LIVE) {
  // Seller key: SELLER_PRIVATE_KEY env wins (used by tests), otherwise the
  // throwaway deployer key file (.deployer.json, chmod 600, gitignored).
  if (process.env.SELLER_PRIVATE_KEY) {
    SELLER_KEY = process.env.SELLER_PRIVATE_KEY.replace(/^0x/, "");
    const d = BigInt("0x" + SELLER_KEY);
    SELLER = publicKeyToAddress(_test.pointMul(d, _test.G));
  } else {
    const keyFile = join(DIR, ".deployer.json");
    if (!existsSync(keyFile)) throw new Error("AEVUM_LIVE=1 but no SELLER_PRIVATE_KEY and .deployer.json is missing");
    const data = JSON.parse(readFileSync(keyFile, "utf8")).data[0];
    SELLER = data.address;
    SELLER_KEY = data.private_key;
  }
}
const SETTLEMENT = LIVE ? "live" : "mock";
console.log(`aevum-x402-seller phase 2 starting (settlement=${SETTLEMENT}, seller=${SELLER})`);

// --- Live data ---

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const TOTAL_SUPPLY_SEL = "0x18160ddd";
const supplyCache = new Map(); // contract -> {value, at}
const urlCache = new Map(); // url -> {live, at}

async function fetchBscTotalSupply(contract) {
  const cached = supplyCache.get(contract.toLowerCase());
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  try {
    const res = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: contract, data: TOTAL_SUPPLY_SEL }, "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    if (!j.result) throw new Error("no result");
    const value = BigInt(j.result);
    supplyCache.set(contract.toLowerCase(), { value, at: Date.now() });
    return value;
  } catch {
    return cached ? cached.value : null;
  }
}

async function checkUrlLive(url) {
  const cached = urlCache.get(url);
  if (cached && Date.now() - cached.at < 300_000) return cached.live;
  let live = false;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": "aevum-x402-seller/2.0" },
      signal: AbortSignal.timeout(8000),
    });
    live = res.status >= 200 && res.status < 400;
  } catch {
    live = false;
  }
  urlCache.set(url, { live, at: Date.now() });
  return live;
}

// Radar entries: free-quota facts are from the verified ledger (checked
// 2026-11-16); totalSupply is read LIVE from BSC at request time.
const RADAR_DEFS = [
  {
    id: "marsnexus",
    name: "MarsNexus MARSID card",
    chain: "BSC",
    contract: "0xC4059D2F9F6F86695896e68F3E73E1e6cC3791c8",
    freeQuotaLeft: "card 1 of 5 free (first card free per Agent ID)",
    price: "0",
  },
  {
    id: "worldygg",
    name: "Worldygg Tree",
    chain: "BSC",
    contract: "0x2ED9E0a6992BA22B48c2fc2def6bB2365301A0D0",
    freeQuotaLeft: "1st Tree free per wallet (then 0.00201 BNB each, max 9)",
    price: "0",
  },
  {
    id: "agent-ape",
    name: "Agent Ape Club",
    chain: "BSC",
    contract: "0x31da612e74db1751f0B474b4607493B4fa4d9bd5",
    freeQuotaLeft: "free mint CLOSED (paid mint 0.002 BNB)",
    price: "0.002 BNB (paid mint)",
  },
];

// Phase-1 sample entries, kept for mock mode so test.mjs stays green.
const RADAR_SAMPLE = RADAR_DEFS.map((d) => ({
  ...d,
  freeQuotaLeft: d.id === "marsnexus" ? "card 1 free (used)"
    : d.id === "worldygg" ? "1st Tree free (used)" : "free mint CLOSED",
  note: "Sample entry — live quota check is phase 2.",
  sample: true,
}));

async function liveRadar() {
  const checkedAt = new Date().toISOString();
  const mints = [];
  for (const d of RADAR_DEFS) {
    const supply = await fetchBscTotalSupply(d.contract);
    mints.push({
      ...d,
      totalSupply: supply === null ? null : Number(supply),
      live: supply !== null,
      checkedAt,
      sample: false,
    });
  }
  return mints;
}

const BOUNTY_DEFS = [
  {
    id: "snowbridge",
    program: "Snowbridge",
    platform: "HackenProof",
    maxBounty: "$30,000–$75,000 (Critical, verified 2026-11-14)",
    scope: "Ethereum contracts + BridgeHub pallets (Solidity + Rust)",
    url: "https://hackenproof.com/programs/snowbridge",
  },
  {
    id: "immunefi",
    program: "Immunefi — bug bounty platform",
    platform: "Immunefi",
    maxBounty: "varies by program (top programs $100,000+)",
    scope: "Smart contracts, web2 + web3 programs",
    url: "https://immunefi.com/bug-bounty/",
  },
  {
    id: "sherlock",
    program: "Sherlock — audit contests",
    platform: "Sherlock",
    maxBounty: "varies by contest",
    scope: "Audit contests (Solidity)",
    url: "https://audits.sherlock.xyz/",
  },
  {
    id: "cantina",
    program: "Cantina — audit competitions",
    platform: "Cantina",
    maxBounty: "varies by competition",
    scope: "Audit competitions (Solidity)",
    url: "https://cantina.xyz/",
  },
  {
    id: "hackerone",
    program: "HackerOne — bug bounty platform",
    platform: "HackerOne",
    maxBounty: "varies by program",
    scope: "Web2 + web3 programs",
    url: "https://hackerone.com/bug-bounty-programs",
  },
];

const BOUNTY_SAMPLE = [
  {
    id: "sample-immunefi",
    program: "Immunefi — example program",
    platform: "Immunefi",
    maxBounty: "$100,000",
    scope: "Smart contracts (sample)",
    url: "https://immunefi.com/",
    note: "Sample entry — live ranked scan is phase 2.",
    sample: true,
  },
  {
    id: "sample-hackenproof",
    program: "HackenProof — example program",
    platform: "HackenProof",
    maxBounty: "$50,000",
    scope: "Smart contracts (sample)",
    url: "https://hackenproof.com/",
    note: "Sample entry — live ranked scan is phase 2.",
    sample: true,
  },
  {
    id: "sample-sherlock",
    program: "Sherlock — example contest",
    platform: "Sherlock",
    maxBounty: "$25,000",
    scope: "Audit contest (sample)",
    url: "https://audits.sherlock.xyz/",
    note: "Sample entry — live ranked scan is phase 2.",
    sample: true,
  },
];

async function liveBounty() {
  const checkedAt = new Date().toISOString();
  const programs = [];
  for (const d of BOUNTY_DEFS) {
    programs.push({ ...d, live: await checkUrlLive(d.url), checkedAt, sample: false });
  }
  return programs;
}

// --- Payment verification + settlement ---

const usedNonces = new Set(); // "from:nonce"
const payments = []; // {from, to, value, nonce, endpoint, txHash, at}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function b64urlDecode(str) {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(body);
}

function paywall402(res, reason = null) {
  sendJson(res, 402, {
    x402Version: 1,
    error: "Payment required — sign an EIP-3009 transferWithAuthorization and retry with X-PAYMENT." +
      (reason ? " (" + reason + ")" : ""),
    // Dual-token (phase 3): the buyer picks either accepted stablecoin.
    // Both are 6-decimal, $0.01 per call, same EIP-3009 scheme — only the
    // token address, EIP-712 domain (name/version) and nonce semantics differ.
    accepts: Object.values(CONFIG.tokens).map((t) => ({
      scheme: "eip3009",
      network: CONFIG.network,
      amount: String(CONFIG.price),
      asset: t.address,
      payTo: SELLER,
      maxTimeoutSeconds: CONFIG.authTtlSeconds,
      extra: {
        name: t.name,
        version: t.version,
        decimals: t.decimals,
        symbol: t.symbol,
        priceDisplay: CONFIG.priceDisplay,
        settlement: SETTLEMENT,
        nonceMode: t.nonceMode,
        note: LIVE
          ? "Live settlement: the server submits transferWithAuthorization on Aevum testnet and returns the real tx hash."
          : "Mock settlement: signature is verified for real, settlement is a mock ledger (no on-chain transfer). Set AEVUM_LIVE=1 with .deployer.json for live settlement.",
      },
    })),
  });
}

function verifyPayment(header) {
  // Returns {ok:true, payload} or {ok:false, reason}.
  if (!header) return { ok: false, reason: "missing X-PAYMENT header" };
  let decoded;
  try {
    decoded = b64urlDecode(header);
  } catch {
    return { ok: false, reason: "X-PAYMENT is not valid base64url JSON" };
  }
  if (decoded.x402Version !== 1) return { ok: false, reason: "unsupported x402Version" };
  if (decoded.scheme !== "eip3009") return { ok: false, reason: "unsupported scheme" };
  if (decoded.network !== CONFIG.network) return { ok: false, reason: "wrong network" };
  // Dual-token (phase 3): the buyer names the asset in X-PAYMENT
  // (top-level `asset`: token address or symbol). Absent -> aUSD, the
  // phase-2 default, so existing buyers keep working unchanged.
  const token = CONFIG.tokenFor(decoded.asset);
  if (!token) return { ok: false, reason: "unsupported asset " + String(decoded.asset) };
  const p = decoded.payload || {};
  const need = ["from", "to", "value", "validAfter", "validBefore", "nonce", "signature"];
  for (const k of need) if (p[k] === undefined) return { ok: false, reason: "payload missing " + k };
  if (String(p.to).toLowerCase() !== SELLER.toLowerCase()) {
    return { ok: false, reason: "payTo is not the seller" };
  }
  if (Number(p.value) !== CONFIG.price) {
    return { ok: false, reason: "amount is not the listed price" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(p.validAfter) > now) return { ok: false, reason: "authorization not yet valid" };
  if (Number(p.validBefore) <= now) return { ok: false, reason: "authorization expired" };
  const nonceKey = token.address.toLowerCase() + ":" + String(p.from).toLowerCase() + ":" + String(p.nonce).toLowerCase();
  if (usedNonces.has(nonceKey)) return { ok: false, reason: "nonce already used (replay)" };
  const sig = Buffer.from(String(p.signature).replace(/^0x/, ""), "hex");
  if (sig.length !== 65) return { ok: false, reason: "signature must be 65 bytes" };
  const domain = {
    name: token.name,
    version: token.version,
    chainId: CONFIG.chainId,
    verifyingContract: token.address,
  };
  let digest;
  try {
    digest = transferWithAuthorizationDigest(domain, {
      from: p.from,
      to: p.to,
      value: Number(p.value),
      validAfter: Number(p.validAfter),
      validBefore: Number(p.validBefore),
      nonce: p.nonce,
    });
  } catch (e) {
    return { ok: false, reason: "bad authorization fields: " + e.message };
  }
  const recovered = ecrecover(digest, sig);
  if (!recovered || recovered.toLowerCase() !== String(p.from).toLowerCase()) {
    if (process.env.X402_DEBUG) {
      console.error("[x402-debug] sig mismatch: domain=", JSON.stringify(domain),
        "auth=", JSON.stringify({ from: p.from, to: p.to, value: p.value, validAfter: p.validAfter, validBefore: p.validBefore, nonce: p.nonce }),
        "digest=0x" + digest.toString("hex"), "recovered=", recovered, "from=", p.from);
    }
    return { ok: false, reason: "signature does not match from address" };
  }
  return { ok: true, payload: p, nonceKey, signature: sig, token };
}

async function settleLive(payload, signature, token) {
  // Pre-flight, per token nonce model — otherwise the call would revert
  // and waste gas:
  //  - aUSD (sequential): the on-chain sequential nonce must equal the
  //    auth nonce.
  //  - tUSD8 (authorizationState): the auth nonce must not be spent yet.
  if (token.nonceMode === "authorizationState") {
    const spent = await getAuthorizationState(token.address, payload.from, payload.nonce);
    if (spent) throw new Error("authorization already used (tUSD8 nonce spent)");
  } else {
    const onChainNonce = await getTokenNonce(token.address, payload.from);
    if (onChainNonce !== BigInt(payload.nonce)) {
      throw new Error("on-chain nonce mismatch (already used or stale)");
    }
  }
  const v = signature[64];
  const r = "0x" + signature.subarray(0, 32).toString("hex");
  const s = "0x" + signature.subarray(32, 64).toString("hex");
  const data = "0x" + encodeTransferWithAuthorization(
    {
      from: payload.from, to: payload.to, value: Number(payload.value),
      validAfter: Number(payload.validAfter), validBefore: Number(payload.validBefore),
      nonce: payload.nonce,
    },
    v, r, s
  );
  const { txHash } = await sendTransaction({
    from: SELLER, to: token.address, data, value: 0n, privateKey: SELLER_KEY,
  });
  const receipt = await waitReceipt(txHash);
  if (receipt.status !== "0x1") throw new Error("on-chain settlement reverted: " + txHash);
  return txHash;
}

async function paidEndpoint(req, res, dataFn) {
  const check = verifyPayment(req.headers["x-payment"]);
  if (!check.ok) {
    paywall402(res, check.reason);
    return;
  }
  const { payload, nonceKey, signature, token } = check;
  let txHash = null;
  if (LIVE) {
    try {
      txHash = await settleLive(payload, signature, token);
    } catch (e) {
      // Do NOT mark the nonce used: a failed settlement (e.g. buyer
      // underfunded) leaves the authorization unspent on-chain.
      paywall402(res, "settlement failed: " + e.message);
      return;
    }
  }
  usedNonces.add(nonceKey);
  payments.push({
    from: payload.from,
    to: payload.to,
    value: payload.value,
    asset: token.address,
    assetSymbol: token.symbol,
    nonce: payload.nonce,
    endpoint: req.url,
    txHash,
    at: new Date().toISOString(),
  });
  const data = await dataFn();
  const response = {
    success: true,
    payer: payload.from,
    amount: String(payload.value),
    asset: token.address,
    assetSymbol: token.symbol,
    network: CONFIG.network,
    settlement: SETTLEMENT,
    txHash,
    explorerTxUrl: txHash ? CONFIG.explorer + "/tx/" + txHash : null,
    note: LIVE
      ? `Settled on-chain via transferWithAuthorization (${token.symbol}) on Aevum testnet.`
      : "Mock settlement — no on-chain transfer. Set AEVUM_LIVE=1 for live settlement.",
  };
  sendJson(res, 200, data, { "x-payment-response": b64urlEncode(response) });
}

const server = http.createServer((req, res) => {
  (async () => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "aevum-x402-seller",
        phase: 2,
        chain: CONFIG.network,
        token: CONFIG.token,
        acceptedTokens: Object.values(CONFIG.tokens),
        price: CONFIG.price,
        priceDisplay: CONFIG.priceDisplay,
        seller: SELLER,
        settlement: SETTLEMENT,
        agentId: REGISTRATION.registrations?.[0]?.agentId ?? null,
        paymentsSettled: payments.length,
        uptimeSeconds: Math.floor(process.uptime()),
      });
      return;
    }
    if (req.method === "GET" && (url.pathname === "/registration.json" || url.pathname === "/.well-known/agent-registration.json")) {
      sendJson(res, 200, REGISTRATION);
      return;
    }
    if (req.method === "GET" && url.pathname === "/radar") {
      await paidEndpoint(req, res, async () => ({
        endpoint: "radar",
        generatedAt: new Date().toISOString(),
        settlement: SETTLEMENT,
        mints: LIVE ? await liveRadar() : RADAR_SAMPLE,
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/bounty") {
      await paidEndpoint(req, res, async () => ({
        endpoint: "bounty",
        generatedAt: new Date().toISOString(),
        settlement: SETTLEMENT,
        programs: LIVE ? await liveBounty() : BOUNTY_SAMPLE,
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        "<h1>Aevum x402 seller agent (phase 2)</h1>" +
          "<p>Two paid endpoints behind one x402 paywall: <a href=\"/radar\">/radar</a> (free-mint radar) and <a href=\"/bounty\">/bounty</a> (bug-bounty radar). Price " +
          CONFIG.priceDisplay + " in " + Object.values(CONFIG.tokens).map((t) => t.symbol).join(" or ") + " on Aevum testnet (chain " + CONFIG.chainId + "). Settlement: " + SETTLEMENT + ".</p>" +
          "<p>First request returns HTTP 402. Sign the EIP-3009 authorization and retry with X-PAYMENT. See <a href=\"/registration.json\">/registration.json</a> (ERC-8004 registration file) and /health.</p>"
      );
      return;
    }
    sendJson(res, 404, { error: "not found" });
  })().catch((e) => {
    console.error("request error:", e);
    try { sendJson(res, 500, { error: "internal error: " + e.message }); } catch { /* socket gone */ }
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(
    "aevum-x402-seller phase 2 listening on http://" + CONFIG.host + ":" + CONFIG.port +
    " (chain " + CONFIG.network + ", price " + CONFIG.priceDisplay + ", settlement " + SETTLEMENT + ")"
  );
});
