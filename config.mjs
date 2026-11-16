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

  // Payment token (phase 1): tUSD8, the closest thing to a test USD on
  // Aevum testnet — ERC-20, 6 decimals, 189 holders, verified on the
  // explorer 2026-11-16. Bytecode check PROVED it has NO EIP-3009
  // (no transferWithAuthorization selector), so phase 2 deploys a minimal
  // test ERC-20 WITH transferWithAuthorization and swaps these three
  // fields (address, name, version). The EIP-712 domain below is built
  // from these fields, so only this file changes in phase 2.
  token: {
    address: "0xF5506234c9185d1D4262615504093DA671a61712",
    symbol: "aUSD",
    name: "Aevum Test USD",
    version: "1",
    decimals: 6,
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
