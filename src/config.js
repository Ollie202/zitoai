import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(resolve(process.cwd(), "local.env"));
loadEnvFile(resolve(process.cwd(), ".env"));

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://www.zitoai.xyz",
  aspBaseUrl: process.env.ASP_BASE_URL || process.env.PUBLIC_BASE_URL || "https://asp.zitoai.xyz",
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    fastModel:
      process.env.OPENROUTER_FAST_MODEL || "openai/gpt-4o-mini",
    smartModel:
      process.env.OPENROUTER_SMART_MODEL || "google/gemini-2.5-flash",
    siteUrl: process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_BASE_URL || "https://www.zitoai.xyz",
    appName: process.env.OPENROUTER_APP_NAME || "ZitoAI",
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
