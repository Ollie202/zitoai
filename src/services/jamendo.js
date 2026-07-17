import { config } from "../config.js";

const JAMENDO_API_BASE = "https://api.jamendo.com/v3.0";

export function jamendoStatus() {
  return {
    provider: "jamendo",
    configured: Boolean(config.credentials.jamendo.clientId),
    apiBase: JAMENDO_API_BASE,
    mode: "read_only_catalog",
    endpoints: {
      tracks: `${JAMENDO_API_BASE}/tracks/`,
    },
    capabilities: [
      "music_search",
      "stream_preview",
      "track_metadata",
      "license_terms_capture",
      "commercial_license_handoff",
    ],
    limits: [
      "The standard catalog API uses a client_id and does not perform a paid license purchase for ZitoAI.",
      "Commercial usage must follow the returned Jamendo Pro/commercial licensing URL or a separate Jamendo agreement.",
      "OAuth/read-write access is for user/private/write actions, not required for normal public music catalog search.",
    ],
    docs: {
      catalog: "https://developer.jamendo.com/v3.0/docs",
      authentication: "https://developer.jamendo.com/v3.0/authentication",
    },
  };
}
