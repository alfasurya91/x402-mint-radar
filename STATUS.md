# Aevum/QDay Builder Challenge — PHASE 1 STATUS

Date: Mon 2026-11-16 (day 1 of the build window Nov 16–Dec 11, 2026).
Work dir: `~/workspace/hackathon/aevum/`. All files written fresh today;
nothing is reused from Sentinel (built Nov 10, outside the window).

## The three open unknowns — VERDICTS

### (a) Registration form URL + rules / prize split / judging — NOT LIVE

Checked 2026-11-16 ~10:30 WIB:

- https://qday.io/ (homepage, crawled 2h before the check): NO Builder
  Challenge link, NO registration form, NO prize split, NO judging
  criteria. Roadmap section says "x402 facilitator and stablecoin
  paymaster coming soon". Testnet is live (chain 44005).
- https://wiki.qday.info/ : no Builder Challenge section (user/dev docs
  only; "Latest updates" empty).
- Web search "QDay Builder Challenge Aevum registration $1500": no
  QDay result at all — only unrelated builder challenges.

Verdict: **registration is still not open**. The $1,500 USDT total is
the only prize figure known (from the brief); the split and judging
criteria are unverified. **Re-check later; the user registers himself
when the form appears.** One-vs-two-submissions is also still unknown
— do NOT split the build without asking.

### (b) ERC-8004 Identity/Reputation registries on chain 44005 — ABSENT

Canonical CREATE2 addresses (from the official ERC-8004 contracts
README, cross-checked on three independent sources), checked with
`eth_getCode` against https://rpc-test.qday.info at block ~3.29M:

- Testnet Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` → EMPTY
- Testnet Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713` → EMPTY
- Mainnet Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` → EMPTY
- Mainnet Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` → EMPTY

Verdict: **no ERC-8004 registry is deployed on Aevum testnet.**
Phase-2 task: deploy the reference Identity + Reputation registries
(or minimal equivalents) on 44005, then register the seller agent and
fill `agentId` into `registration.json`. Validation Registry is
intentionally excluded (pulled back for rework).

### (c) Stablecoin with EIP-3009 on 44005 — ABSENT

- Explorer token search for "USDC": zero results.
- Explorer token list (ERC-20): tUSD8, sQDAY, WABEL, WQDAY,
  "AutoTasker Demo USD" — no official stablecoin.
