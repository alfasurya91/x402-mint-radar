// keccak-256 (original Keccak padding, NOT NIST SHA3) in pure JS.
// Needed because Node's crypto has sha3-256 but not keccak-256, and the
// x402 / EIP-3009 / EIP-712 stack is keccak everywhere.
// Written 2026-11-16, inside the Aevum build window. No dependencies.
const MASK64 = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets r[x][y], lane index = x + 5*y.
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl64(x, n) {
  if (n === 0) return x & MASK64;
  const b = BigInt(n);
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function keccakF1600(s) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) {
      C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    }
    const D = new Array(5);
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];
    }
    // Rho + Pi
    const B = new Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const nx = y;
        const ny = (2 * x + 3 * y) % 5;
        B[nx + 5 * ny] = rotl64(s[x + 5 * y], R[x][y]);
      }
    }
    // Chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & B[(x + 2) % 5 + 5 * y]);
      }
    }
    // Iota
    s[0] ^= RC[round];
  }
}

// Keccak-256: rate 1088 bits (136 bytes), suffix 0x01, pad10*1.
export function keccak256(input) {
  const data = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const rate = 136;
  const state = new Array(25).fill(0n);
  let off = 0;
  while (off + rate <= data.length) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= data.readBigUInt64LE(off + i * 8);
    }
    keccakF1600(state);
    off += rate;
  }
  // Final block with pad10*1.
  const rem = data.length - off;
  const block = Buffer.alloc(rate);
  data.copy(block, 0, off);
  block[rem] ^= 0x01;
  block[rate - 1] ^= 0x80;
  for (let i = 0; i < rate / 8; i++) {
    state[i] ^= block.readBigUInt64LE(i * 8);
  }
  keccakF1600(state);
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(state[i] & MASK64, i * 8);
  return out;
}

export function keccak256Hex(input) {
  return "0x" + keccak256(input).toString("hex");
}
