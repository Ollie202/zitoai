export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://www.zitoai.xyz",
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
    callbackBaseUrl: process.env.OAUTH_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.OPENROUTER_SITE_URL || "https://www.zitoai.xyz",
    stateSecret: process.env.OAUTH_STATE_SECRET || "",
    tokenEncryptionKey: process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "",
    adobe: {
      clientId: process.env.ADOBE_STOCK_CLIENT_ID || "",
      clientSecret: process.env.ADOBE_STOCK_CLIENT_SECRET || "",
      scopes: process.env.ADOBE_STOCK_SCOPES || "openid,creative_sdk,offline_access",
    },
    freesound: {
      clientId: process.env.FREESOUND_CLIENT_ID || "",
      clientSecret: process.env.FREESOUND_CLIENT_SECRET || "",
    },
    shutterstock: {
      clientId: process.env.SHUTTERSTOCK_CLIENT_ID || "",
      clientSecret: process.env.SHUTTERSTOCK_CLIENT_SECRET || "",
      authorizeUrl: process.env.SHUTTERSTOCK_AUTHORIZE_URL || "",
      tokenUrl: process.env.SHUTTERSTOCK_TOKEN_URL || "",
      scopes: process.env.SHUTTERSTOCK_SCOPES || "",
    },
  },
  providers: {
    openverse: process.env.OPENVERSE_BASE_URL || "https://api.openverse.org/v1",
    wikimedia:
      process.env.WIKIMEDIA_API_URL ||
      "https://commons.wikimedia.org/w/api.php",
    freeToUse:
      process.env.FREETOUSE_BASE_URL || "https://api.freetouse.com/v3",
    stockfilm:
      process.env.STOCKFILM_BASE_URL || "https://api.stockfilm.com/x402",
  },
  credentials: {
    adobe: { apiKey: process.env.ADOBE_STOCK_API_KEY || "" },
    shutterstock: { accessToken: process.env.SHUTTERSTOCK_ACCESS_TOKEN || "" },
    freesound: { apiKey: process.env.FREESOUND_API_KEY || "" },
    jamendo: { clientId: process.env.JAMENDO_CLIENT_ID || "" },
  },
};
