# Aevum x402 Seller Agent — Mint Radar + Bounty Radar

One seller agent, two paid endpoints behind the same x402 paywall, on
Aevum testnet (chain 44005). Built for the Aevum/QDay Builder Challenge
(build window Nov 16–Dec 11, 2026). **Phase 2** — real on-chain
settlement, DEPLOYED LIVE on Aevum testnet 2026-11-16 (aUSD token,
ERC-8004 Identity + Reputation registries, agentId 0; live demo
`/radar` + `/bounty` paid on-chain). **Phase 3 (2026-11-17)** — the
seller also accepts **tUSD8**, the challenge's official test
stablecoin, over the same EIP-3009 paywall (dual-token). Submitted to
the challenge on DoraHacks 2026-11-17 (track Decentralized Payments,
status Under Review). All code in this directory was written fresh on
2026-11-16/17, inside the window; no code is reused from any earlier
project.

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
   network `eip155:44005`, payTo (seller), amount, and a 600-second
   validity window — offering **both** accepted stablecoins
   (`aUSD` and `tUSD8`, one `accepts[]` entry each, same $0.01 price).
3. Buyer picks a token (`--token ausd|tusd8`), builds an EIP-3009
   `transferWithAuthorization` (from, to, value, validAfter,
   validBefore, nonce), signs the EIP-712 digest with its own key, and
   retries with the `X-PAYMENT` header (base64url JSON, x402 v1 shape,
   with top-level `asset` naming the token). Nonce semantics differ
   per token: aUSD uses the on-chain sequential nonce; tUSD8
   (FiatTokenV2) uses a random bytes32 nonce tracked in
   `authorizationState`.
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
- Faucet: https://faucet.qday.info (live faucet contract
  `0x33d19Bde2e1798c13808f17BfBa1780b28e4bACC`, claim is
  operator/relay-gated behind a Turnstile captcha — it cannot be
  claimed headlessly; the wiki-listed `0xE5074CBb...` contract is
  PAUSED). The faucet dispenses tQDAY and tUSD8; Discord
  `/faucet <address>` gives 1 tQDAY + 5 tUSD8 (once per Discord
  account + address).

Payment tokens (phase 3, dual-token — both 6-decimal, $0.01/call,
same EIP-3009 `transferWithAuthorization`):

- **aUSD (Aevum Test USD)** `0xF5506234c9185d1D4262615504093DA671a61712`
  — a minimal test ERC-20 deployed by `script/deploy.sh`
  (`contracts/TestUSD.sol`, EIP-3009 with sequential nonces,
  owner-only mint; the deployer mints demo funds).
- **tUSD8 (official test stablecoin)**
  `0x456569838f1d43009A91ebA4263147Afd7233483` — a FiatTokenV2
  (USDC-style) EIP-1967 proxy; implementation
  `0xD6bE708F41b07b2F4A7B48889b8e16626e317597`. EIP-712 domain
  `name: "tUSD8"`, `version: "2"` (verified: computed domain
  separator == on-chain `DOMAIN_SEPARATOR()`).
  CORRECTION 2026-11-17: an earlier note claimed tUSD8 "has NO
  EIP-3009" — that checked the *proxy* bytecode (only the 5 admin
  selectors). The implementation has `transferWithAuthorization`,
  `receiveWithAuthorization`, `permit`, `nonces` and
  `DOMAIN_SEPARATOR`. The starter kit's Checkout uses
  `receiveWithAuthorization`; this build settles tUSD8 with
  `transferWithAuthorization` directly to the seller (same flow as
  aUSD), which the contract accepts — proven by an eth_call dry-run
  (good signature → `ERC20: transfer amount exceeds balance`;
  flipped-v control → `FiatTokenV2: invalid signature`).

