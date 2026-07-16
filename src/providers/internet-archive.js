import { fetchJson } from "../lib/http.js";

export const internetArchiveProvider = {
  id: "internet_archive",
  name: "Internet Archive",
  requiresApiKey: false,
  supportedAssetTypes: ["music", "sound_effect", "image", "video"],
  async search(brief, limit) {
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", `${brief.query} AND mediatype:(audio OR movies OR image)`);
    url.searchParams.set("fl[]", "identifier,title,creator,licenseurl,mediatype,format");
    url.searchParams.set("rows", String(limit));
    url.searchParams.set("output", "json");
    const body = await fetchJson(url);
    return (body.response?.docs || []).map((item) => ({
      id: item.identifier,
      provider: "internet_archive",
      title: item.title || item.identifier,
      creator: item.creator || "Unknown creator",
      assetType: brief.assetType,
      previewUrl: null,
      mediaUrl: `https://archive.org/details/${encodeURIComponent(item.identifier)}`,
      sourceUrl: `https://archive.org/details/${encodeURIComponent(item.identifier)}`,
      priceUsd: 0,
      license: {
        code: item.licenseurl ? "source-license" : null,
        name: item.licenseurl ? "Source license (verify before use)" : null,
        url: item.licenseurl || null,
        attributionRequired: true,
      },
      metadata: { mediatype: item.mediatype, formats: item.format || [] },
    }));
  },
};
