import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

export const openverseProvider = {
  id: "openverse",
  name: "Openverse",
  requiresApiKey: false,
  supportedAssetTypes: ["music", "sound_effect", "image"],

  async search(brief, limit) {
    const mediaPath = brief.assetType === "image" ? "images" : "audio";
    const url = new URL(`${config.providers.openverse}/${mediaPath}/`);
    url.searchParams.set("q", brief.query);
    url.searchParams.set("page_size", String(limit));
    if (brief.assetType === "music") url.searchParams.set("category", "music");

    const body = await fetchJson(url);
    return (body.results || []).map((item) => ({
      id: item.id,
      provider: "openverse",
      title: item.title || "Untitled",
      creator: item.creator || "Unknown creator",
      assetType: brief.assetType,
      previewUrl: item.thumbnail || item.waveform || null,
      mediaUrl: item.url || null,
      sourceUrl: item.foreign_landing_url || item.detail_url,
      priceUsd: 0,
      durationSeconds: item.duration ? Math.round(item.duration / 1000) : null,
      license: {
        code: item.license || null,
        version: item.license_version || null,
        url: item.license_url || null,
        attribution: item.attribution || null,
        attributionRequired: containsAttribution(item.license),
      },
      metadata: {
        source: item.source,
        category: item.category,
        mature: item.mature,
      },
    }));
  },
};

function containsAttribution(license) {
  const code = String(license || "").toLowerCase();
  return code.includes("by") && code !== "cc0";
}
