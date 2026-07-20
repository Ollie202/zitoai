import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";
import { shutterstockApiBase } from "../services/shutterstock.js";

export const shutterstockProvider = {
  id: "shutterstock", name: "Shutterstock", status: "image_license_ready",
  requiresApiKey: true, supportedAssetTypes: ["image"],
  isConfigured: () => Boolean(config.credentials.shutterstock.accessToken),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Shutterstock access token is not configured");
    const body = await fetchShutterstockImages(brief, limit);
    return (body.data || []).map((item) => ({
      id: String(item.id), provider: "shutterstock", title: item.description || `Shutterstock image ${item.id}`,
      creator: item.contributor?.display_name || "Shutterstock contributor", assetType: "image",
      previewUrl: item.assets?.preview_1500?.url || item.assets?.preview?.url || item.assets?.small_thumb?.url || null,
      mediaUrl: null,
      sourceUrl: `https://www.shutterstock.com/image-photo/${item.id}`,
      purchaseUrl: `https://www.shutterstock.com/image-photo/${item.id}`,
      licenseUrl: "https://www.shutterstock.com/api/pricing",
      priceUsd: null,
      license: { code: "shutterstock-platform", name: "Shutterstock Platform License", url: "https://www.shutterstock.com/api/pricing", attributionRequired: false },
      metadata: {
        aspect: item.aspect,
        categories: item.categories || [],
        keywords: item.keywords || [],
        editorial: item.is_editorial,
        height: item.height,
        width: item.width,
        rawDownload: false,
        shutterstockLicenseEndpoint: "/api/providers/shutterstock/license",
        searchFallbackUsed: Boolean(body.metadata?.fallbackReason),
      },
    }));
  },
};

export const freesoundProvider = {
  id: "freesound", name: "Freesound", status: "commercial_approval_required",
  requiresApiKey: true, supportedAssetTypes: ["sound_effect"],
  isConfigured: () => Boolean(config.credentials.freesound.apiKey),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Freesound API key is not configured");
    const body = await fetchFreesoundSounds(brief, limit);
    return (body.results || []).map((item) => ({
      id: String(item.id), provider: "freesound", title: item.name, creator: item.username || "Freesound contributor",
      assetType: brief.assetType, previewUrl: item.previews?.["preview-hq-mp3"] || item.previews?.["preview-lq-ogg"] || item.previews?.["preview-lq-mp3"] || null,
      mediaUrl: null, sourceUrl: item.url || `https://freesound.org/people/${encodeURIComponent(item.username || "")}/sounds/${item.id}/`, priceUsd: 0,
      licenseUrl: item.license || "https://freesound.org/help/tos_api/",
      license: { code: item.license || null, name: item.license || null, url: "https://freesound.org/help/tos_api/", attributionRequired: item.license !== "Creative Commons 0" },
      metadata: { duration: item.duration, tags: item.tags || [], description: item.description || null, apiCommercialApprovalRequired: true, oauth2RequiredForOriginalDownload: true, searchFallbackUsed: Boolean(body.metadata?.fallbackReason) },
    }));
  },
};

