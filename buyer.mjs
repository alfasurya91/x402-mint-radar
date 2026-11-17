// Demo buyer agent for the Aevum x402 seller — PHASE 1 (mock settlement).
// Full loop: GET endpoint -> 402 -> build EIP-3009 authorization -> sign
// the EIP-712 digest -> retry with X-PAYMENT -> 200 + X-PAYMENT-RESPONSE.
// Generates a FRESH throwaway secp256k1 keypair every run (never persisted,
// never the user's wallet). --key <hex> reuses a key (used by test.mjs).
// Written 2026-11-16, inside the Aevum build window. Node stdlib only.
import crypto from "node:crypto";
import { CONFIG } from "./config.mjs";
import { transferWithAuthorizationDigest } from "./eip712.mjs";
import { signDigest, setCryptoRandom, publicKeyToAddress, _test } from "./secp256k1.mjs";

setCryptoRandom(crypto);

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const endpoint = flag("--endpoint", "radar");
const port = flag("--port", String(CONFIG.port));
const host = flag("--host", CONFIG.host);
// --token <ausd|tusd8|address>: which accepted stablecoin to pay with.
// Default ausd. tUSD8 uses a random EIP-3009 nonce (FiatTokenV2
// authorizationState); aUSD uses the on-chain sequential nonce.
const tokenSel = flag("--token", "ausd");
const base = `http://${host}:${port}`;

const keyHex = flag("--key", null);
const priv = keyHex ? Buffer.from(keyHex.replace(/^0x/, ""), "hex") : crypto.randomBytes(32);
const d = BigInt("0x" + priv.toString("hex"));
const pub = _test.pointMul(d, _test.G);
const address = publicKeyToAddress(pub);

console.log("buyer:", address, "(fresh throwaway key" + (keyHex ? ", reused via --key" : "") + ")");

async function get(path, headers = {}) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

const first = await get("/" + endpoint);
console.log("GET /" + endpoint + " ->", first.status);
if (first.status !== 402) {
  console.error("expected 402 without payment, got", first.status);
  process.exit(1);
}
const offers = first.body.accepts || [];
// Pick the offer for the requested token (by symbol or address);
// fall back to the first offer when the flag names nothing offered.
const offer = offers.find((o) =>
  (o.extra && o.extra.symbol && o.extra.symbol.toLowerCase() === tokenSel.toLowerCase()) ||
  (o.asset && o.asset.toLowerCase() === tokenSel.toLowerCase())
) || offers[0];
if (!offer || offer.scheme !== "eip3009" || offer.network !== CONFIG.network) {
  console.error("402 body has no usable eip3009 offer for token", tokenSel + ":", JSON.stringify(first.body));
  process.exit(1);
}
console.log("402 offer:", offer.amount, (offer.extra && offer.extra.symbol) || offer.asset, "->", offer.payTo);

const now = Math.floor(Date.now() / 1000);

// EIP-3009 nonces: aUSD (TestUSD) uses a sequential on-chain nonce,
// read from the token contract; tUSD8 (FiatTokenV2) uses an arbitrary
// bytes32 nonce tracked in authorizationState — a random one per payment.
const nonceMode = (offer.extra && offer.extra.nonceMode) || "sequential";
async function nextNonce() {
  if (nonceMode === "authorizationState") {
    return "0x" + crypto.randomBytes(32).toString("hex");
  }
  try {
    const data = "0x7ecebe00" + address.replace(/^0x/, "").padStart(64, "0");
    const res = await fetch(CONFIG.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: offer.asset, data }, "latest"],
      }),
    });
    const j = await res.json();
    if (j.result) return "0x" + j.result.slice(2).padStart(64, "0");
  } catch { /* fall through to random nonce */ }
  return "0x" + crypto.randomBytes(32).toString("hex");
}

const auth = {
  from: address,
  to: offer.payTo,
  value: Number(offer.amount),
  validAfter: 0,
  validBefore: now + CONFIG.authTtlSeconds,
  nonce: await nextNonce(),
};
// EIP-712 domain comes from the chosen offer (name/version/asset),
// so the buyer signs for exactly the token it is paying with.
const domain = {
  name: (offer.extra && offer.extra.name) || CONFIG.token.name,
  version: (offer.extra && offer.extra.version) || CONFIG.token.version,
  chainId: CONFIG.chainId,
  verifyingContract: offer.asset,
};
const digest = transferWithAuthorizationDigest(domain, auth);
const sig = signDigest(digest, priv);
const payment = {
  x402Version: 1,
  scheme: "eip3009",
  network: CONFIG.network,
  asset: offer.asset,
  payload: { ...auth, signature: "0x" + sig.toString("hex") },
};
const second = await get("/" + endpoint, {
  "x-payment": Buffer.from(JSON.stringify(payment)).toString("base64url"),
});
console.log("GET /" + endpoint + " + X-PAYMENT ->", second.status);
if (second.status !== 200) {
  console.error("expected 200 after payment, got", second.status, JSON.stringify(second.body));
  process.exit(1);
}
const respHeader = second.headers.get("x-payment-response");
const respObj = respHeader ? JSON.parse(Buffer.from(respHeader, "base64url").toString("utf8")) : null;
console.log("X-PAYMENT-RESPONSE:", JSON.stringify(respObj));
console.log("DATA:", JSON.stringify(second.body, null, 2));
