// Does a returned asset actually convey what was asked for?
//
// Translation was never the weak point: the brief is turned into good English, then
// handed to a provider as a literal keyword search. When the catalogue has nothing close,
// the provider still returns its best guess, and that guess was presented as a match. A
// request for birthday music came back as "I'm Walking Away" with nothing marking it as
// off-target.
//
// This scores each asset against the concepts the request was actually about, so the
// service can retry with different phrasing, and can say "closest available" instead of
// implying a match it did not find.
//
// Deliberately deterministic. It is the layer that has to keep working when the model is
// rate limited, over budget, or down — exactly when result quality matters most.

// Words that carry no search intent. Without this, "I need a song for my son's birthday"
// scores against "need" and "son" as if they described the audio.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "of", "to", "in", "on", "at", "by", "with",
  "from", "as", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may", "might", "must",
  "i", "me", "my", "mine", "we", "us", "our", "you", "your", "he", "him", "his", "she",
  "her", "it", "its", "they", "them", "their", "this", "that", "these", "those",
  "need", "want", "looking", "look", "find", "get", "give", "make", "please", "some",
  "any", "something", "anything", "thing", "stuff", "like", "about", "really", "very",
  "just", "also", "too", "more", "most", "much", "many", "good", "nice", "great",
  "music", "song", "songs", "track", "tracks", "audio", "sound", "sounds", "image",
  "images", "photo", "photos", "picture", "pictures", "clip", "file", "media",
]);

// Media-type words are stripped as concepts because every result in a lane already
// satisfies them: matching "music" inside a music search proves nothing.
const MIN_CONCEPT_LENGTH = 3;

export function extractConcepts(...sources) {
  const text = sources.filter(Boolean).join(" ").toLowerCase();
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const concepts = [];
  for (const word of words) {
    if (word.length < MIN_CONCEPT_LENGTH) continue;
    if (STOPWORDS.has(word)) continue;
    if (!concepts.includes(word)) concepts.push(word);
  }
  return concepts.slice(0, 8);
}

// Everything about an asset a provider might have described it with.
function assetText(asset) {
  const metadata = asset.metadata || {};
  const tags = Array.isArray(metadata.tags) ? metadata.tags.join(" ") : "";
  const musicTags = metadata.musicinfo?.tags
    ? Object.values(metadata.musicinfo.tags).flat().filter(Boolean).join(" ")
    : "";
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords.join(" ") : "";
  const categories = Array.isArray(metadata.categories)
    ? metadata.categories.map((category) => category?.name || category).filter(Boolean).join(" ")
    : "";
  return [
    asset.title,
    metadata.album,
    metadata.description,
    tags,
    musicTags,
    keywords,
    categories,
  ].filter(Boolean).join(" ").toLowerCase();
}

// Substring containment is intentional here, unlike the brief parser's word-boundary
// matching. "birthday" should match "Birthdays", and a tag list is not prose, so the
// false-positive risk that made word boundaries necessary there does not apply.
function conceptMatches(haystack, concept) {
  if (haystack.includes(concept)) return true;
  // Cheap morphological tolerance: plurals and -ing/-ed forms of the same stem.
  const stem = concept.replace(/(ing|ed|es|s)$/, "");
  return stem.length >= MIN_CONCEPT_LENGTH && haystack.includes(stem);
}

export function scoreAssetRelevance(asset, concepts) {
  const wanted = (concepts || []).filter(Boolean);
  if (!wanted.length) {
    // Nothing to check against. Say so rather than implying a verified match.
    return { strength: "unscored", score: null, matched: [], missing: [] };
  }

  const haystack = assetText(asset);
  const matched = wanted.filter((concept) => conceptMatches(haystack, concept));
  const missing = wanted.filter((concept) => !matched.includes(concept));
  const score = matched.length / wanted.length;

  return {
    strength: score >= 0.66 ? "strong" : score > 0 ? "partial" : "weak",
    score: Number(score.toFixed(2)),
    matched,
    missing,
  };
}

// Rolls per-asset scores into one honest verdict about the result set.
//
//   strong  — at least one result genuinely covers the request
//   partial — something related came back, but nothing that covers it
//   weak    — the catalogue returned results that do not reflect the request at all
export function summariseMatchQuality(results) {
  const scored = results.filter((asset) => asset.relevance && asset.relevance.strength !== "unscored");
  if (!scored.length) return { quality: "unscored", strongCount: 0, partialCount: 0, weakCount: 0 };

  const strongCount = scored.filter((asset) => asset.relevance.strength === "strong").length;
  const partialCount = scored.filter((asset) => asset.relevance.strength === "partial").length;
  const weakCount = scored.filter((asset) => asset.relevance.strength === "weak").length;

  return {
    quality: strongCount > 0 ? "strong" : partialCount > 0 ? "partial" : "weak",
    strongCount,
    partialCount,
    weakCount,
  };
}

// Wording the caller can show verbatim. The weak case is the one that matters: it is the
// difference between handing someone the wrong track and telling them nothing matched.
export function matchQualityNotice(summary, brief) {
  const subject = brief?.originalQuery || brief?.query || "this request";
  if (summary.quality === "strong") return null;
  if (summary.quality === "partial") {
    return `No exact match for "${subject}" in the provider catalogue. These are the closest available results — check each one against your brief before licensing.`;
  }
  if (summary.quality === "weak") {
    return `The provider catalogue returned no results that match "${subject}". What follows is the provider's own closest output and may be unrelated. Try different wording, or a different media type.`;
  }
  return null;
}

// Ranks by how well an asset actually matches, then by the policy verdict, then price.
// Relevance leads because a permissively licensed asset that is not what was asked for is
// still the wrong asset.
export function relevanceRank(results) {
  const strengthOrder = { strong: 3, partial: 2, unscored: 1, weak: 0 };
  const verdictOrder = { allowed: 4, review: 3, checkout_only: 2, rejected: 0 };
  return [...results].sort((a, b) => {
    const strengthDiff = (strengthOrder[b.relevance?.strength] ?? 1) - (strengthOrder[a.relevance?.strength] ?? 1);
    if (strengthDiff) return strengthDiff;
    const scoreDiff = (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0);
    if (scoreDiff) return scoreDiff;
    const verdictDiff = (verdictOrder[b.policy?.verdict] || 0) - (verdictOrder[a.policy?.verdict] || 0);
    if (verdictDiff) return verdictDiff;
    return (a.priceUsd ?? Number.MAX_SAFE_INTEGER) - (b.priceUsd ?? Number.MAX_SAFE_INTEGER);
  });
}
