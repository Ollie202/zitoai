import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

export const wikimediaProvider = {
  id: "wikimedia",
  name: "Wikimedia Commons",
  requiresApiKey: false,
  supportedAssetTypes: ["music", "sound_effect", "image", "video"],

  async search(brief, limit) {
    const url = new URL(config.providers.wikimedia);
    const query = `${brief.query} ${fileTypeFilter(brief.assetType)}`.trim();
    const params = {
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime|size",
      iiurlwidth: "640",
      format: "json",
      formatversion: "2",
      origin: "*",
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const body = await fetchJson(url);
    return (body.query?.pages || [])
      .map((page) => mapPage(page, brief.assetType))
      .filter(Boolean);
  },
};

function fileTypeFilter(assetType) {
  if (assetType === "image") return "filetype:bitmap";
  if (assetType === "video") return "filetype:video";
  return "filetype:audio";
}

function mapPage(page, assetType) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  if (!matchesAssetType(info.mime, assetType)) return null;
  const meta = info.extmetadata || {};
  const value = (key) => stripHtml(meta[key]?.value || "");
  const licenseCode = value("License") || value("LicenseShortName");

  return {
    id: String(page.pageid),
    provider: "wikimedia",
    title: page.title?.replace(/^File:/, "") || "Untitled",
    creator: value("Artist") || "Unknown creator",
    assetType,
    previewUrl: info.mime?.startsWith("audio/") || info.mime?.startsWith("video/")
      ? info.url
      : info.thumburl || info.url || null,
    mediaUrl: info.url,
    sourceUrl: info.descriptionurl,
    priceUsd: 0,
    durationSeconds: null,
    license: {
      code: licenseCode.toLowerCase().replace(/creative commons/gi, "cc").replace(/\s+/g, "-"),
      name: value("UsageTerms") || value("LicenseShortName") || null,
      url: meta.LicenseUrl?.value || null,
      attribution: buildAttribution(page.title, value("Artist"), value("LicenseShortName"), meta.LicenseUrl?.value),
      attributionRequired: value("AttributionRequired").toLowerCase() === "true",
    },
    metadata: {
      mime: info.mime,
      width: info.width,
      height: info.height,
      restrictions: value("Restrictions") || null,
      description: value("ImageDescription").slice(0, 500),
    },
  };
}

function matchesAssetType(mime, assetType) {
  const value = String(mime || "").toLowerCase();
  if (assetType === "image") return value.startsWith("image/");
  if (assetType === "video") return value.startsWith("video/");
  return value.startsWith("audio/");
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function buildAttribution(title, creator, license, licenseUrl) {
  const cleanTitle = String(title || "Untitled").replace(/^File:/, "");
  return [
    `“${cleanTitle}”`,
    creator ? `by ${creator}` : null,
    license ? `— ${license}` : null,
    licenseUrl || null,
  ]
    .filter(Boolean)
    .join(" ");
}