- Best candidate tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483`
  (6 decimals, 189 holders, supply 3,217,400): contract is NOT
  verified on the explorer, and its bytecode (1,496 bytes) contains
  NONE of the EIP-3009 selectors — `transferWithAuthorization`
  `0xe3ee160e` absent, `DOMAIN_SEPARATOR()` `0x3644e515` absent,
  `nonces(address)` `0x7ecebe00` absent. It is a plain test ERC-20.
- QDay roadmap: native stablecoin arrives with mainnet (2027 Q1);
  testnet "stablecoin paymaster coming soon".

Verdict: **no EIP-3009 stablecoin exists on Aevum testnet.**
Phase-2 task: deploy a minimal test ERC-20 WITH
`transferWithAuthorization` (testnet-only) and swap the token
address/name in `config.mjs`. Phase 1 uses tUSD8's address/name only
as the EIP-712 domain — the signature is real, settlement is mock.

### Chain liveness (bonus check)

- `eth_chainId` → `0xabe5` (44005). `eth_blockNumber` → `0x322e07`
  (~3.29M). Faucet contract
  `0xE5074CBbd046AFb491EB8692abD6cF7ECCC6dEE5` has code. Chain is live.

## Scaffold status — DONE, all green

- `node test.mjs`: **15/15 mock tests pass** (402 flow, offer shape,
  valid payment → 200 + X-PAYMENT-RESPONSE, replay/amount/expiry/
  recipient rejections, /bounty, /registration.json, /).
- Demo buyer end-to-end (fresh throwaway key each run):
  `/radar` 402 → sign → X-PAYMENT → 200, `/bounty` same. **2/2 pass.**
- Crypto core verified independently: keccak-256 3/3 known vectors;
  secp256k1 sign→ecrecover round trip 5/5; deterministic d=1/k=2
  vector recovers the known address. (Note found during testing:
  Node's `crypto.sign(null, ...)` SHA-256-hashes the input for ECDSA
  keys, so the buyer uses the pure-JS `signDigest` instead — raw
  digest signing, low-s normalized.)
- No chain writes in phase 1. No GitHub repo created (user creates it
  on his phone). No private key written anywhere; buyer keys are
  in-memory throwaways.

## Files (all fresh, 2026-11-16)

`server.mjs`, `buyer.mjs`, `config.mjs`, `eip712.mjs`, `keccak.mjs`,
`secp256k1.mjs`, `registration.json`, `test.mjs`, `package.json`,
`README.md`, `STATUS.md`.

## What is needed next (phase 2)

1. **Repo creation** — user creates the public repo on his phone
   (GitHub App cannot create repos); then push this directory.
2. **Registration** — re-check qday.io/wiki for the form; user
   registers himself; confirm one vs two submissions in the rules.
3. **Deployer decision** — generate a FRESH throwaway testnet-only
   keypair in phase 2 (not now); fund it from the faucet; use it to
   deploy (a) ERC-8004 Identity + Reputation registries and (b) the
   minimal EIP-3009 test token; set the seller address in `config.mjs`.
4. **On-chain settlement** — replace the mock ledger in `server.mjs`
   with a real `transferWithAuthorization` broadcast.
5. **Live data** — /radar: real on-chain free-mint quota checks;
   /bounty: real ranked scan.
6. **EIP-712 cross-check** — verify the digest against a reference
   EIP-3009 implementation (cast/ethers) before the first on-chain
   settlement; the pure-JS keccak/ecrecover passed all local vectors,
   but a second implementation check is cheap insurance.

---

# PHASE 2 STATUS — build done, deployment BLOCKED on funding

Date: Mon 2026-11-16 (afternoon). Phase 2 items 3–6 above are BUILT
and verified end-to-end on a local anvil (chain 44005). The real
testnet deployment is blocked on ONE user action (see §Faucet).

## Repo — BLOCKED (user action)

- `gh` CLI is not logged in on this VM (`gh auth status`: "You are
  not logged into any GitHub hosts").
- GitHub connector IS connected, but `create_repository` failed 403
  "Resource not accessible by integration" (user-confirmation approved
  the attempt).
- Work continues locally; `git init` done (branch main,
  user alfasurya91 / sbima9856@gmail.com). **User must create the
  public repo `alfasurya91/x402-mint-radar` on his phone**, then the
  local repo is pushed.

## Deployer — GENERATED (testnet-only throwaway)

- Address: **0x302D022788fdbDF6194D3ba4027365C7202f2B18**
- Private key ONLY in `.deployer.json` (chmod 600, gitignored) —
  never logged, pasted, or committed. NEVER the user's Binance
  Agentic Wallet.

## Faucet — THE BLOCKER (user action)

- Wiki-listed faucet contract `0xE5074CBbd046AFb491EB8692abD6cF7ECCC6dEE5`
  is PAUSED (`paused()=true`, verified twice) and balance 0 — direct
  claim is dead (a claim tx at block 1281641 failed; `setPaused(true)`
  at block 1561249).
- The LIVE faucet is a different contract,
  `0x33d19Bde2e1798c13808f17BfBa1780b28e4bACC` (from the live site's
  `window.__ENV__`: drip 5 tQDAY, cooldown 86400s, balance 735 tQDAY,
  `NEXT_PUBLIC_FAUCET_RELAY=true`). But its relay requires a
  Cloudflare Turnstile token, and a zero-balance wallet cannot pay gas
  for a direct on-chain claim — headless funding is impossible
  without bypassing a captcha (not attempted, not allowed).
- **Exact user action needed: claim 5 tQDAY at faucet.qday.info to
  `0x302D022788fdbDF6194D3ba4027365C7202f2B18` (enter address,
  complete Turnstile, ~2 min).** Verified 2026-11-16 ~11:30 WIB:
  deployer balance is **0 tQDAY** (testnet block 3,292,196).

## Contracts — WRITTEN + COMPILING + TESTED

- `contracts/TestUSD.sol`: minimal ERC-20, 6 decimals, "Aevum Test
  USD" / "aUSD", EIP-3009 `transferWithAuthorization` with
  spec-compliant SEQUENTIAL nonces (`nonces(address)` returns the
  next nonce as bytes32, must equal the auth nonce, increments on
  use), EIP-712 domain `EIP712Domain(name,"1",chainId,this)`,
  owner-only mint for testnet demos, 1,000,000 aUSD initial supply
  to the deployer. NOTE: it returns NO value (void) — `cast call`
  returns `0x` on success; that is correct, not an error.
- `contracts/vendor/`: IdentityRegistryUpgradeable.sol,
  ReputationRegistryUpgradeable.sol, HardhatMinimalUUPS.sol — vendor
  copies from https://github.com/erc-8004/erc-8004-contracts (MIT
  headers intact). Reference deploy pattern (their test/core.ts +
  scripts/deploy-vanity.ts): HardhatMinimalUUPS → ERC1967Proxy →
  upgradeToAndCall(real impl). One patch: removed the
  `__UUPSUpgradeable_init()` call (OZ v5.7 removed that initializer;
  UUPSUpgradeable is stateless in v5).
- `foundry.toml`: optimizer=true, runs=200, via_ir=true (Reputation
  registry "stack too deep" without via-IR); remappings now point at
  the top-level `lib/openzeppelin-contracts/` (clone finished
  2026-11-16 ~11:20 WIB; OZ upgradeable + OZ contracts v5.7.0,
  forge-std v1.17.0). `forge build` succeeds.
- Contract sizes: TestUSD 3,039 / Identity 14,406 / Reputation
  10,722 / HardhatMinimalUUPS 2,037 bytes (init code).

## Forge tests — 13/13 PASS (`forge test`, test/Aevum.t.sol)

TestUSD metadata, nonces start at 0, transferWithAuthorization happy
path (balance 100000→90000, nonce 0→1), replay reverts, wrong-nonce
reverts, expired reverts, bad-signature reverts; register agent
(agentId 0, ownerOf, tokenURI, agentWallet metadata), second register
increments id, setAgentURI; giveFeedback + readFeedback (value 100,
tags paid-call/radar), self-feedback reverts, revokeFeedback.
(Fixes: test contract implements onERC721Received; readFeedback
returns (value, valueDecimals, tag1, tag2, isRevoked).)

## EIP-712 cross-check — PASS 7/7 (scripts/crosscheck-eip712.mjs)

On a local anvil (chainId 44005): DOMAIN_SEPARATOR JS == on-chain
(`0x733968518e378d9d544d16ffb205d45408f70bc19e9a07fefaad5dd4878271f1`
for the anvil deployment); buyer funded 100000 aUSD; on-chain nonce 0
for a fresh buyer; **JS-signed transferWithAuthorization succeeds
on-chain (status 0x1)**; buyer balance 100000→90000; nonce 0→1;
tampered signature reverts (receipt 0x0). (`cast send --json` exits 0
even on revert — the script judges the negative control by receipt
status, not exit code.)

## chain.mjs — pure-JS JSON-RPC + EIP-1559 signing (Node stdlib only)

Minimal RLP encoder, eth_call/getNonce/getBalance,
getDomainSeparator/getTokenNonce/getTokenBalance,
encodeTransferWithAuthorization (selector 0xe3ee160e),
sendTransaction (type-2: maxPriorityFeePerGas via
eth_maxPriorityFeePerGas with 1 gwei fallback, maxFeePerGas =
2×baseFee + priority, gas via eth_estimateGas +20% or 500k fallback,
yParity = v−27), waitReceipt (90s timeout, 1s poll).

**Bug found + fixed 2026-11-16 (anvil):** the selector constant was
`"0xe3ee160e"` (with 0x) while callers prepend `"0x"` — the doubled
prefix made `Buffer.from(x, "hex")` silently return an EMPTY buffer,
so the settlement tx carried NO calldata and reverted (gasUsed
21052, trace `input: "0x"`). Fix: selector is now `"e3ee160e"`
(no 0x), and `hexToBuf` now throws on invalid hex instead of silently
truncating. A second, stale-process trap bit the same session: a
crashed debug run left an old `node server.mjs` on port 18788, so a
fresh server could not bind and the buyer kept talking to the OLD
(pre-fix) code. `test-chain.mjs` now kills stale listeners on ports
8545/18788 before starting.

## server.mjs — LIVE settlement (phase 2)

- Modes: `AEVUM_LIVE=1` + seller key (env `SELLER_PRIVATE_KEY` or
  `.deployer.json`) → LIVE settlement; otherwise MOCK (exactly phase 1,
  so `test.mjs` stays green).
- Live settlement: verifyPayment (signature, amount, recipient,
  expiry, in-memory replay guard) → on-chain nonce pre-flight
  (getTokenNonce must equal the auth nonce) → submit
  transferWithAuthorization from the seller (gas payer) via chain.mjs
  → waitReceipt → 200 with the real txHash + explorerTxUrl, or 402
  "settlement failed" WITHOUT marking the nonce used (a failed
  settlement leaves the authorization unspent on-chain).
- /health reports settlement mode, seller, token, agentId,
  paymentsSettled.
- /radar live data: totalSupply per mint read LIVE from BSC RPC
  (eth_call 0x18160ddd, 60s cache) — MarsNexus 9505, Worldygg 20233
  (verified 2026-11-16), Agent Ape Club 0 (raw chain read; symbol()
  verified "AAPE"); free-quota facts from the verified ledger.
- /bounty: curated ranked list with live reachability checks (HEAD,
  5-min cache) — Snowbridge (HackenProof, Critical $30k–$75k verified
  2026-11-14), Immunefi, Sherlock, Cantina, HackerOne; all 7 program
  URLs verified HTTP 200 on 2026-11-16. Mock mode keeps the phase-1
  sample entries (sample:true) so the 15 mock tests still pass.

## buyer.mjs — updated

Reads the on-chain sequential nonce via eth_call `nonces(buyer)`
(selector 0x7ecebe00) before signing; falls back to a random bytes32
nonce when the chain read fails (mock mode). Prints the
X-PAYMENT-RESPONSE as valid JSON (so test-chain.mjs can parse the
txHash out of it).

## Live-chain test — PASS (`node test-chain.mjs`)

Full HTTP loop against a local anvil (chain 44005): deploy.sh deploys
all contracts to anvil → live server (seller = anvil account 0) →
buyer funded 100000 aUSD → buyer pays for /radar AND /bounty
(402 → sign → X-PAYMENT → 200) → each payment has a REAL tx hash
whose receipt is 0x1 → seller token balance +20000 aUSD → /radar
returns live (non-sample) data with totalSupply. All 8 checks PASS.
(The test backs up/restores deployments.json in the same directory —
`renameSync` fails across filesystems — and kills stale listeners on
ports 8545/18788 first.)

## Deploy / apply / demo scripts

- `script/deploy.sh`: deploys TestUSD + HardhatMinimalUUPS +
  Identity/Reputation proxies + upgrades + registers the seller agent
  (agentId 0), writes `deployments.json` (addresses + tx hashes).
  Env: `DEPLOY_RPC` (default testnet), `DEPLOY_KEY`, `AGENT_URI`.
  Gotchas baked in: `--constructor-args` must come LAST (clap
  greedily consumes following flags); `forge create`/`cast send`
  need explicit `--gas-limit` on anvil.
- `scripts/apply-deployment.mjs`: patches config.mjs (token
  address/name/symbol, seller) + registration.json (agentId, token,
  phase 2, registry addresses) from deployments.json. Verified on a
  /tmp copy against the anvil deployment — all fields patched
  correctly.
- `scripts/demo-live.mjs`: end-to-end testnet demo — starts the live
  server, funds a throwaway buyer, pays for /radar + /bounty, submits
  ERC-8004 reputation feedback (giveFeedback value 100, tags
  paid-call/radar) from the buyer, reads it back via readFeedback.
  Prints every tx hash + explorer link. NOT yet run (blocked on the
  5 tQDAY faucet claim).

## Test suite — all green (2026-11-16 ~11:30 WIB)

- `node test.mjs`: **15/15 mock tests pass** (unchanged).
- `forge test`: **13/13 pass**.
- `node test-chain.mjs`: **8/8 live-chain checks pass** (anvil).
- `node scripts/crosscheck-eip712.mjs`: **7/7 pass** (anvil).

## What remains (phase 2, in order)

1. **USER: claim 5 tQDAY** at faucet.qday.info to
   `0x302D022788fdbDF6194D3ba4027365C7202f2B18` (Turnstile, ~2 min).
2. **USER: create public repo** `alfasurya91/x402-mint-radar` on his
   phone (then push this directory).
3. Run `script/deploy.sh` (DEPLOY_KEY from .deployer.json) → real
   TestUSD + Identity + Reputation on 44005 → `deployments.json`.
4. Run `scripts/apply-deployment.mjs` → config.mjs + registration.json
   point at the real deployments.
5. Run `scripts/demo-live.mjs` → live 402 → sign → X-PAYMENT → 200
   with REAL tx hashes + feedback on-chain.
6. Push the repo (git commit is ready to be made locally; push waits
   for the repo to exist).
7. Registration when live (user's action) → demo video → submission.

## Debugging notes (costly, keep)

- `forge create --constructor-args <val>` (space form) greedily
  consumes the next flag as a second arg — use
  `--constructor-args=<val>` for one arg, or put `--constructor-args`
  LAST with space-separated values for several.
- `forge create`/`cast send` need an explicit `--gas-limit` on anvil
  or eth_estimateGas fails ("Out of gas: gas required exceeds
  allowance: 0").
- The anvil account-0 private key ends in `...4f2ff80`, NOT
  `...4f3ff80` — the wrong digit derives address
  `0x7f225583e3bce24e0deaa116ecff1e552cb74272` instead of
  `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
