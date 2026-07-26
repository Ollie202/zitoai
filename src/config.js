import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(resolve(process.cwd(), "local.env"));
loadEnvFile(resolve(process.cwd(), ".env"));

export const config = {
  port: Number(process.env.PORT || 3000),
  // Defaults to the ASP origin, which serves the browser UI as well as the API. A
  // separate www host was advertised here in the agent card while returning nothing, so
  // the fallback is now the origin that actually answers.
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://asp.zitoai.xyz",
  aspBaseUrl: process.env.ASP_BASE_URL || process.env.PUBLIC_BASE_URL || "https://asp.zitoai.xyz",
  payment: {
    apiKey: process.env.OKX_API_KEY || "",
    secretKey: process.env.OKX_SECRET_KEY || "",
    passphrase: process.env.OKX_PASSPHRASE || "",
    payToAddress: process.env.PAY_TO_ADDRESS || process.env.OKX_PAYMENT_PAY_TO_ADDRESS || "",
    baseUrl: process.env.OKX_BASE_URL || "https://web3.okx.com",
    network: process.env.OKX_PAYMENT_NETWORK || "eip155:196",
    assetAddress:
      process.env.OKX_PAYMENT_ASSET ||
      process.env.OKX_PAYMENT_TOKEN_ADDRESS ||
      "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    // EIP-712 domain of the payment token. A payer signs the EIP-3009
    // transferWithAuthorization against exactly these, so a wrong value here produces
    // signatures that can never verify. Verified against the token's on-chain
    // DOMAIN_SEPARATOR: recomputing it with name "USD₮0" and version "1" reproduces
    // 0xd591d9ba… exactly, and these match @okxweb3/x402-evm's own registry entry for
    // eip155:196. Note the token has no version() getter, so "1" cannot be read back —
    // it is only recoverable by reproducing the separator.
    //
    // Carrying name+version and naming no transfer method is precisely how the OKX SDK
    // encodes "pay this with EIP-3009": its exact-scheme server emits assetTransferMethod
    // only for assets that need a non-default method (permit2), and USD₮0 does not.
    assetName: process.env.OKX_PAYMENT_ASSET_NAME || "USD₮0",
    assetVersion: process.env.OKX_PAYMENT_ASSET_VERSION || "1",
    // Verified on chain: the token's decimals() returns 6.
    assetDecimals: Number(process.env.OKX_PAYMENT_ASSET_DECIMALS || 6),
    // Minimal units at 6 decimals: "0" is a free call, 10000 would be 0.01 USD₮0.
    //
    // A zero price does not weaken the authorization. Checked against the live OKX
    // facilitator: at amount 0 it still verifies the EIP-3009 signature in full and
    // returns invalid_signature for a forged `from`, a garbage signature, or a rewritten
    // `to` — only an honest authorization comes back valid. So a caller still has to
    // produce a real signed EIP-3009 authorization to be served; the sole difference is
    // that nothing is transferred, which is why settlement is skipped at 0 rather than
    // reporting a transfer that never happened.
    amount: process.env.OKX_PAYMENT_AMOUNT || "0",
    // How long a challenge stays valid. Clients use it to size the signature window.
    maxTimeoutSeconds: Number(process.env.OKX_PAYMENT_MAX_TIMEOUT_SECONDS || 300),
    assetSymbol: process.env.OKX_PAYMENT_ASSET_SYMBOL || "USDT",
    // Display label only — the manifest, agent card and health route. Left unset it is
    // derived from `amount` and the token's decimals, because these were two independent
    // values: repricing via OKX_PAYMENT_AMOUNT alone would keep advertising the old
    // figure while charging the new one. Set it only to override the wording.
    priceUsd: process.env.OKX_PAYMENT_PRICE_USD || "",
    // Ask the facilitator to settle synchronously so the PAYMENT-RESPONSE carries a real
    // transaction hash rather than a pending status.
    syncSettle: parseBoolean(process.env.OKX_PAYMENT_SYNC_SETTLE ?? "true"),
  },
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    // parse_brief carries the product: it detects the language and produces the English
    // query the providers actually receive. Benchmarked over 120 parses across 20
    // languages, gemini-2.5-flash was the only model perfect on meaning, asset type and
    // language detection with zero run-to-run variance, so it takes the harder job.
    fastModel:
      process.env.OPENROUTER_FAST_MODEL || "google/gemini-2.5-flash",
    // rank_results only reorders candidates the providers already returned, and its
    // output is validated against that set, so the cheaper cross-provider model is used.
    smartModel:
      process.env.OPENROUTER_SMART_MODEL || "openai/gpt-4o-mini",
    // Fallbacks default to the other function's model, which is deliberately from a
    // different provider: a provider-wide incident then degrades one function's quality
    // instead of taking the whole AI layer down to the local parser.
    fastFallbackModel:
      process.env.OPENROUTER_FAST_FALLBACK_MODEL ||
      process.env.OPENROUTER_SMART_MODEL ||
      "openai/gpt-4o-mini",
    smartFallbackModel:
      process.env.OPENROUTER_SMART_FALLBACK_MODEL ||
      process.env.OPENROUTER_FAST_MODEL ||
      "google/gemini-2.5-flash",
    siteUrl: process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_BASE_URL || "https://asp.zitoai.xyz",
    appName: process.env.OPENROUTER_APP_NAME || "ZitoAI",
    // Defaults to an active ceiling rather than "unlimited". Left unset, the budget
    // guard silently never fired, because Number.isFinite(null) is false. Set
    // OPENROUTER_MAX_SPEND_USD=0 to intentionally disable spending entirely, or raise it
    // for a longer-running deployment.
    maxSpendUsd: parseOptionalNumber(process.env.OPENROUTER_MAX_SPEND_USD) ?? 25,
    // Each search costs two model calls, so this is half the searches per minute the
    // service can parse before it degrades to the local parser — which cannot translate.
    // At 20 that was 10 searches a minute across all callers, and a short burst of
    // testing silently turned non-English requests back into untranslated ones. The
    // cumulative spend ceiling is the real cost control; this one only needs to stop a
    // runaway loop.
    maxCallsPerMinute: Number(process.env.OPENROUTER_MAX_CALLS_PER_MINUTE || 120),
    maxInputChars: Number(process.env.OPENROUTER_MAX_INPUT_CHARS || 12000),
  },
  usage: {
    // The spend ceiling only means something if it survives a deploy, so durable
    // accounting is on whenever Supabase is configured.
    durableSpend: parseBoolean(process.env.USAGE_DURABLE_SPEND ?? "true"),
    // Off by default: with a single replica the in-memory limiter is correct and avoids
    // a database round trip on every request. Turn this on when scaling past one.
    sharedRateLimit: parseBoolean(process.env.USAGE_SHARED_RATE_LIMIT),
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    evidenceBucket: process.env.SUPABASE_EVIDENCE_BUCKET || "license-evidence",
  },
  oauth: {
    callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL || process.env.ASP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.OPENROUTER_SITE_URL || "https://asp.zitoai.xyz",
    stateSecret: process.env.OAUTH_STATE_SECRET || "",
    tokenEncryptionKey: process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "",
    freesound: {
      clientId: process.env.FREESOUND_CLIENT_ID || "",
      clientSecret: process.env.FREESOUND_CLIENT_SECRET || "",
    },
    shutterstock: {
      clientId: process.env.SHUTTERSTOCK_CLIENT_ID || "",
      clientSecret: process.env.SHUTTERSTOCK_CLIENT_SECRET || "",
      authorizeUrl: process.env.SHUTTERSTOCK_AUTHORIZE_URL || "https://api.shutterstock.com/v2/oauth/authorize",
      tokenUrl: process.env.SHUTTERSTOCK_TOKEN_URL || "https://api.shutterstock.com/v2/oauth/access_token",
      scopes: process.env.SHUTTERSTOCK_SCOPES || "licenses.create licenses.view purchases.view",
    },
  },
  credentials: {
    shutterstock: {
      accessToken: process.env.SHUTTERSTOCK_ACCESS_TOKEN || "",
      apiBase: process.env.SHUTTERSTOCK_API_BASE || "https://api.shutterstock.com/v2",
    },
    freesound: { apiKey: process.env.FREESOUND_API_KEY || "" },
    jamendo: { clientId: process.env.JAMENDO_CLIENT_ID || "" },
  },
};

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] != null && process.env[key] !== "") continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseOptionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}
