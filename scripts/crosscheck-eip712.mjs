// EIP-712 digest cross-check: JS code vs the real on-chain contract.
// Spins up a local anvil (chainId 44005, same as Aevum testnet), deploys
// TestUSD, then has the PURE-JS code (eip712.mjs + secp256k1.mjs) compute
// the domain separator + authorization digest and sign it. The signature
// is submitted on-chain via transferWithAuthorization. If the call
// succeeds and balances move, the JS digest is byte-identical to the
// contract's — the cross-check passes. A tampered signature is submitted
// as a negative control and must revert.
// Written 2026-11-16. Run: node scripts/crosscheck-eip712.mjs
// Exits 0 on PASS, 1 on FAIL. No testnet writes, no keys persisted.
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { domainSeparator, transferWithAuthorizationDigest } from "../eip712.mjs";
import { signDigest, setCryptoRandom, publicKeyToAddress, _test } from "../secp256k1.mjs";

setCryptoRandom(crypto);

const ANVIL_PORT = 8545;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0
const ANVIL_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 60000 });
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(method + " failed: " + JSON.stringify(j.error));
  return j.result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let anvil = null;
let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

try {
  anvil = spawn("anvil", ["--chain-id", "44005", "--port", String(ANVIL_PORT)], { stdio: "ignore" });
  // Wait for anvil to answer.
  for (let i = 0; i < 50; i++) {
    try {
      const id = await rpc("eth_chainId", []);
      if (id === "0xabe5") break;
    } catch { /* not up yet */ }
    await sleep(200);
  }

  // Deploy TestUSD (1,000,000 aUSD to the deployer).
  const out = sh("forge", [
    "create", "contracts/TestUSD.sol:TestUSD",
    "--rpc-url", RPC, "--private-key", ANVIL_KEY,
    "--constructor-args=1000000000000", "--gas-limit", "3000000", "--broadcast", "--json",
  ]);
  const created = JSON.parse(out);
  const tokenAddr = created.deployedTo;
  console.log("TestUSD deployed on anvil:", tokenAddr);

  // 1. Domain separator: JS vs on-chain.
  const onChainSep = await rpc("eth_call", [{ to: tokenAddr, data: "0x3644e515" }, "latest"]);
  const jsSep = "0x" + domainSeparator({
    name: "Aevum Test USD", version: "1", chainId: 44005, verifyingContract: tokenAddr,
  }).toString("hex");
  check("DOMAIN_SEPARATOR JS == on-chain", onChainSep.toLowerCase() === jsSep.toLowerCase(), jsSep);

  // 2. Buyer: fresh throwaway key, funded with 100,000 aUSD by the owner.
  const buyerPriv = crypto.randomBytes(32);
  const buyerD = BigInt("0x" + buyerPriv.toString("hex"));
  const buyerAddr = publicKeyToAddress(_test.pointMul(buyerD, _test.G));
  sh("cast", ["send", tokenAddr, "mint(address,uint256)", buyerAddr, "100000",
    "--rpc-url", RPC, "--private-key", ANVIL_KEY, "--gas-limit", "500000"]);
  const balBefore = await rpc("eth_call", [{ to: tokenAddr, data: "0x70a08231" + buyerAddr.slice(2).padStart(64, "0") }, "latest"]);
  check("buyer funded 100000 aUSD", BigInt(balBefore) === 100000n, balBefore);

  // 3. Nonce: JS reads the on-chain sequential nonce and uses it.
  const nonceHex = await rpc("eth_call", [{ to: tokenAddr, data: "0x7ecebe00" + buyerAddr.slice(2).padStart(64, "0") }, "latest"]);
  const nonce = "0x" + nonceHex.slice(2).padStart(64, "0");
  check("on-chain nonce is 0 for fresh buyer", BigInt(nonceHex) === 0n, nonceHex);

  // 4. JS builds + signs the authorization; submit on-chain.
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: buyerAddr, to: ANVIL_ADDR, value: 10000,
    validAfter: 0, validBefore: now + 600, nonce,
  };
  const digest = transferWithAuthorizationDigest(
    { name: "Aevum Test USD", version: "1", chainId: 44005, verifyingContract: tokenAddr },
    auth
  );
  const sig = signDigest(digest, buyerPriv);
  const r = "0x" + sig.subarray(0, 32).toString("hex");
  const s = "0x" + sig.subarray(32, 64).toString("hex");
  const v = sig[64];
  const receipt = sh("cast", ["send", tokenAddr,
    "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
    auth.from, auth.to, "10000", "0", String(auth.validBefore), nonce, String(v), r, s,
    "--rpc-url", RPC, "--private-key", ANVIL_KEY, "--gas-limit", "500000", "--json"]);
  const rc = JSON.parse(receipt);
  check("JS-signed transferWithAuthorization succeeds on-chain", rc.status === "0x1", "status " + rc.status);

  const balAfter = await rpc("eth_call", [{ to: tokenAddr, data: "0x70a08231" + buyerAddr.slice(2).padStart(64, "0") }, "latest"]);
  check("buyer balance 100000 -> 90000", BigInt(balAfter) === 90000n, balAfter);
  const nonceAfter = await rpc("eth_call", [{ to: tokenAddr, data: "0x7ecebe00" + buyerAddr.slice(2).padStart(64, "0") }, "latest"]);
  check("nonce incremented to 1", BigInt(nonceAfter) === 1n, nonceAfter);

  // 5. Negative control: same auth, signature made for a DIFFERENT digest.
  const badDigest = transferWithAuthorizationDigest(
    { name: "Aevum Test USD", version: "1", chainId: 44005, verifyingContract: tokenAddr },
    { ...auth, value: 9999 }
  );
  const badSig = signDigest(badDigest, buyerPriv);
  const badR = "0x" + badSig.subarray(0, 32).toString("hex");
  const badS = "0x" + badSig.subarray(32, 64).toString("hex");
  const badV = badSig[64];
  const nonce2 = "0x" + nonceAfter.slice(2).padStart(64, "0");
  // Negative control: the call must NOT succeed. cast send --json exits 0
  // even when the receipt status is 0x0, so judge by the receipt status.
  let badStatus = null;
  try {
    const badOut = sh("cast", ["send", tokenAddr,
      "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
      auth.from, auth.to, "10000", "0", String(auth.validBefore), nonce2, String(badV), badR, badS,
      "--rpc-url", RPC, "--private-key", ANVIL_KEY, "--gas-limit", "500000", "--json"]);
    badStatus = JSON.parse(badOut).status;
  } catch {
    badStatus = "reverted-at-send";
  }
  check("tampered signature reverts on-chain", badStatus === "0x0" || badStatus === "reverted-at-send", "status " + badStatus);
} finally {
  if (anvil) anvil.kill();
}

console.log(failures === 0 ? "\nEIP-712 CROSS-CHECK: PASS" : `\nEIP-712 CROSS-CHECK: FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
