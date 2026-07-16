import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

export const stockfilmProvider = {
  id: "stockfilm",
  name: "Stockfilm",
  requiresApiKey: false,
  supportedAssetTypes: ["video"],

  async search(brief, limit) {
    const url = new URL(`${config.providers.stockfilm}/search`);
    url.searchParams.set("q", brief.query);
    url.searchParams.set("limit", String(limit));
    const body = await fetchJson(url);

    return Promise.all(
      (body.results || []).map(async (clip) => ({
        id: clip.clip_id,
        provider: "stockfilm",
        title: clip.title,
        creator: "Stockfilm",
        assetType: "video",
        previewUrl: clip.thumbnail_url,
        mediaUrl: null,
        sourceUrl: `https://stockfilm.com/search?q=${encodeURIComponent(clip.title)}`,
        purchaseUrl: clip.license_url,
        priceUsd: Number(clip.price_usd || 10),
        durationSeconds: null,
        license: {
          code: "royalty-free",
          name: "Royalty-free, worldwide, perpetual",
          url: "https://stockfilm.com/for-ai-agents",
          attribution: null,
          attributionRequired: false,
        },
        rights: await getRights(clip.clip_id),
        metadata: {
          year: clip.shot_year,
          location: clip.location,
          score: clip.score,
          resolution: "144p x402 license",
        },
      })),
    );
  },
};

async function getRights(clipId) {
  try {
    return await fetchJson(`${config.providers.stockfilm}/clip/${encodeURIComponent(clipId)}/rights`, {
      timeoutMs: 8_000,
    });
  } catch (error) {
    return { available: false, error: error.message };
  }
}