To run the tUSD8 demo legs, the demo buyer must hold tUSD8: a fixed
throwaway buyer lives in gitignored `.buyer-tusd8.json`
(`0x7580CE6ec5EECbC9243306311b653490dd1DeF1d`); claim tUSD8 to that
address at faucet.qday.info (or Discord `/faucet`) — 20,000 base
units ($0.02) cover both demo calls — then run
`node scripts/demo-live.mjs`. Without a funded fixed buyer, the
tUSD8 legs are skipped and the aUSD legs still run.

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
node buyer.mjs --endpoint radar --token ausd   # demo buyer: 402 -> sign -> X-PAYMENT -> 200
node buyer.mjs --endpoint bounty --token tusd8 # same, paid in tUSD8
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
#      (aUSD legs + tUSD8 legs when .buyer-tusd8.json is funded;
#       see the Chain section for the tUSD8 faucet claim)
```

The demo buyer generates a **fresh throwaway keypair every run**
(in memory only, never written to disk) — except the tUSD8 legs,
which reuse the fixed throwaway buyer in gitignored
`.buyer-tusd8.json` (chmod 600) so its address can be pre-funded
with tUSD8 from the faucet. The seller address in
`config.mjs` is a fresh throwaway testnet-only keypair. **The user's
Binance Agentic Wallet is never touched. Nothing here runs on
mainnet, ever.**

## Files

- `server.mjs` — seller server + 402 handshake + mock ledger (mock) /
  real on-chain settlement (live, `AEVUM_LIVE=1`)
- `chain.mjs` — pure-JS JSON-RPC client + EIP-1559 tx signing (live
  settlement path)
- `buyer.mjs` — demo buyer (full 402 → sign → retry loop; `--token
  ausd|tusd8` picks the stablecoin; reads the on-chain nonce for
  aUSD, random nonce for tUSD8)
- `config.mjs` — chain, tokens (aUSD + tUSD8), price, seller (single
  source of truth); `CONFIG.tokenFor(asset)` resolves the token
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
- `scripts/demo-live.mjs` — end-to-end testnet demo (aUSD + tUSD8
  paid calls + reputation feedback; tUSD8 legs need the fixed buyer
  in `.buyer-tusd8.json` funded with tUSD8)
- `registration.json` — ERC-8004 registration file (agentId 0,
  deployed live on Aevum testnet)
- `test.mjs` — 20 mock tests, all passing (incl. dual-token cases)
- `STATUS.md` — phase-1 verdicts + phase-2 build status + blockers
- `package.json` — scripts only, zero dependencies

## Phase 2 + 3 status (see STATUS.md for detail)

Live on Aevum testnet since 2026-11-16, submitted to the challenge
2026-11-17 (DoraHacks, track Decentralized Payments, Under Review):

1. ✅ Reference ERC-8004 Identity + Reputation registries
   (`script/deploy.sh`; agent registered, agentId 0 on testnet).
2. ✅ Minimal test ERC-20 with `transferWithAuthorization`
   (`contracts/TestUSD.sol`).
3. ✅ Fresh throwaway testnet-only deployer/seller keypair
   (`0x302D022788fdbDF6194D3ba4027365C7202f2B18`, key only in
   gitignored `.deployer.json`).
4. ✅ Real on-chain settlement (`AEVUM_LIVE=1`; server submits
   `transferWithAuthorization` itself; live demo 2026-11-17:
   `/radar` + `/bounty` in aUSD settled on-chain, txs verified on
   the explorer).
5. ✅ Live data (/radar: totalSupply read live from BSC;
   /bounty: live reachability checks).
6. ✅ Phase 3 (2026-11-17): tUSD8 accepted as a second payment
   token over the same EIP-3009 paywall (server + buyer +
   `demo-live.mjs` + 20 mock tests). On-chain signature acceptance
   proven by eth_call dry-run; the live tUSD8 settlement still needs
   the fixed demo buyer funded with tUSD8 from the faucet
   (see the Chain section) — then `node scripts/demo-live.mjs`
   proves it end-to-end.
7. ✅ Public GitHub repo `alfasurya91/x402-mint-radar`; demo video
   on YouTube (Unlisted); DoraHacks registration + Build submitted.

**Remaining:** fund the fixed tUSD8 buyer (faucet claim to
`0x7580CE6ec5EECbC9243306311b653490dd1DeF1d`, 20,000 tUSD8 base
units), re-run `node scripts/demo-live.mjs` for the live tUSD8
proof, then refresh the demo video + DoraHacks Build description
with the tUSD8 tx hashes. Judging Dec 12–14, Demo Day Dec 15.

## License

MIT.
