# Aevum x402 Seller Agent — Mint Radar + Bounty Radar

One seller agent, two paid endpoints behind the same x402 paywall, on
Aevum testnet (chain 44005). Built for the Aevum/QDay Builder Challenge
(build window Nov 16–Dec 11, 2026). **Phase 2** — real on-chain
settlement is BUILT and verified end-to-end on a local anvil (chain
44005); the real testnet deployment is blocked on ONE user action
(fund the throwaway deployer with 5 tQDAY from the faucet — see
STATUS.md). All code in this directory was written fresh on 2026-11-16,
inside the window; no code is reused from any earlier project.

## What it sells

- `GET /radar` — today's verified free mints for Agent ID wallets
  (contract, free quota left, price).
- `GET /bounty` — a ranked list of open bug-bounty programs.
- Price per call: **$0.01** in stablecoin (10,000 base units of a
  6-decimal token) on Aevum testnet.

No account, no API key. Any agent can pay per call.

## How the paywall works (x402 + EIP-3009)

1. Buyer requests `GET /radar` (or `/bounty`) with no payment.
2. Server answers **HTTP 402** with the price: scheme `eip3009`,
   network `eip155:44005`, asset (token address), payTo (seller),
   amount, and a 600-second validity window.
3. Buyer builds an EIP-3009 `transferWithAuthorization`
   (from, to, value, validAfter, validBefore, nonce), signs the
   EIP-712 digest with its own key, and retries with the
   `X-PAYMENT` header (base64url JSON, x402 v1 shape).
4. Server verifies the signature with a real `ecrecover` (pure JS,
   no dependencies), rejects replays (nonce used once), wrong
   amounts, wrong recipients, and expired authorizations.
5. Server returns **200** with the data and an `X-PAYMENT-RESPONSE`
   header.

Phase 1 verified the signature for real but settled against an
in-memory **mock ledger** — no on-chain transfer happened yet.
**Phase 2 (built, verified on anvil):** with `AEVUM_LIVE=1` and a
seller key (`.deployer.json`, throwaway testnet-only), the server
submits the real `transferWithAuthorization` on Aevum testnet and
returns the real tx hash + explorer link in `X-PAYMENT-RESPONSE`.
Without the env flag it stays in mock mode, so `node test.mjs`
still passes unchanged. The server verifies the signature and
submits the transfer itself; the Coinbase CDP facilitator is NOT
assumed to cover Aevum testnet.

## ERC-8004 identity

The seller is an ERC-8004 agent. Its public registration file is
served at `/registration.json` (also
`/.well-known/agent-registration.json`). After each paid call a buyer
can leave reputation feedback (`giveFeedback`) in the Reputation
Registry — identity + payment + reputation in one demo loop.

**Identity + Reputation only.** The ERC-8004 Validation Registry was
pulled back for rework, so this build deliberately does not use it.

**Phase 2 status:** the reference ERC-8004 Identity + Reputation
registries are deployed by `script/deploy.sh` (vendor copies from
erc-8004-contracts, via the HardhatMinimalUUPS → ERC1967Proxy →
upgrade pattern) and the seller agent is registered (agentId 0);
`scripts/apply-deployment.mjs` fills the agentId + registry/token
addresses into `registration.json`. Verified end-to-end on anvil;
the real testnet deployment waits on the deployer being funded
(5 tQDAY from faucet.qday.info — see STATUS.md).

## Chain (verified live 2026-11-16)

- Aevum Testnet, chainId **44005** (`0xabe5`), block ~3.29M
- RPC: https://rpc-test.qday.info
- Explorer: https://explorer-test.qday.info
- Faucet: https://faucet.qday.info (contract
  `0xE5074CBbd046AFb491EB8692abD6cF7ECCC6dEE5`)

Payment token (phase 2): **aUSD (Aevum Test USD)** — a minimal test
ERC-20 deployed by `script/deploy.sh` (`contracts/TestUSD.sol`, 6
decimals, EIP-3009 `transferWithAuthorization` with sequential
nonces, owner-only mint). Phase 1 used tUSD8
`0x456569838f1d43009A91ebA4263147Afd7233483` (ERC-20, 6 decimals, 189
holders) only as the EIP-712 domain — its bytecode was checked and it
has **no EIP-3009** (`transferWithAuthorization` selector absent).
QDay's own roadmap says a native stablecoin and the x402 facilitator
are "coming soon" — there is no official stablecoin on testnet yet.

## Run it

Fresh clone (Aevum testnet is pre-Cancun — no MCOPY opcode, so the
OpenZeppelin Bytes.sol must be patched before building):

```sh
git submodule update --init
bash scripts/patch-bytes.sh   # pre-Cancun Bytes.sol for lib/openzeppelin-contracts
forge build
```

