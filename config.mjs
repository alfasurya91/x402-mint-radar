// Shared config for the Aevum x402 seller agent — PHASE 2 (live settlement).
// Token + seller filled by scripts/apply-deployment.mjs from deployments.json.
// Written 2026-11-16, inside the Aevum build window. No dependencies.
export const CONFIG = {
  // Aevum Testnet (verified live 2026-11-16: chainId 0xabe5, block ~3.29M).
  chainId: 44005,
  chainIdHex: "0xabe5",
  network: "eip155:44005",
  rpc: "https://rpc-test.qday.info",
  explorer: "https://explorer-test.qday.info",
  faucet: "https://faucet.qday.info",
  faucetContract: "0xE5074CBbd046AFb491EB8692abD6cF7ECCC6dEE5",

  // Payment token: aUSD (Aevum Test USD) — a minimal test ERC-20
  // deployed by script/deploy.sh (contracts/TestUSD.sol, 6 decimals,
  // EIP-3009 transferWithAuthorization with SEQUENTIAL nonces,
  // owner-only mint). The EIP-712 domain is built from these fields.
  // NOTE (corrected 2026-11-17): the phase-1 claim that tUSD8 "has NO
  // EIP-3009" was WRONG — it checked the tUSD8 PROXY bytecode
  // (0x4565...3483, only the 5 admin selectors). The implementation
  // 0xD6bE708F41b07b2F4A7B48889b8e16626e317597 has transferWithAuthorization,
  // receiveWithAuthorization, permit, nonces and DOMAIN_SEPARATOR.
  // tUSD8 is therefore added as a second accepted token below (phase 3).
  token: {
    address: "0xF5506234c9185d1D4262615504093DA671a61712",
    symbol: "aUSD",
    name: "Aevum Test USD",
    version: "1",
    decimals: 6,
    // Nonce semantics: "sequential" (TestUSD nonces(from) must equal the
    // auth nonce) vs "authorizationState" (FiatTokenV2: nonce is an
    // arbitrary bytes32, usable once; checked via authorizationState()).
    nonceMode: "sequential",
  },

  // Price per paid call: $0.01 = 10_000 base units of a 6-decimal token.
  price: 10000,
  priceDisplay: "$0.01",

  // Seller wallet (phase 1 placeholder — a fresh throwaway testnet-only
  // keypair is generated in phase 2 and this address is replaced with it.
  // NEVER the user's Binance Agentic Wallet.)
  seller: "0x302D022788fdbDF6194D3ba4027365C7202f2B18",

  // Authorization validity window (seconds).
  authTtlSeconds: 600,

  // Server.
  port: Number(process.env.PORT || 8787),
  host: "127.0.0.1",
};

// --- Accepted payment tokens (phase 3, dual-token) ---
// aUSD is CONFIG.token above (the deployed TestUSD). tUSD8 is the
// challenge's OFFICIAL test stablecoin (FiatTokenV2 proxy on Aevum
// testnet, 6 decimals, 259 holders 2026-11-17). EIP-712 domain
// VERIFIED 2026-11-17: domainSeparator({name:"tUSD8", version:"2",
// chainId:44005, verifyingContract:tUSD8}) == on-chain
// DOMAIN_SEPARATOR() 0x7838e6c46f8f9874236c9747d9896552a03d22c7c3e701b198879de2cb658022.
// Both tokens settle by the same EIP-3009 transferWithAuthorization
// (same ABI + typehash); only the domain and the nonce semantics differ.
CONFIG.tokens = {
  ausd: CONFIG.token,
  tusd8: {
    address: "0x456569838f1d43009A91ebA4263147Afd7233483",
    symbol: "tUSD8",
    name: "tUSD8",
    version: "2",
    decimals: 6,
    nonceMode: "authorizationState",
  },
};

// Resolve a token by address (case-insensitive) or symbol ("ausd"/"tusd8").
// No asset given -> aUSD (backward compatible with phase-2 buyers/tests).
// Returns the token object, or null when the asset is not accepted.
CONFIG.tokenFor = (asset) => {
  if (asset === undefined || asset === null || asset === "") return CONFIG.token;
  const a = String(asset).toLowerCase();
  const byAddress = Object.values(CONFIG.tokens).find(
    (t) => t.address.toLowerCase() === a
  );
  if (byAddress) return byAddress;
  return Object.values(CONFIG.tokens).find((t) => t.symbol.toLowerCase() === a) || null;
};

// --- Env overrides (tests + live runs) ---
// AEVUM_RPC: point the server/buyer/chain client at a local anvil.
// AEVUM_TOKEN_ADDRESS/NAME/SYMBOL/VERSION: the deployed TestUSD.
// AEVUM_SELLER: override the seller address (live mode normally takes it
// from the deployer key file instead).
if (process.env.AEVUM_RPC) CONFIG.rpc = process.env.AEVUM_RPC;
if (process.env.AEVUM_TOKEN_ADDRESS) CONFIG.token.address = process.env.AEVUM_TOKEN_ADDRESS;
if (process.env.AEVUM_TOKEN_NAME) CONFIG.token.name = process.env.AEVUM_TOKEN_NAME;
if (process.env.AEVUM_TOKEN_SYMBOL) CONFIG.token.symbol = process.env.AEVUM_TOKEN_SYMBOL;
if (process.env.AEVUM_TOKEN_VERSION) CONFIG.token.version = process.env.AEVUM_TOKEN_VERSION;
if (process.env.AEVUM_SELLER) CONFIG.seller = process.env.AEVUM_SELLER;