- `cast send --json` exits 0 even on revert — judge negative controls
  by receipt status, not exit code.
- `Buffer.from(x, "hex")` silently truncates on invalid hex — see
  the chain.mjs fix above; always validate hex before converting.
- Always kill stale anvil/server processes (ports 8545/18788) before
  a fresh live test — a stale server answers with OLD code.

## Phase 2 LIVE deployment — 2026-11-16 ~12:47 WIB (Aevum testnet 44005)
- Deployer funded 5 tQDAY via faucet (user claimed to personal wallet, forwarded; deployer balance at deploy 4.999968 tQDAY; after deploy+demo ~4.95).
- **Root cause of first deploy failure (Identity proxy OOG at 3M gas): Aevum testnet is PRE-CANCUN — it has no MCOPY opcode.** OZ v5.7 `Bytes.sol` uses `mcopy` in slice/splice/replace/concat; every contract's IR contained it. Evidence: `cast estimate` -> "invalid opcode: MCOPY"; `cast run` -> [NotActivated]; solc error 7755 under evm_version=paris pointing at Bytes.sol:94/124/168/195.
- **Fix:** (1) vendored patched copy `contracts/vendor/Bytes.sol` (4 mcopy sites -> 32-byte word-copy loops, OZ v5.0 style) + foundry.toml remapping for that single file; (2) same patch applied to `lib/openzeppelin-contracts/.../Bytes.sol` (required: `Math.sol` imports it via a relative path, so the remapping alone doesn't cover it); (3) `evm_version = "paris"` in [profile.default]. Rebuild clean, IR mcopy=0 for all 5 contracts, forge tests 13/13 PASS, proxy estimate 169,711 gas.
- **Deployed (live):** TestUSD 0xF5506234c9185d1D4262615504093DA671a61712; MinimalUUPS 0x3A61D78f0AF95C86214De7D0f0457d4Fe3d5d5eF; Identity proxy 0x4f3cB7907bEb073C51dB3Bc18131ABEd5fCD1f31 (impl 0x09128Ce40A95851d6Cd04C65dF892fE908D07D53); Reputation proxy 0xF4B926532e198e1aB00a40308Ca5EB3F50DFEc67 (impl 0xE028Bb534D337a92977C114E0a3Ba4dA3F3af132); agentId 0 registered, owner=deployer, URI=raw.githubusercontent alfasurya91/x402-mint-radar/main/registration.json (repo NOT created yet — URI 404 until then).
- **LIVE DEMO: PASS** (`scripts/demo-live.mjs`, 12:47 WIB): server settlement=live; buyer funded 100,000 aUSD + 0.05 tQDAY gas; /radar 200 tx 0xac9351fc3ddc2e8ad6846c561818d6d64c4303c1fc199e9039f166ecd4f54de7; /bounty 200 tx 0xb3135b2ee5ef8ee3ed88a94a6e5c47db76f0b5afbbec93504c9cba9ce7347540; feedback tx 0x0394aaac5d4582576fd045bedac9c37c6c1eb5623475812cd3ce35959461a3ed (value 100, tag paid-call, readable on-chain).
- demo-live.mjs fixes made during the run: DIR pointed at scripts/ instead of project root (deployments.json/.deployer.json + server.mjs live at root); buyer needed 0.05 tQDAY gas for the direct giveFeedback call; script needs `cast` on PATH.
- NOTE: deployer private key was briefly visible in a tool-call log during debugging (testnet-only throwaway, ~5 valueless tQDAY, never committed/pasted to chat). No rotation — redeploy would be needed to change the agent owner; risk accepted for testnet.
- Reproducibility gap (fresh clone): the submodule patch to lib/.../Bytes.sol does NOT travel with a git push (submodule dirt). A fresh clone must re-apply it (or use the vendored copy + remapping, which covers @openzeppelin imports but not Math.sol's relative import). Documented here; add a patch script before submission.
- REMAINING: (1) user creates public repo alfasurya91/x402-mint-radar; (2) push (commit includes contracts/vendor/Bytes.sol + foundry.toml remapping + paris; submodule dirt noted in commit msg); (3) demo video; (4) submit when QDay registration opens (recheck cron 15:00 WIB today).
