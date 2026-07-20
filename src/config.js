import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(resolve(process.cwd(), "local.env"));
loadEnvFile(resolve(process.cwd(), ".env"));

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://www.zitoai.xyz",
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
    amount: process.env.OKX_PAYMENT_AMOUNT || "0",
    priceUsd: process.env.OKX_PAYMENT_PRICE_USD || "0 USDT",
    syncSettle: parseBoolean(process.env.OKX_PAYMENT_SYNC_SETTLE),
  },
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    fastModel:
      process.env.OPENROUTER_FAST_MODEL || "google/gemini-2.5-flash-lite",
    smartModel:
      process.env.OPENROUTER_SMART_MODEL || "openai/gpt-4o-mini",
    siteUrl: process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_BASE_URL || "https://www.zitoai.xyz",
    appName: process.env.OPENROUTER_APP_NAME || "ZitoAI",
    maxSpendUsd: parseOptionalNumber(process.env.OPENROUTER_MAX_SPEND_USD),
    maxCallsPerMinute: Number(process.env.OPENROUTER_MAX_CALLS_PER_MINUTE || 20),
    maxInputChars: Number(process.env.OPENROUTER_MAX_INPUT_CHARS || 12000),
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
