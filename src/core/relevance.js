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

// Where a concept appears decides how much it counts.
//
// Pooling every field equally meant a track called "SpringGardenApril", with "rain"
// buried in its tags, scored the same as one called "Rain Falling On The Greenhouse".
// Both technically contain the concept; only one is obviously the thing that was asked
// for. A provider names an asset after its subject, so the title is the strongest signal
// available and a tag is the weakest.
const FIELD_WEIGHTS = { title: 1, tags: 0.6, description: 0.4 };

// Strength is decided by two questions, not by the weighted score.
//
// Tuning a single threshold could not separate the cases: normalising by concept count
// means one tag match scores 0.6 against one concept but 0.2 against three, so any cutoff
// admitting a genuine two-of-three match also admitted a lone tag hit.
//
//   Coverage — did most of what was asked for actually appear?
//   Title    — does the asset's own name carry at least one of those concepts?
//
// Both must hold. The weighted score still orders results within a strength band, where
// field quality is exactly the right tiebreak.
const STRONG_COVERAGE = 0.66;

function assetFields(asset) {
  const metadata = asset.metadata || {};
  const list = (value) => (Array.isArray(value) ? value.join(" ") : "");
  const musicTags = metadata.musicinfo?.tags
    ? Object.values(metadata.musicinfo.tags).flat().filter(Boolean).join(" ")
    : "";
  const categories = Array.isArray(metadata.categories)
    ? metadata.categories.map((category) => category?.name || category).filter(Boolean).join(" ")
    : "";

  return {
    // Album sits with the title: it names the work, not an attribute of it.
    title: [asset.title, metadata.album].filter(Boolean).join(" ").toLowerCase(),
    tags: [list(metadata.tags), musicTags, list(metadata.keywords), categories].filter(Boolean).join(" ").toLowerCase(),
    description: String(metadata.description || "").toLowerCase(),
  };
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
    return { strength: "unscored", score: null, matched: [], missing: [], matchedIn: {} };
  }

  const fields = assetFields(asset);
  const matched = [];
  const missing = [];
  const matchedIn = {};
  let weightedTotal = 0;

  for (const concept of wanted) {
    // Best field wins: a concept in the title is not diluted by its absence elsewhere.
    let best = 0;
    let bestField = null;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      if (weight > best && conceptMatches(fields[field], concept)) {
        best = weight;
        bestField = field;
      }
    }
    if (bestField) {
      matched.push(concept);
      matchedIn[concept] = bestField;
      weightedTotal += best;
    } else {
      missing.push(concept);
    }
  }

  const score = weightedTotal / wanted.length;
  const coverage = matched.length / wanted.length;
  const namedInTitle = Object.values(matchedIn).includes("title");

  return {
    strength: coverage >= STRONG_COVERAGE && namedInTitle ? "strong" : matched.length ? "partial" : "weak",
    coverage: Number(coverage.toFixed(2)),
    score: Number(score.toFixed(2)),
    matched,
    missing,
    // Says which field carried each match, so a title that looks unrelated can show why
    // it was included rather than reading as a mistake.
    matchedIn,
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
