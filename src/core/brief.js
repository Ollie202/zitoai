const COMMERCIAL_WORDS = [
  "ad",
  "advert",
  "brand",
  "business",
  "client",
  "commercial",
  "company",
  "marketing",
  "monetized",
  "paid campaign",
  "product",
  "sponsored",
];

const BROADCAST_WORDS = ["broadcast", "film", "radio", "television", "tv"];

export function normalizeBriefLocally(input = {}) {
  input = asObject(input);
  const query = String(input.query || "").trim();
  const lower = `${query} ${input.intendedUse || ""}`.toLowerCase();
  const commercial =
    input.commercial === true || COMMERCIAL_WORDS.some((word) => lower.includes(word));
  const broadcast = BROADCAST_WORDS.some((word) => lower.includes(word));

  return {
    query,
    assetType: input.assetType || inferAssetType(lower),
    intendedUse:
      input.intendedUse || (commercial ? "commercial_content" : "personal_content"),
    commercial,
    broadcast,
    rawAssetRequired: input.rawAssetRequired !== false,
    territory: input.territory || "worldwide",
    budgetUsd:
      input.budgetUsd === "" || input.budgetUsd == null
        ? null
        : Number(input.budgetUsd),
    keywords: query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2)
      .slice(0, 12),
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function inferAssetType(text) {
  if (/(sound effect|sound effects|sfx|foley|ambience|ambient|room tone|roomtone|click|ping|boom|whoosh|riser|creak|rain|waves|bird|birds|thunder|hum|laser|impact|subway|crowd|noise|buzz|door|pop|sparkle|tick|rustle|wind|chirp|beep|alert|tone)/.test(text)) return "sound_effect";
  if (/(photo|image|illustration|picture|poster|cover|thumbnail|hero image)/.test(text)) return "image";
  if (/(footage|video|clip|motion|reel|animation|b-roll)/.test(text)) return "video";
  if (/(music|song|track|instrumental|score|soundtrack|lofi|background music|ambient music|melody)/.test(text)) return "music";
  return "music";
}
