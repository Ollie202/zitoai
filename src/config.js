export const config = {
  port: Number(process.env.PORT || 3000),
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    fastModel:
      process.env.OPENROUTER_FAST_MODEL || "openai/gpt-4o-mini",
    smartModel:
      process.env.OPENROUTER_SMART_MODEL || "google/gemini-2.5-flash",
    siteUrl: process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    appName: process.env.OPENROUTER_APP_NAME || "ZitoAI",
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    evidenceBucket: process.env.SUPABASE_EVIDENCE_BUCKET || "license-evidence",
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