export const jamendoProvider = {
  id: "jamendo", name: "Jamendo", status: "music_catalog_ready_terms_capture_only",
  requiresApiKey: true, supportedAssetTypes: ["music"],
  isConfigured: () => Boolean(config.credentials.jamendo.clientId),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Jamendo client ID is not configured");
    const body = await fetchJamendoTracks(brief, limit);
    return (body.results || []).map((item) => ({
      id: String(item.id), provider: "jamendo", title: item.name, creator: item.artist_name || "Jamendo artist",
      assetType: "music",
      previewUrl: item.audio || null,
      mediaUrl: item.audiodownload_allowed ? item.audiodownload || null : null,
      sourceUrl: item.shareurl || `https://www.jamendo.com/track/${item.id}`,
      purchaseUrl: item.prourl || item.shareurl || `https://www.jamendo.com/track/${item.id}`,
      licenseUrl: item.prourl || item.license_ccurl || item.shareurl || `https://www.jamendo.com/track/${item.id}`,
      priceUsd: 0,
      license: {
        code: item.license_ccurl || "jamendo-license",
        name: item.prourl ? "Jamendo licensing handoff" : item.license_ccurl || "Jamendo track license",
        url: item.prourl || item.license_ccurl || "https://developer.jamendo.com/v3.0/docs",
        attributionRequired: true,
      },
      metadata: {
        artistId: item.artist_id || null,
        albumId: item.album_id || null,
        album: item.album_name,
        image: item.image || item.album_image || null,
        duration: item.duration,
        position: item.position ?? null,
        releasedate: item.releasedate || null,
        musicInfoLoaded: Boolean(item.musicinfo),
        tags: flattenJamendoTags(item.musicinfo?.tags),
        description: item.musicinfo?.description || null,
        musicinfo: item.musicinfo || null,
        licenses: item.licenses || null,
        licenseUrl: item.license_ccurl || null,
        proLicenseUrl: item.prourl || null,
        audiodownloadAllowed: item.audiodownload_allowed ?? null,
        rawDownloadUrl: item.audiodownload_allowed ? item.audiodownload || null : null,
        contentIdFree: item.content_id_free ?? null,
        commercialProgramMatched: Boolean(item.prourl) || Boolean(brief.commercial),
        checkoutEvidenceRequired: true,
        licenseCertificateRequired: true,
        deterministicCommercialGate: true,
        jamendoReadOnlyApi: true,
      },
    }));
  },
};

export const gatedProviders = [shutterstockProvider, freesoundProvider, jamendoProvider];

async function fetchShutterstockImages(brief, limit) {
  const candidates = shutterstockQueryCandidates(brief);
  let firstUrl = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const url = buildShutterstockSearchUrl(candidates[index], limit);
    if (!firstUrl) firstUrl = url;
    const body = await fetchJsonWithRetry(url, { headers: { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` } });
    if ((body.data || []).length > 0) {
      return index === 0
        ? body
        : {
            ...body,
            metadata: {
              ...(body.metadata || {}),
              fallbackFrom: firstUrl.toString(),
              fallbackReason: "primary_shutterstock_search_returned_zero_results",
              fallbackQuery: candidates[index],
            },
          };
    }
  }
  return fetchJsonWithRetry(buildShutterstockSearchUrl(candidates[0], limit), { headers: { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` } });
}

