import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

export const freeToUseProvider = {
  id: "free_to_use",
  name: "Free To Use",
  requiresApiKey: false,
  supportedAssetTypes: ["music"],

  async search(brief, limit) {
    const url = new URL(`${config.providers.freeToUse}/music/tracks/all`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", "0");
    const body = await fetchJson(url);
    const words = brief.keywords || [];
    const ranked = (body.data || [])
      .map((track) => ({ track, score: relevance(track, words) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return ranked.map(({ track }) => ({
      id: track.id,
      provider: "free_to_use",
      title: track.title,
      creator: artistNames(track.artists),
      assetType: "music",
      previewUrl: track.files?.mp3 || null,
      mediaUrl: track.files?.mp3 || null,
      sourceUrl: `https://freetouse.com/music/${track.id}`,
      priceUsd: track.is_premium ? null : 0,
      durationSeconds: track.duration || null,
      license: {
        code: track.is_premium ? "paid-license-required" : "free-license",
        name: track.is_premium ? "Paid license required" : "Free To Use Free License",
        url: "https://freetouse.com/license",
        attribution: null,
        attributionRequired: !track.is_premium,
      },
      metadata: {
        genre: track.genre,
        premium: Boolean(track.is_premium),
        tags: arrayLikeValues(track.tags),
      },
    }));
  },
};

function relevance(track, words) {
  if (!words.length) return 1;
  const haystack = [
    track.title,
    track.genre,
    ...arrayLikeValues(track.tags),
    ...arrayLikeValues(track.categories),
  ]
    .join(" ")
    .toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function arrayLikeValues(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (Array.isArray(item) ? item[1] : item)).filter(Boolean);
}

function artistNames(value) {
  const names = arrayLikeValues(value).map((artist) => artist?.name).filter(Boolean);
  return names.join(", ") || "Unknown artist";
}
