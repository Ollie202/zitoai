import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

export const shutterstockProvider = {
  id: "shutterstock", name: "Shutterstock", status: "image_license_ready",
  requiresApiKey: true, supportedAssetTypes: ["image"],
  isConfigured: () => Boolean(config.credentials.shutterstock.accessToken),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Shutterstock access token is not configured");
    const url = new URL("https://api.shutterstock.com/v2/images/search");
    url.searchParams.set("query", brief.query);
    url.searchParams.set("per_page", String(limit));
    url.searchParams.set("view", "full");
    url.searchParams.set("safe", "true");
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` } });
    return (body.data || []).map((item) => ({
      id: String(item.id), provider: "shutterstock", title: item.description || `Shutterstock image ${item.id}`,
      creator: item.contributor?.display_name || "Shutterstock contributor", assetType: "image",
      previewUrl: item.assets?.preview_1500?.url || item.assets?.preview?.url || item.assets?.small_thumb?.url || null,
      mediaUrl: null,
      sourceUrl: `https://www.shutterstock.com/image-photo/${item.id}`,
      purchaseUrl: `https://www.shutterstock.com/image-photo/${item.id}`,
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
    const url = new URL("https://freesound.org/apiv2/search/text/");
    url.searchParams.set("query", brief.query);
    url.searchParams.set("token", config.credentials.freesound.apiKey);
    url.searchParams.set("page_size", String(limit));
    url.searchParams.set("fields", "id,name,username,license,previews,duration,tags,description,url");
    url.searchParams.set("group_by_pack", "0");
    const body = await fetchJson(url);
    return (body.results || []).map((item) => ({
      id: String(item.id), provider: "freesound", title: item.name, creator: item.username || "Freesound contributor",
      assetType: brief.assetType, previewUrl: item.previews?.["preview-hq-mp3"] || item.previews?.["preview-lq-ogg"] || item.previews?.["preview-lq-mp3"] || null,
      mediaUrl: null, sourceUrl: item.url || `https://freesound.org/people/${encodeURIComponent(item.username || "")}/sounds/${item.id}/`, priceUsd: 0,
      license: { code: item.license || null, name: item.license || null, url: "https://freesound.org/help/tos_api/", attributionRequired: item.license !== "Creative Commons 0" },
      metadata: { duration: item.duration, tags: item.tags || [], description: item.description || null, apiCommercialApprovalRequired: true, oauth2RequiredForOriginalDownload: true },
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
  return {
    ...fallbackBody,
    metadata: {
      ...(fallbackBody.metadata || {}),
      fallbackFrom: primary.toString(),
      fallbackReason: "primary_jamendo_search_returned_zero_results",
    },
  };
}

async function fetchJamendoResponse(url) {
  const body = await fetchJson(url);
  if (body.headers?.status === "failed") {
    throw new Error(body.headers.error_message || "Jamendo search failed");
  }
  return body;
}

function buildJamendoTracksUrl(brief, limit, { mode }) {
  const url = new URL("https://api.jamendo.com/v3.0/tracks/");
  const keywords = usefulJamendoKeywords(brief);

  url.searchParams.set("client_id", config.credentials.jamendo.clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", mode === "discovery" ? "popularity_total" : "relevance");
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

  if (keywords.length) {
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

function wantsInstrumental(brief) {
  const text = `${brief.query} ${brief.intendedUse || ""}`.toLowerCase();
  return /\binstrumental\b|\bno vocals?\b|\bvoiceover\b|\bbackground\b/.test(text);
}

function requestedSpeed(brief) {
  const text = `${brief.query} ${(brief.keywords || []).join(" ")}`.toLowerCase();
  if (/\bfast\b|\bupbeat\b|\benergetic\b|\bhigh energy\b/.test(text)) return "high";
  if (/\bslow\b|\bcalm\b|\bsoft\b|\brelax(ed|ing)?\b/.test(text)) return "low";
  return null;
}

function needsContentIdSafeTrack(brief) {
  const text = `${brief.query} ${brief.intendedUse || ""}`.toLowerCase();
  return brief.broadcast || /\byoutube\b|\bcontent id\b|\bmoneti[sz]ed\b|\bsocial\b|\btiktok\b|\breels?\b/.test(text);
}
