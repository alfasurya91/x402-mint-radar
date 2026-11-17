// Pure-JS Ethereum JSON-RPC client + EIP-1559 transaction signing.
// Written 2026-11-16 for the Aevum/QDay Builder Challenge (phase 2).
// Node stdlib only. Used by server.mjs to settle EIP-3009 authorizations
// on Aevum testnet (chain 44005) — the server verifies the buyer's
// signature, then submits transferWithAuthorization itself and pays gas.
// Testnet only. The seller key is loaded from .deployer.json (chmod 600,
// gitignored); without it the server stays in mock mode.
import { keccak256 } from "./keccak.mjs";
import { signDigest } from "./secp256k1.mjs";
import { CONFIG } from "./config.mjs";

const RPC = CONFIG.rpc;

// --- minimal RLP ---

function rlpEncode(input) {
  // input: Buffer | Array
  if (Buffer.isBuffer(input)) return rlpEncodeBytes(input);
  if (Array.isArray(input)) {
    const parts = input.map(rlpEncode);
    const payload = Buffer.concat(parts);
    return Buffer.concat([rlpLengthPrefix(payload.length, 0xc0), payload]);
  }
  throw new Error("rlpEncode: unsupported input");
}

function rlpEncodeBytes(buf) {
  if (buf.length === 1 && buf[0] < 0x80) return buf;
  return Buffer.concat([rlpLengthPrefix(buf.length, 0x80), buf]);
}

function rlpLengthPrefix(len, offset) {
  if (len < 56) return Buffer.from([offset + len]);
  const lenBytes = bigIntToBytes(BigInt(len));
  return Buffer.from([offset + 55 + lenBytes.length, ...lenBytes]);
}

function bigIntToBytes(n) {
  if (n === 0n) return Buffer.alloc(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}

function intToRlp(n) {
  return bigIntToBytes(BigInt(n));
}

function hexToBuf(hex) {
  const h = String(hex).replace(/^0x/, "");
  // Buffer.from(x, "hex") silently returns an empty/short buffer on invalid
  // hex (e.g. a doubled "0x" prefix) — fail loudly instead of sending a tx
  // with empty calldata. (This exact silent truncation caused a reverted
  // settlement on anvil 2026-11-16.)
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("hexToBuf: invalid hex: " + String(hex).slice(0, 40));
  return h === "" ? Buffer.alloc(0) : Buffer.from(h, "hex");
}

function addrToBuf(addr) {
  const raw = Buffer.from(String(addr).replace(/^0x/, ""), "hex");
  if (raw.length !== 20) throw new Error("bad address: " + addr);
  return raw;
}

// --- JSON-RPC ---

export async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(method + " failed: " + JSON.stringify(j.error));
  return j.result;
}

export async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

export async function getNonce(address) {
  return Number(await rpc("eth_getTransactionCount", [address, "pending"]));
}

export async function getBalance(address) {
  return BigInt(await rpc("eth_getBalance", [address, "latest"]));
}

// --- token helpers (EIP-3009) ---

const DOMAIN_SEPARATOR_SEL = "0x3644e515";
const NONCES_SEL = "0x7ecebe00";
const BALANCE_OF_SEL = "0x70a08231";

export async function getDomainSeparator(token) {
  return ethCall(token, DOMAIN_SEPARATOR_SEL);
}

export async function getTokenNonce(token, owner) {
  const data = NONCES_SEL + owner.replace(/^0x/, "").padStart(64, "0");
  const out = await ethCall(token, data);
  return BigInt(out);
}

export async function getTokenBalance(token, owner) {
  const data = BALANCE_OF_SEL + owner.replace(/^0x/, "").padStart(64, "0");
  return BigInt(await ethCall(token, data));
}

// --- EIP-3009 (FiatTokenV2 / USDC-style) authorization state ---
// tUSD8 nonces are arbitrary bytes32, each usable once; the contract
// tracks them in authorizationState(authorizer, nonce) -> bool.
// Selector 0xe94a0102 = authorizationState(address,bytes32).
const AUTHORIZATION_STATE_SEL = "0xe94a0102";

export async function getAuthorizationState(token, owner, nonce) {
  const data =
    AUTHORIZATION_STATE_SEL +
    owner.replace(/^0x/, "").padStart(64, "0") +
    String(nonce).replace(/^0x/, "").padStart(64, "0");
  const out = await ethCall(token, data);
  return out !== "0x" && BigInt(out) !== 0n;
}

// --- ABI encoding for transferWithAuthorization ---

const TRANSFER_WITH_AUTH_SEL = "e3ee160e"; // no 0x — encodeTransferWithAuthorization returns raw hex; callers prepend "0x"

function abiUint256(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}

function abiAddress(a) {
  return String(a).replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function abiBytes32(h) {
  return String(h).replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

export function encodeTransferWithAuthorization(auth, v, r, s) {
  // transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  return (
    TRANSFER_WITH_AUTH_SEL +
    abiAddress(auth.from) +
    abiAddress(auth.to) +
    abiUint256(auth.value) +
    abiUint256(auth.validAfter) +
    abiUint256(auth.validBefore) +
    abiBytes32(auth.nonce) +
    Number(v).toString(16).padStart(64, "0") +
    abiBytes32(r) +
    abiBytes32(s)
  );
}

// --- EIP-1559 transaction signing + broadcast ---

export async function sendTransaction({ from, to, data, value = 0n, privateKey, gasLimit = null }) {
  const priv = Buffer.from(String(privateKey).replace(/^0x/, ""), "hex");
  const nonce = await getNonce(from);
  let maxPriorityFeePerGas;
  try {
    maxPriorityFeePerGas = BigInt(await rpc("eth_maxPriorityFeePerGas", []));
  } catch {
    maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei fallback
  }
  const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(latest.baseFeePerGas || "0x0");
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

  let gas = gasLimit;
  if (gas === null) {
    try {
      const est = await rpc("eth_estimateGas", [{
        from, to, data, value: "0x" + BigInt(value).toString(16),
      }]);
      gas = (BigInt(est) * 120n) / 100n; // +20% buffer
    } catch {
      gas = 500_000n;
    }
  }

  const txFields = [
    intToRlp(CONFIG.chainId),
    intToRlp(nonce),
    intToRlp(maxPriorityFeePerGas),
    intToRlp(maxFeePerGas),
    intToRlp(gas),
    addrToBuf(to),
    intToRlp(value),
    hexToBuf(data),
    [], // accessList
  ];
  const signingPayload = Buffer.concat([Buffer.from([0x02]), rlpEncode(txFields)]);
  const digest = keccak256(signingPayload);
  const sig = signDigest(digest, priv);
  const r = sig.subarray(0, 32);
  const s = sig.subarray(32, 64);
  const yParity = sig[64] - 27; // v is 27/28
  const rawTx = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([...txFields, intToRlp(yParity), r, s]),
  ]);
  const txHash = await rpc("eth_sendRawTransaction", ["0x" + rawTx.toString("hex")]);
  return { txHash, nonce, maxFeePerGas, gas };
}

export async function waitReceipt(txHash, timeoutMs = 90000) {
  const start = Date.now();
  for (;;) {
    const rc = await rpc("eth_getTransactionReceipt", [txHash]);
    if (rc) return rc;
    if (Date.now() - start > timeoutMs) throw new Error("receipt timeout for " + txHash);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