function buildShutterstockSearchUrl(query, limit) {
  const url = new URL(`${shutterstockApiBase()}/images/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("view", "full");
  url.searchParams.set("safe", "true");
  return url;
}

function shutterstockQueryCandidates(brief) {
  const candidates = [];
  const primary = String(brief.query || "").trim();
  const original = String(brief.originalQuery || "").trim();
  const keywords = Array.isArray(brief.keywords) ? brief.keywords.map((word) => String(word).trim()).filter(Boolean) : [];
  if (primary) candidates.push(primary);
  if (original && original !== primary) candidates.push(original);
  if (keywords.length) candidates.push(keywords.join(" "));
  for (const word of keywords.slice(0, 5)) candidates.push(word);
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchFreesoundSounds(brief, limit) {
  const candidates = freesoundQueryCandidates(brief);
  let firstUrl = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const url = buildFreesoundSearchUrl(candidates[index], limit);
    if (!firstUrl) firstUrl = url;
    const body = await fetchJsonWithRetry(url);
    if ((body.results || []).length > 0) {
      return index === 0
        ? body
        : {
            ...body,
            metadata: {
              ...(body.metadata || {}),
              fallbackFrom: firstUrl.toString(),
              fallbackReason: "primary_freesound_search_returned_zero_results",
              fallbackQuery: candidates[index],
            },
          };
    }
  }
  const finalBody = await fetchJsonWithRetry(buildFreesoundSearchUrl(candidates[0], limit));
  return finalBody;
}

function buildFreesoundSearchUrl(query, limit) {
  const url = new URL("https://freesound.org/apiv2/search/text/");
  url.searchParams.set("query", query);
  url.searchParams.set("token", config.credentials.freesound.apiKey);
  url.searchParams.set("page_size", String(limit));
  url.searchParams.set("fields", "id,name,username,license,previews,duration,tags,description,url");
  url.searchParams.set("group_by_pack", "0");
  return url;
}

function usefulFreesoundKeywords(brief) {
  const generic = new Set([
    "background",
    "brand",
    "campaign",
    "commercial",
    "content",
    "effect",
    "find",
    "for",
    "from",
    "app",
    "need",
    "meditation",
    "sound",
    "sfx",
    "video",
  ]);
  const text = `${brief.query} ${brief.originalQuery || ""} ${(brief.keywords || []).join(" ")}`.toLowerCase();
  return Array.from(new Set(text
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !generic.has(word))))
    .slice(0, 8);
}

function freesoundQueryCandidates(brief) {
  const keywords = usefulFreesoundKeywords(brief);
  const candidates = [];
  const primary = String(brief.query || "").trim();
  const original = String(brief.originalQuery || "").trim();
  if (primary) candidates.push(primary);
  if (original && original !== primary) candidates.push(original);
  const translatedHints = translatedFreesoundHints(`${primary} ${original}`);
  if (translatedHints.length) candidates.push(translatedHints.join(" "));
  if (keywords.length) candidates.push(keywords.join(" "));
  for (const word of keywords.slice(0, 5)) candidates.push(word);
  return Array.from(new Set(candidates.filter(Boolean)));
}

function translatedFreesoundHints(text) {
  const lower = String(text || "").toLowerCase();
  const hints = [];
  if (/аплодис|applaus|aplaus|aplauso|تصفيق|拍手|박수|ताल/.test(lower)) hints.push("applause", "clapping", "crowd");
  if (/дожд|lluvia|chuva|pioggia|pluie|雨|비|बारिश|مطر/.test(lower)) hints.push("rain", "ambience");
  if (/взрыв|explos|explosión|explosao|explosão|爆発|폭발|विस्फोट|انفجار/.test(lower)) hints.push("explosion", "impact");
  if (/уведом|notifica|通知|알림|सूचना|تنبيه/.test(lower)) hints.push("notification", "alert", "tone");
  if (/click|clic|클릭|点击|點擊|クリック/.test(lower)) hints.push("click", "button", "ui");
  if (/vinyl|noise|noises|black.?vinyl|黑胶|黑膠|噪音|노이즈|ノイズ/.test(lower)) hints.push("vinyl", "noise", "crackle");
  return Array.from(new Set(hints));
}

function flattenJamendoTags(tags = {}) {
  if (!tags || typeof tags !== "object") return [];
  return Object.values(tags).flatMap((value) => Array.isArray(value) ? value : []).filter(Boolean);
}

async function fetchJamendoTracks(brief, limit) {
  const primary = buildJamendoTracksUrl(brief, limit, { mode: "primary" });
  const primaryBody = await fetchJamendoResponse(primary);
  if ((primaryBody.results || []).length > 0) return primaryBody;

  const fallback = buildJamendoTracksUrl(brief, limit, { mode: "discovery" });
  const fallbackBody = await fetchJamendoResponse(fallback);
  if ((fallbackBody.results || []).length > 0) {
    return {
      ...fallbackBody,
      metadata: {
        ...(fallbackBody.metadata || {}),
        fallbackFrom: primary.toString(),
        fallbackReason: "primary_jamendo_search_returned_zero_results",
      },
    };
  }

  const broad = buildJamendoTracksUrl(brief, limit, { mode: "broad" });
  const broadBody = await fetchJamendoResponse(broad);
  return {
    ...broadBody,
    metadata: {
      ...(broadBody.metadata || {}),
      fallbackFrom: primary.toString(),
      fallbackReason: "primary_and_keyword_jamendo_search_returned_zero_results",
    },
  };
}

async function fetchJamendoResponse(url) {
  const body = await fetchJsonWithRetry(url);
  if (body.headers?.status === "failed") {
    throw new Error(body.headers.error_message || "Jamendo search failed");
  }
  return body;
}

async function fetchJsonWithRetry(url, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      const retryableStatus = !error.status || [408, 425, 429, 500, 502, 503, 504].includes(error.status);
      if (!retryableStatus || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function buildJamendoTracksUrl(brief, limit, { mode }) {
  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  const keywords = Array.from(new Set([...translatedJamendoHints(`${brief.query} ${brief.originalQuery || ""}`), ...usefulJamendoKeywords(brief)]));

  url.searchParams.set("client_id", config.credentials.jamendo.clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", mode === "discovery" || mode === "broad" ? "popularity_total" : "relevance");
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("audiodlformat", "mp32");
  url.searchParams.set("include", "musicinfo licenses");
  url.searchParams.set("groupby", "artist_id");
  url.searchParams.set("type", "single albumtrack");

  if (mode === "primary") {
    url.searchParams.set("search", brief.query);
  }

  if (brief.commercial) {
    url.searchParams.set("prolicensing", "1");
  }

  if (needsContentIdSafeTrack(brief)) {
    url.searchParams.set("content_id_free", "1");
  }

  if (mode !== "broad" && keywords.length) {
    url.searchParams.set("fuzzytags", keywords.join(" "));
  }

  if (wantsInstrumental(brief)) {
    url.searchParams.set("vocalinstrumental", "instrumental");
  }

  const speed = requestedSpeed(brief);
  if (speed) {
    url.searchParams.set("speed", speed);
  }

  return url;
}

function usefulJamendoKeywords(brief) {
  const generic = new Set([
    "advert",
    "advertising",
    "background",
    "brand",
    "campaign",
    "commercial",
    "content",
    "license",
    "licensing",
    "music",
    "song",
    "track",
    "video",
  ]);
  return Array.from(new Set((brief.keywords || [])
    .map((word) => String(word).toLowerCase().trim())
    .filter((word) => word.length > 2 && !generic.has(word))))
    .slice(0, 6);
}

function translatedJamendoHints(text) {
  const lower = String(text || "").toLowerCase();
  const hints = [];
  if (/مرح|مرحة|لعبة|أطفال/.test(lower)) hints.push("happy", "playful", "children", "game");
  if (/غامض|gizem|gizemli|myster/.test(lower)) hints.push("mysterious", "dark", "electronic", "documentary");
  if (/怀旧|懷舊|nostalg|ностальг/.test(lower)) hints.push("nostalgic", "emotional");
  if (/钢琴|鋼琴|piano|фортеп/.test(lower)) hints.push("piano");
  if (/documentary|纪录片|紀錄片|belgesel/.test(lower)) hints.push("documentary");
  if (/광고|广告|廣告|reklam|إعلان/.test(lower)) hints.push("advertising", "commercial");
  return hints.slice(0, 8);
}

function wantsInstrumental(brief) {
  const text = `${brief.query} ${brief.originalQuery || ""} ${brief.intendedUse || ""}`.toLowerCase();
  return /\binstrumental\b|\bno vocals?\b|\bvoiceover\b|\bbackground\b/.test(text);
}

function requestedSpeed(brief) {
  const text = `${brief.query} ${brief.originalQuery || ""} ${(brief.keywords || []).join(" ")}`.toLowerCase();
  if (/\bfast\b|\bupbeat\b|\benergetic\b|\bhigh energy\b/.test(text)) return "high";
  if (/\bslow\b|\bcalm\b|\bsoft\b|\brelax(ed|ing)?\b/.test(text)) return "low";
  return null;
}

function needsContentIdSafeTrack(brief) {
  const text = `${brief.query} ${brief.originalQuery || ""} ${brief.intendedUse || ""}`.toLowerCase();
  return brief.broadcast || /\byoutube\b|\bcontent id\b|\bmoneti[sz]ed\b|\bsocial\b|\btiktok\b|\breels?\b/.test(text);
}
