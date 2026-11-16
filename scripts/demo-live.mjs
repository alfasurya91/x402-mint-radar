// End-to-end LIVE demo on Aevum testnet (chain 44005).
// Requires: deployments.json (from script/deploy.sh) + .deployer.json
// (funded throwaway deployer key) + cast in PATH.
// Flow: start the server in LIVE mode -> fund a throwaway buyer with
// TestUSD -> buyer pays for /radar and /bounty (402 -> sign -> X-PAYMENT
// -> 200 with REAL tx hashes) -> buyer submits ERC-8004 reputation
// feedback for the seller agent -> read the feedback back on-chain.
// Prints every tx hash + explorer link. Exits 0 on PASS, 1 on FAIL.
// Written 2026-11-16. Testnet only.
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const RPC = process.env.AEVUM_RPC || "https://rpc-test.qday.info";
const EXPLORER = "https://explorer-test.qday.info";
const PORT = process.env.PORT || "8787";
const DIR = new URL("..", import.meta.url).pathname; // project root (script lives in scripts/)

function sh(cmd, args, env = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

if (!existsSync(DIR + "deployments.json")) {
  console.error("deployments.json missing — run script/deploy.sh first (needs a funded deployer).");
  process.exit(1);
}
if (!existsSync(DIR + ".deployer.json")) {
  console.error(".deployer.json missing — the deployer key file is required for live mode.");
  process.exit(1);
}
const dep = JSON.parse(readFileSync(DIR + "deployments.json", "utf8"));
const deployer = JSON.parse(readFileSync(DIR + ".deployer.json", "utf8")).data[0];
const token = dep.token.address;
const rep = dep.reputationRegistry.proxy;
const agentId = dep.agent.agentId;
console.log("token:", token, "| reputation:", rep, "| agentId:", agentId, "| seller:", deployer.address);

// Deployer gas check (testnet tQDAY).
const bal = BigInt(sh("cast", ["balance", deployer.address, "--rpc-url", RPC]).trim());
console.log("deployer tQDAY balance:", (Number(bal) / 1e18).toFixed(4));
if (bal === 0n) {
  console.error("Deployer has 0 tQDAY — claim 5 tQDAY at faucet.qday.info to " + deployer.address + " first.");
  process.exit(1);
}

// Start the live server.
const server = spawn("node", ["server.mjs"], {
  cwd: DIR,
  env: { ...process.env, PORT, AEVUM_LIVE: "1", AEVUM_RPC: RPC },
  stdio: "ignore",
});
let up = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (r.status === 200) { up = true; break; }
  } catch { /* not up yet */ }
  await sleep(500);
}
check("live server up", up);
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
check("health settlement=live", health.settlement === "live", JSON.stringify(health).slice(0, 120));

try {
  // Buyer key + funding (TestUSD only — the buyer pays no gas; the seller submits).
  const buyerKey = "0x" + crypto.randomBytes(32).toString("hex");
  const buyerAddr = sh("cast", ["wallet", "address", "--private-key", buyerKey]).trim();
  const mintTx = JSON.parse(sh("cast", ["send", token, "mint(address,uint256)", buyerAddr, "100000",
    "--rpc-url", RPC, "--private-key", deployer.private_key, "--gas-limit", "500000", "--json"])).transactionHash;
  console.log("buyer:", buyerAddr, "| funded 100000 aUSD (mint tx", mintTx + ")");
  // Buyer also needs native tQDAY for the direct feedback call below
  // (the x402 payments are gasless for the buyer — the seller submits —
  // but giveFeedback is a plain on-chain call from the buyer).
  const gasTx = JSON.parse(sh("cast", ["send", buyerAddr, "--value", "0.05ether",
    "--rpc-url", RPC, "--private-key", deployer.private_key, "--gas-limit", "500000", "--json"])).transactionHash;
  console.log("buyer funded 0.05 tQDAY gas (tx", gasTx + ")");

  // Paid calls.
  const txHashes = [];
  for (const endpoint of ["radar", "bounty"]) {
    const out = sh("node", ["buyer.mjs", "--endpoint", endpoint, "--key", buyerKey, "--port", PORT], {
      AEVUM_RPC: RPC,
    });
    const ok200 = out.includes(`GET /${endpoint} + X-PAYMENT -> 200`);
    const respLine = out.split("\n").find((l) => l.startsWith("X-PAYMENT-RESPONSE:"));
    let resp = null;
    try { resp = JSON.parse(respLine.replace("X-PAYMENT-RESPONSE: ", "")); } catch { /* no */ }
    check(`buyer /${endpoint} -> 200`, ok200);
    check(`/${endpoint} settlement=live + real txHash`,
      resp && resp.settlement === "live" && /^0x[0-9a-fA-F]{64}$/.test(resp.txHash || ""),
      resp ? resp.txHash : "no response header");
    if (resp?.txHash) {
      txHashes.push(resp.txHash);
      console.log(`  /${endpoint} tx: ${EXPLORER}/tx/${resp.txHash}`);
    }
  }

  // Buyer reputation feedback for the seller agent (ERC-8004).
  const fbTx = JSON.parse(sh("cast", ["send", rep,
    "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    String(agentId), "100", "0", "paid-call", "radar",
    "https://127.0.0.1:8787/radar", "", "0x0000000000000000000000000000000000000000000000000000000000000000",
    "--rpc-url", RPC, "--private-key", buyerKey, "--gas-limit", "1000000", "--json"])).transactionHash;
  console.log("feedback tx:", `${EXPLORER}/tx/${fbTx}`);
  const fb = sh("cast", ["call", rep,
    "readFeedback(uint256,address,uint64)(int128,uint8,string,string,bool)",
    String(agentId), buyerAddr, "1", "--rpc-url", RPC]).trim();
  check("feedback readable on-chain (value 100, tag paid-call)", fb.includes("100") && fb.includes("paid-call"), fb.slice(0, 120));

  console.log("\n--- LIVE DEMO SUMMARY ---");
  console.log("settlement txs:", txHashes.map((h) => EXPLORER + "/tx/" + h).join("\n  "));
  console.log("feedback tx:", EXPLORER + "/tx/" + fbTx);
  console.log("agent:", `${EXPLORER}/address/${dep.identityRegistry.proxy} (agentId ${agentId})`);
} finally {
  server.kill();
}

console.log(failures === 0 ? "\nLIVE DEMO: PASS" : `\nLIVE DEMO: FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