Node 22+ stdlib only — no dependencies, no install step.

```sh
node server.mjs            # seller on http://127.0.0.1:8787 (PORT env overrides)
node buyer.mjs --endpoint radar    # demo buyer: 402 -> sign -> X-PAYMENT -> 200
node buyer.mjs --endpoint bounty
node test.mjs              # mock test suite (spawns its own server on port 18787)
node test-chain.mjs        # live-chain test: deploys to a local anvil, real
                           # on-chain settlement, verifies tx receipts (8 checks)
export PATH="$HOME/.foundry/bin:$PATH"
forge test                 # 13 Solidity tests (TestUSD + registries)
node scripts/crosscheck-eip712.mjs   # EIP-712 digest cross-check vs cast (7 checks)

# Live mode (needs a funded deployer — see STATUS.md):
#   1. DEPLOY_KEY=<key> bash script/deploy.sh        # deploys to 44005
#   2. node scripts/apply-deployment.mjs             # patches config + registration
#   3. AEVUM_LIVE=1 node server.mjs                  # live settlement
#   4. node scripts/demo-live.mjs                    # end-to-end testnet demo
```

The demo buyer generates a **fresh throwaway keypair every run**
(in memory only, never written to disk). The seller address in
`config.mjs` is a phase-1 placeholder; phase 2 replaces it with a
fresh throwaway testnet-only keypair. **The user's Binance Agentic
Wallet is never touched. Nothing here runs on mainnet, ever.**

## Files

- `server.mjs` — seller server + 402 handshake + mock ledger (mock) /
  real on-chain settlement (live, `AEVUM_LIVE=1`)
- `chain.mjs` — pure-JS JSON-RPC client + EIP-1559 tx signing (live
  settlement path)
- `buyer.mjs` — demo buyer (full 402 → sign → retry loop; reads the
  on-chain nonce before signing)
- `config.mjs` — chain, token, price, seller (single source of truth)
- `eip712.mjs` — EIP-712 hashing for `transferWithAuthorization`
- `keccak.mjs` — keccak-256 in pure JS (3/3 known vectors pass)
- `secp256k1.mjs` — `ecrecover` + pure-JS ECDSA signing (5/5
  sign→recover round trips pass)
- `contracts/TestUSD.sol` — minimal EIP-3009 test token (6 dec)
- `contracts/vendor/` — ERC-8004 Identity/Reputation registries
  (reference code, MIT)
- `test/Aevum.t.sol` — 13 forge tests, all passing
- `test-chain.mjs` — 8 live-chain checks on anvil, all passing
- `scripts/crosscheck-eip712.mjs` — EIP-712 cross-check, 7/7 passing
- `script/deploy.sh` — deploys everything to 44005, writes
  `deployments.json`
- `scripts/apply-deployment.mjs` — patches config + registration
  from `deployments.json`
- `scripts/demo-live.mjs` — end-to-end testnet demo (paid calls +
  reputation feedback)
- `registration.json` — ERC-8004 registration file (agentId pending
  until the real testnet deploy)
- `test.mjs` — 15 mock tests, all passing
- `STATUS.md` — phase-1 verdicts + phase-2 build status + blockers
- `package.json` — scripts only, zero dependencies

## Phase 2 status (see STATUS.md for detail)

Built + verified on anvil 2026-11-16:

1. ✅ Reference ERC-8004 Identity + Reputation registries
   (`script/deploy.sh`; agent registered, agentId 0 on anvil).
2. ✅ Minimal test ERC-20 with `transferWithAuthorization`
   (`contracts/TestUSD.sol`).
3. ✅ Fresh throwaway testnet-only deployer/seller keypair
   (`0x302D022788fdbDF6194D3ba4027365C7202f2B18`, key only in
   gitignored `.deployer.json`).
4. ✅ Real on-chain settlement (`AEVUM_LIVE=1`; server submits
   `transferWithAuthorization` itself; `test-chain.mjs` 8/8 pass).
5. ✅ Live data (/radar: totalSupply read live from BSC;
   /bounty: live reachability checks).
6. ⏳ Register for the challenge when the form goes live (user
   registers himself); confirm one vs two submissions in the rules.
7. ⏳ Create the public GitHub repo (user creates it on his phone;
   everything here is ready to push).

**Blocked on the user:** (a) fund the deployer with 5 tQDAY from
faucet.qday.info (the wiki-listed faucet contract is PAUSED; the
live faucet needs a Turnstile captcha, so it cannot be claimed
headlessly); (b) create the repo `alfasurya91/x402-mint-radar`.
After those two: deploy → apply → demo-live → push → video →
submission.

## License

MIT.
