// EIP-712 typed-data hashing for EIP-3009 transferWithAuthorization.
// Written 2026-11-16, inside the Aevum build window. No dependencies.
import { keccak256 } from "./keccak.mjs";

const TRANSFER_TYPE =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";
const DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

function encodeUint256(n) {
  const b = Buffer.alloc(32);
  b.writeBigUInt64BE(BigInt(n) & 0xffffffffffffffffn, 24);
  // Values above 2^64 are not expected here (price/expiry are small);
  // keep the encoder honest rather than silently truncating.
  if (BigInt(n) >> 64n !== 0n) throw new Error("uint256 value too large for this encoder");
  return b;
}

function encodeAddress(addr) {
  const raw = Buffer.from(addr.replace(/^0x/, ""), "hex");
  if (raw.length !== 20) throw new Error("bad address: " + addr);
  return Buffer.concat([Buffer.alloc(12), raw]);
}

function encodeBytes32(hex) {
  const raw = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (raw.length !== 32) throw new Error("bad bytes32: " + hex);
  return raw;
}

export function domainSeparator({ name, version, chainId, verifyingContract }) {
  const typeHash = keccak256(Buffer.from(DOMAIN_TYPE, "utf8"));
  const parts = Buffer.concat([
    typeHash,
    keccak256(Buffer.from(name, "utf8")),
    keccak256(Buffer.from(version, "utf8")),
    encodeUint256(chainId),
    encodeAddress(verifyingContract),
  ]);
  return keccak256(parts);
}

export function transferWithAuthorizationDigest(domain, auth) {
  const domainSep = domainSeparator(domain);
  const typeHash = keccak256(Buffer.from(TRANSFER_TYPE, "utf8"));
  const struct = Buffer.concat([
    typeHash,
    encodeAddress(auth.from),
    encodeAddress(auth.to),
    encodeUint256(auth.value),
    encodeUint256(auth.validAfter),
    encodeUint256(auth.validBefore),
    encodeBytes32(auth.nonce),
  ]);
  const hashStruct = keccak256(struct);
  return keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), domainSep, hashStruct]));
}
