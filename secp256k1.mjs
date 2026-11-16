// secp256k1 ECDSA public-key recovery (ecrecover) in pure JS, BigInt-based.
// Written 2026-11-16, inside the Aevum build window. No dependencies.
import { keccak256 } from "./keccak.mjs";

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m = P) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modInv(a, m) {
  // Extended Euclid; m is prime here.
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}

function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  let m;
  if (x1 === x2 && y1 === y2) {
    if (y1 === 0n) return null;
    m = mod((3n * x1 * x1) * modInv(2n * y1, P), P);
  } else {
    if (x1 === x2) return null;
    m = mod((y2 - y1) * modInv(x2 - x1, P), P);
  }
  const x3 = mod(m * m - x1 - x2, P);
  const y3 = mod(m * (x1 - x3) - y1, P);
  return [x3, y3];
}

function pointMul(k, point) {
  let out = null;
  let add = point;
  let n = k;
  while (n > 0n) {
    if (n & 1n) out = pointAdd(out, add);
    add = pointAdd(add, add);
    n >>= 1n;
  }
  return out;
}

function liftX(x, odd) {
  const y2 = mod(x * x * x + 7n, P);
  // p % 4 == 3, so sqrt = y2^((p+1)/4).
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== y2) return null;
  if ((y & 1n) === (odd ? 1n : 0n)) return [x, y];
  return [x, mod(-y, P)];
}

function modPow(base, exp, m) {
  let out = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) out = mod(out * b, m);
    b = mod(b * b, m);
    e >>= 1n;
  }
  return out;
}

// Sign a 32-byte digest with a 32-byte secp256k1 private key (pure JS).
// Returns a 65-byte (r||s||v) signature, low-s normalized, v in {27, 28}.
// Demo/testnet use only: k comes from crypto.randomBytes; a production
// wallet must use RFC 6979 deterministic k. Never reuse k across digests.
export function signDigest(digest, privateKeyBytes) {
  if (!_crypto) throw new Error("signDigest needs crypto: call setCryptoRandom() first");
  const d = BigInt("0x" + Buffer.from(privateKeyBytes).toString("hex"));
  if (d <= 0n || d >= N) throw new Error("private key out of range");
  const z = BigInt("0x" + Buffer.from(digest).toString("hex"));
  for (;;) {
    const kBytes = _crypto.randomBytes(32);
    const k = (BigInt("0x" + kBytes.toString("hex")) % (N - 1n)) + 1n;
    const R = pointMul(k, [Gx, Gy]);
    const r = mod(R[0], N);
    if (r === 0n) continue;
    let s = mod(modInv(k, N) * mod(z + r * d, N), N);
    if (s === 0n) continue;
    // Low-s normalization (EIP-2 style): flip s and the recovery bit if s > n/2.
    let v = 27 + Number(R[1] & 1n);
    if (s > N / 2n) {
      s = N - s;
      v = v === 27 ? 28 : 27;
    }
    const sig = Buffer.alloc(65);
    Buffer.from(r.toString(16).padStart(64, "0"), "hex").copy(sig, 0);
    Buffer.from(s.toString(16).padStart(64, "0"), "hex").copy(sig, 32);
    sig[64] = v;
    return sig;
  }
}

let _crypto = null;
export function setCryptoRandom(cryptoModule) {
  _crypto = cryptoModule;
}
// v must be 27 or 28. Returns a lowercase 0x address, or null on bad input.
export function ecrecover(digest, signature) {
  const hash = BigInt("0x" + Buffer.from(digest).toString("hex"));
  const sig = Buffer.from(signature);
  if (sig.length !== 65) return null;
  const r = BigInt("0x" + sig.subarray(0, 32).toString("hex"));
  const s = BigInt("0x" + sig.subarray(32, 64).toString("hex"));
  const v = sig[64];
  if (v !== 27 && v !== 28) return null;
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const recid = v - 27;
  const x = r + BigInt(recid >> 1) * N;
  if (x >= P) return null;
  const R = liftX(x, recid & 1);
  if (R === null) return null;
  const rInv = modInv(r, N);
  const u1 = mod(-(hash * rInv), N);
  const u2 = mod(s * rInv, N);
  const Q = pointAdd(pointMul(u1, [Gx, Gy]), pointMul(u2, R));
  if (Q === null) return null;
  return publicKeyToAddress(Q);
}

export function publicKeyToAddress([x, y]) {
  const xb = x.toString(16).padStart(64, "0");
  const yb = y.toString(16).padStart(64, "0");
  const hash = keccak256(Buffer.from(xb + yb, "hex"));
  return "0x" + hash.subarray(12).toString("hex");
}

// Test-only exports (used by test.mjs).
export const _test = { pointAdd, pointMul, liftX, modInv, P, N, G: [Gx, Gy] };
