// Apply a deployments.json (written by script/deploy.sh) to the project:
// patches config.mjs (token address/name/symbol, seller) and
// registration.json (agentId, token address, phase 2, registry addresses).
// Run: node scripts/apply-deployment.mjs [deployments.json]
// Written 2026-11-16.
import { readFileSync, writeFileSync } from "node:fs";

const depPath = process.argv[2] || "deployments.json";
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const token = dep.token.address;
const seller = dep.deployer;
const agentId = dep.agent.agentId;
const explorer = dep.explorer || "https://explorer-test.qday.info";

// --- config.mjs ---
let cfg = readFileSync("config.mjs", "utf8");
const before = cfg;
cfg = cfg.replace(
  /(\n  token: \{\n    address: ")0x[0-9a-fA-F]{40}(")/,
  `$1${token}$2`
);
cfg = cfg.replace(
  /(\n  token: \{\n    address: "0x[0-9a-fA-F]{40}",\n    symbol: ")[^"]+(")/,
  `$1aUSD$2`
);
cfg = cfg.replace(
  /(\n  token: \{\n    address: "0x[0-9a-fA-F]{40}",\n    symbol: "[^"]+",\n    name: ")[^"]+(")/,
  `$1Aevum Test USD$2`
);
cfg = cfg.replace(/(seller: ")0x[0-9a-fA-F]{40}(")/, `$1${seller}$2`);
cfg = cfg.replace(
  "Shared config for the Aevum x402 seller agent — PHASE 1 (mock settlement).",
  "Shared config for the Aevum x402 seller agent — PHASE 2 (live settlement).\n// Token + seller filled by scripts/apply-deployment.mjs from deployments.json."
);
if (cfg === before) throw new Error("config.mjs: no replacements applied — check the file shape");
writeFileSync("config.mjs", cfg);
console.log("config.mjs: token", token, "| seller", seller);

// --- registration.json ---
const reg = JSON.parse(readFileSync("registration.json", "utf8"));
reg.phase = 2;
reg.description = "Seller agent on Aevum testnet: a free-mint radar and a bug-bounty radar, each sold per call for $0.01 in stablecoin behind an x402 paywall (EIP-3009 transferWithAuthorization). Phase 2: LIVE on-chain settlement — the server submits transferWithAuthorization and returns the real tx hash.";
reg.registrations = [{
  standard: "ERC-8004",
  agentId,
  identityRegistry: dep.identityRegistry.proxy,
  reputationRegistry: dep.reputationRegistry.proxy,
  token: dep.token.address,
  agentURI: dep.agent.agentURI,
  explorerIdentity: `${explorer}/address/${dep.identityRegistry.proxy}`,
  explorerReputation: `${explorer}/address/${dep.reputationRegistry.proxy}`,
  explorerToken: `${explorer}/address/${dep.token.address}`,
  registerTx: dep.agent.registerTx,
  note: "Phase 2: reference ERC-8004 Identity + Reputation registries deployed on Aevum testnet (chain 44005); seller agent registered as agentId " + agentId + ".",
}];
for (const s of reg.services) {
  s.payment.asset = token;
  s.endpoint = s.endpoint.replace(/:\d+\//, ":8787/");
}
writeFileSync("registration.json", JSON.stringify(reg, null, 2) + "\n");
console.log("registration.json: agentId", agentId, "| token", token);
console.log("apply-deployment: OK");
