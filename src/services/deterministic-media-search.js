import { evaluateAsset } from "../core/policy-engine.js";
import { freesoundProvider, jamendoProvider, shutterstockProvider } from "../providers/gated.js";

const SOURCE_BY_TYPE = {
  image: shutterstockProvider,
  sfx: freesoundProvider,
  sound_effect: freesoundProvider,
  music: jamendoProvider,
};

export async function deterministicMediaSearch(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const query = String(input.query || "").trim();
  if (!query) throw new Error("query is required");

  const assetType = normalizeAssetType(input.asset_type || input.assetType);
  const usageRights = normalizeUsageRights(input.usage_rights || input.usageRights || input.intendedUse, input.commercial);
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 12);
  const requestedSource = normalizeSource(input.source || input.provider);
  const provider = requestedSource ? providerBySource(requestedSource) : SOURCE_BY_TYPE[assetType];
  if (!provider) throw new Error(`Unsupported asset_type: ${assetType}`);

  const source = provider.id;
  if (usageRights === "commercial" && (source === "jamendo")) {
    return response({ query, assetType, usageRights, source, limit, droppedReason: "jamendo_open_api_is_non_commercial_gate" }, []);
  }

  const brief = {
    query,
    assetType: assetType === "sfx" ? "sound_effect" : assetType,
    intendedUse: usageRights === "commercial" ? "commercial_content" : "personal_content",
    commercial: usageRights === "commercial",
    territory: input.territory || "worldwide",
    rawAssetRequired: true,
    keywords: keywords(query),
  };

  const assets = await provider.search(brief, limit);
  const normalized = assets
    .map((asset) => normalizeAsset(asset, brief))
    .filter((asset) => asset.preview_url)
    .filter((asset) => !(usageRights === "commercial" && isNonCommercial(asset.license_type)));

  return response({ query, assetType, usageRights, source, limit }, normalized);
}

function response(brief, results) {
  return {
    deterministic: true,
    brief,
    count: results.length,
    results,
  };
}

function normalizeAsset(asset, brief) {
  const policy = evaluateAsset(asset, brief);
  const licenseType = licenseTypeFor(asset);
  const attributionRequired = attributionRequiredFor(asset.provider, licenseType, asset.license);
  return {
    source: asset.provider,
    asset_id: String(asset.id),
    asset_type: asset.assetType === "sound_effect" ? "sfx" : asset.assetType,
    license_type: licenseType,
    price: asset.provider === "shutterstock" ? null : 0,
    preview_url: asset.previewUrl || null,
    attribution_required: attributionRequired,
    attribution_text: attributionRequired ? attributionText(asset, licenseType) : null,
    title: asset.title || null,
    creator: asset.creator || null,
    source_url: asset.sourceUrl || null,
    purchase_url: asset.purchaseUrl || null,
    policy_verdict: policy.verdict,
    policy_summary: policy.summary,
  };
}

function normalizeAssetType(value) {
  const text = String(value || "").toLowerCase().trim();
  if (["image", "photo", "picture"].includes(text)) return "image";
  if (["sfx", "sound", "sound_effect", "sound-effect", "ambience", "one-shot", "oneshot"].includes(text)) return "sfx";
  if (["music", "song", "track"].includes(text)) return "music";
  return "music";
}

function normalizeUsageRights(value, commercial) {
  const text = String(value || "").toLowerCase();
  if (commercial === true || /commercial|paid|brand|advert|ad|campaign|client|moneti[sz]ed/.test(text)) return "commercial";
  return "non_commercial";
}

function normalizeSource(value) {
  const text = String(value || "").toLowerCase().trim();
  if (["shutterstock", "jamendo", "freesound"].includes(text)) return text;
  return null;
}

function providerBySource(source) {
  return { shutterstock: shutterstockProvider, freesound: freesoundProvider, jamendo: jamendoProvider }[source] || null;
}

function licenseTypeFor(asset) {
  if (asset.provider === "jamendo") return parseCreativeCommonsVariant(asset.license?.code || asset.metadata?.licenseUrl || asset.license?.url);
  if (asset.provider === "freesound") return normalizeFreesoundLicense(asset.license?.code || asset.license?.name || asset.license?.url);
  if (asset.provider === "shutterstock") return asset.license?.code || "shutterstock-platform";
  return asset.license?.code || asset.license?.name || "unknown";
}

function parseCreativeCommonsVariant(value) {
  const text = String(value || "").toLowerCase();
  const match = text.match(/creativecommons\.org\/licenses\/([^/]+)/);
  if (match) return `cc-${match[1]}`;
  if (text.includes("publicdomain/zero") || text.includes("cc0")) return "cc0";
  return text || "unknown";
}

function normalizeFreesoundLicense(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("publicdomain/zero") || text.includes("creative commons 0") || text.includes("cc0")) return "cc0";
  const match = text.match(/creativecommons\.org\/licenses\/([^/]+)/);
  if (match) return `cc-${match[1]}`;
  if (text.includes("sampling+")) return "sampling+";
  return text || "unknown";
}

function attributionRequiredFor(provider, licenseType, license = {}) {
  if (provider === "shutterstock") return false;
  const text = `${licenseType} ${license.name || ""} ${license.url || ""}`.toLowerCase();
  if (text.includes("cc0") || text.includes("publicdomain/zero")) return false;
  return true;
}

function attributionText(asset, licenseType) {
  const title = asset.title || `Asset ${asset.id}`;
  const creator = asset.creator || "Unknown creator";
  const source = asset.sourceUrl || "";
  return `"${title}" by ${creator} via ${asset.provider} (${licenseType})${source ? ` — ${source}` : ""}`;
}

function isNonCommercial(licenseType) {
  return /\bnc\b|non[-_ ]?commercial/.test(String(licenseType || "").toLowerCase());
}

function keywords(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .slice(0, 12);
}
