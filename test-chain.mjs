// Live-settlement test: full HTTP loop against a local anvil (chain 44005).
// Deploys the phase-2 contracts to anvil via script/deploy.sh, starts the
// server in LIVE mode, funds a throwaway buyer with TestUSD, runs the real
// buyer.mjs (402 -> sign -> X-PAYMENT -> 200) for /radar and /bounty, and
// verifies each payment has a REAL tx hash whose receipt is 0x1 on anvil
// and whose token balances moved. No testnet writes.
// Written 2026-11-16. Run: node test-chain.mjs
// Exits 0 on PASS, 1 on FAIL.
import crypto from "node:crypto";
import { spawn, execFileSync, execSync } from "node:child_process";
import { readFileSync, existsSync, copyFileSync, renameSync } from "node:fs";

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SERVER_PORT = 18788;
const DIR = new URL(".", import.meta.url).pathname;

function sh(cmd, args, env = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, env: { ...process.env, ...env } });
}

async function rpc(method, params) {
  const res = await fetch(ANVIL_RPC, {
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

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail ? " — " + detail : ""));
  if (!ok) failures++;
}

// Pre-flight: kill any stale anvil/server from an earlier crashed run.
// A stale server on port 18788 would silently answer with OLD code
// (this bit us 2026-11-16: a stale pre-fix server kept reverting).
try { execSync(`fuser -k ${ANVIL_PORT}/tcp ${SERVER_PORT}/tcp 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* no fuser */ }
await sleep(500);

let anvil = null;
let server = null;
const hadDeployments = existsSync(DIR + "deployments.json");
// Back up in the SAME directory (renameSync fails across filesystems).
if (hadDeployments) copyFileSync(DIR + "deployments.json", DIR + "deployments.json.bak");

try {
  // 1. Anvil (chain 44005).
  anvil = spawn("anvil", ["--chain-id", "44005", "--port", String(ANVIL_PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await rpc("eth_chainId", [])) === "0xabe5") break;
    } catch { /* not up yet */ }
    await sleep(200);
  }

  // 2. Deploy contracts to anvil.
  console.log("deploying contracts to anvil...");
  sh("bash", ["script/deploy.sh"], {
    DEPLOY_RPC: ANVIL_RPC,
    DEPLOY_KEY: ANVIL_KEY,
    PATH: process.env.PATH,
  });
  const dep = JSON.parse(readFileSync(DIR + "deployments.json", "utf8"));
  check("deployments.json has token + registries + agentId 0",
    !!dep.token?.address && !!dep.identityRegistry?.proxy && !!dep.reputationRegistry?.proxy && dep.agent?.agentId === 0,
    dep.token?.address || "");
  const token = dep.token.address;

  // 3. Start the server in LIVE mode (seller = anvil account 0).
  server = spawn("node", ["server.mjs"], {
    cwd: DIR,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      AEVUM_LIVE: "1",
      SELLER_PRIVATE_KEY: ANVIL_KEY,
      AEVUM_TOKEN_ADDRESS: token,
      AEVUM_TOKEN_NAME: "Aevum Test USD",
      AEVUM_RPC: ANVIL_RPC,
    },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`);
      if (r.status === 200) { up = true; break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  check("live server up on port " + SERVER_PORT, up);
  const health = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/health`)).json();
  check("health reports settlement=live + seller=anvil account 0",
    health.settlement === "live" && health.seller.toLowerCase() === ANVIL_ADDR.toLowerCase(),
    JSON.stringify(health).slice(0, 160));

  // 4. Buyer key (fixed, so both endpoints can use it) + funding.
  const buyerKey = "0x" + crypto.randomBytes(32).toString("hex");
  const buyerAddr = sh("cast", ["wallet", "address", "--private-key", buyerKey]).trim();
  sh("cast", ["send", token, "mint(address,uint256)", buyerAddr, "100000",
    "--rpc-url", ANVIL_RPC, "--private-key", ANVIL_KEY, "--gas-limit", "500000"]);
  console.log("buyer:", buyerAddr, "(funded 100000 aUSD)");

  const sellerBalBefore = BigInt(await rpc("eth_call", [{
    to: token, data: "0x70a08231" + ANVIL_ADDR.slice(2).padStart(64, "0"),
  }, "latest"]));

  // 5. Run the real buyer for /radar and /bounty.
  const txHashes = [];
  for (const endpoint of ["radar", "bounty"]) {
    const out = sh("node", ["buyer.mjs", "--endpoint", endpoint, "--key", buyerKey, "--port", String(SERVER_PORT)], {
      AEVUM_TOKEN_ADDRESS: token,
      AEVUM_TOKEN_NAME: "Aevum Test USD",
      AEVUM_RPC: ANVIL_RPC,
    });
    const m200 = out.includes(`GET /${endpoint} + X-PAYMENT -> 200`);
    const respLine = out.split("\n").find((l) => l.startsWith("X-PAYMENT-RESPONSE:"));
    let resp = null;
    try { resp = JSON.parse(respLine.replace("X-PAYMENT-RESPONSE: ", "")); } catch { /* no */ }
    check(`buyer /${endpoint} -> 200`, m200);
    check(`/${endpoint} X-PAYMENT-RESPONSE settlement=live + real txHash`,
      resp && resp.settlement === "live" && /^0x[0-9a-fA-F]{64}$/.test(resp.txHash || ""),
      resp ? resp.txHash : "no response header");
    if (resp?.txHash) {
      txHashes.push(resp.txHash);
      const rc = await rpc("eth_getTransactionReceipt", [resp.txHash]);
      check(`/${endpoint} settlement tx receipt status 0x1`, rc && rc.status === "0x1", resp.txHash);
    }
  }

  // 6. Seller received 2 x 10000 aUSD.
  const sellerBalAfter = BigInt(await rpc("eth_call", [{
    to: token, data: "0x70a08231" + ANVIL_ADDR.slice(2).padStart(64, "0"),
  }, "latest"]));
  check("seller token balance +20000 aUSD (2 paid calls)",
    sellerBalAfter - sellerBalBefore === 20000n,
    `${sellerBalBefore} -> ${sellerBalAfter}`);

  // 7. /radar returned live (non-sample) data.
  const radarOut = sh("node", ["buyer.mjs", "--endpoint", "radar", "--key", buyerKey, "--port", String(SERVER_PORT)], {
    AEVUM_TOKEN_ADDRESS: token,
    AEVUM_TOKEN_NAME: "Aevum Test USD",
    AEVUM_RPC: ANVIL_RPC,
  });
  check("/radar live data is non-sample with totalSupply",
    radarOut.includes('"sample": false') && radarOut.includes('"totalSupply"'));
} finally {
  if (server) server.kill();
  if (anvil) anvil.kill();
  if (hadDeployments) renameSync(DIR + "deployments.json.bak", DIR + "deployments.json");
}

console.log(failures === 0 ? "\nLIVE-CHAIN TEST: PASS" : `\nLIVE-CHAIN TEST: FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
