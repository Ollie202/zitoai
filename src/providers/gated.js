import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

const jsonHeaders = { "Content-Type": "application/json" };

export const adobeStockProvider = {
  id: "adobe_stock",
  name: "Adobe Stock",
  status: "approval_required",
  requiresApiKey: true,
  supportedAssetTypes: ["image", "video"],
  isConfigured: () => Boolean(config.credentials.adobe.apiKey),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Adobe Stock credentials are not configured");
    const url = new URL("https://stock.adobe.io/Rest/Media/1/Search/Files");
    url.searchParams.set("search_parameters[words]", brief.query);
    url.searchParams.set("search_parameters[limit]", String(limit));
    url.searchParams.set("search_parameters[filters][content_type:photo]", brief.assetType === "image" ? "1" : "0");
    const body = await fetchJson(url, {
      headers: { "x-api-key": config.credentials.adobe.apiKey, "x-product": "LicenseHunter/0.1" },
    });
    return (body.files || []).map((item) => ({
      id: String(item.id), provider: "adobe_stock", title: item.title || "Adobe Stock asset",
      creator: item.creator?.name || "Adobe Stock contributor", assetType: brief.assetType,
      previewUrl: item.thumbnail_url || item.thumbnail?.url || null, mediaUrl: null,
      sourceUrl: `https://stock.adobe.com/asset/${item.id}`, priceUsd: null,
      license: { code: "adobe-stock", name: "Adobe Stock license", url: "https://stock.adobe.com/license-terms", attributionRequired: false },
      metadata: { category: item.category, width: item.width, height: item.height, requiresCustomerOAuth: true },
    }));
  },
};

export const shutterstockProvider = {
  id: "shutterstock", name: "Shutterstock", status: "free_test_images_only",
  requiresApiKey: true, supportedAssetTypes: ["image"],
  isConfigured: () => Boolean(config.credentials.shutterstock.accessToken),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Shutterstock access token is not configured");
    const url = new URL("https://api.shutterstock.com/v2/images/search");
    url.searchParams.set("query", brief.query); url.searchParams.set("per_page", String(limit));
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` } });
    return (body.data || []).map((item) => ({
      id: String(item.id), provider: "shutterstock", title: item.description || `Shutterstock image ${item.id}`,
      creator: item.contributor?.display_name || "Shutterstock contributor", assetType: "image",
      previewUrl: item.assets?.preview?.url || item.assets?.small_thumb?.url || null, mediaUrl: null,
      sourceUrl: `https://www.shutterstock.com/image-photo/${item.id}`, priceUsd: null,
      license: { code: "shutterstock-platform", name: "Shutterstock Platform License", url: "https://www.shutterstock.com/api/pricing", attributionRequired: false },
      metadata: { aspect: item.aspect, editorial: item.is_editorial, rawDownload: false },
    }));
  },
};

export const freesoundProvider = {
  id: "freesound", name: "Freesound", status: "commercial_approval_required",
  requiresApiKey: true, supportedAssetTypes: ["sound_effect", "music"],
  isConfigured: () => Boolean(config.credentials.freesound.apiKey),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Freesound API key is not configured");
    const url = new URL("https://freesound.org/apiv2/search/text/");
    url.searchParams.set("query", brief.query); url.searchParams.set("token", config.credentials.freesound.apiKey);
    url.searchParams.set("page_size", String(limit)); url.searchParams.set("fields", "id,name,username,license,previews,duration,tags");
    const body = await fetchJson(url);
    return (body.results || []).map((item) => ({
      id: String(item.id), provider: "freesound", title: item.name, creator: item.username || "Freesound contributor",
      assetType: brief.assetType, previewUrl: item.previews?.["preview-hq-mp3"] || item.previews?.["preview-lq-mp3"] || null,
      mediaUrl: null, sourceUrl: `https://freesound.org/people/${encodeURIComponent(item.username || "")}/sounds/${item.id}/`, priceUsd: 0,
      license: { code: item.license || null, name: item.license || null, url: "https://freesound.org/help/tos_api/", attributionRequired: item.license !== "Creative Commons 0" },
      metadata: { duration: item.duration, tags: item.tags, apiCommercialApprovalRequired: true },
    }));
  },
};

export const jamendoProvider = {
  id: "jamendo", name: "Jamendo", status: "commercial_api_approval_required",
  requiresApiKey: true, supportedAssetTypes: ["music"],
  isConfigured: () => Boolean(config.credentials.jamendo.clientId),
  async search(brief, limit) {
    if (!this.isConfigured()) throw new Error("Jamendo client ID is not configured");
    const url = new URL("https://api.jamendo.com/v3.0/tracks/");
    url.searchParams.set("client_id", config.credentials.jamendo.clientId); url.searchParams.set("format", "json");
    url.searchParams.set("namesearch", brief.query); url.searchParams.set("limit", String(limit));
    url.searchParams.set("audioformat", "mp32"); url.searchParams.set("include", "musicinfo");
    const body = await fetchJson(url);
    return (body.results || []).map((item) => ({
      id: String(item.id), provider: "jamendo", title: item.name, creator: item.artist_name || "Jamendo artist",
      assetType: "music", previewUrl: item.audio || item.audiodownload || null, mediaUrl: null,
      sourceUrl: item.shareurl || `https://www.jamendo.com/track/${item.id}`, priceUsd: null,
      license: { code: "jamendo-license", name: "Jamendo license (verify intended use)", url: "https://developer.jamendo.com/v3.0/docs", attributionRequired: true },
      metadata: { album: item.album_name, duration: item.duration, commercialApiApprovalRequired: true },
    }));
  },
};

export const gatedProviders = [adobeStockProvider, shutterstockProvider, freesoundProvider, jamendoProvider];
