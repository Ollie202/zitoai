import { evaluateAsset } from "../core/policy-engine.js";
import { rankProviders } from "../core/provider-routing.js";
import { matchQualityNotice, relevanceRank, scoreAssetRelevance, summariseMatchQuality } from "../core/relevance.js";
import { allSearchProviders } from "../providers/index.js";
import { normalizeBrief, rankResultsWithOpenRouter } from "./openrouter.js";

const MAX_ALTERNATE_ATTEMPTS = 2;

export async function searchAssets(input) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  // Validate before the AI layer runs. An empty query used to reach the model, which
  // invented a brief from nothing and returned unrelated results at the cost of two
  // OpenRouter calls per request.
  const requestedQuery = String(input.query || "").trim();
  if (!requestedQuery) throw new Error("A search query is required.");

  const { brief, brain } = await normalizeBrief({ ...input, query: requestedQuery });
  if (!brief.query) throw new Error("A search query is required.");

  const requested = Array.isArray(input.providers) ? new Set(input.providers) : null;
  const eligible = allSearchProviders.filter(
    (provider) =>
      (!requested || requested.has(provider.id)) &&
      provider.supportedAssetTypes.includes(brief.assetType) &&
      (!provider.isConfigured || provider.isConfigured()),
  );
  const rankedProviders = rankProviders(eligible, brief);
  const selected = rankedProviders.map((entry) => entry.provider);
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 12);

  const attempt = await runSearch(selected, rankedProviders, brief, limit);
  let { results, providerStatus } = attempt;
  let summary = summariseMatchQuality(results);
  const attemptedQueries = [brief.query];

  // Nothing came back that reflects the request. A catalogue with no results for one
  // phrasing often has good ones for another, so the same intent is tried again in
  // different words before the caller is handed something unrelated.
  // Each retry is a fresh round of provider calls, so the fan-out is bounded. Two
  // rephrasings is enough to rescue a catalogue miss without letting an obscure request
  // multiply into a large number of upstream requests.
  const alternates = (Array.isArray(brief.alternateQueries) ? brief.alternateQueries : []).slice(0, MAX_ALTERNATE_ATTEMPTS);
  for (const alternate of alternates) {
    if (summary.quality === "strong") break;
    const phrasing = String(alternate || "").trim();
    if (!phrasing || attemptedQueries.some((q) => q.toLowerCase() === phrasing.toLowerCase())) continue;

    attemptedQueries.push(phrasing);
    const retry = await runSearch(selected, rankedProviders, { ...brief, query: phrasing }, limit);
    const retrySummary = summariseMatchQuality(retry.results);
    if (isBetterMatch(retrySummary, summary)) {
      results = retry.results;
      providerStatus = retry.providerStatus;
      summary = retrySummary;
      brief.query = phrasing;
      brief.usedAlternateQuery = true;
    }
  }

  const ranked = relevanceRank(results);
  const aiRanking = await rankResultsWithOpenRouter(brief, ranked);
  // The ranking model may reorder, but relevance stays authoritative: a well-licensed
  // asset that is not what was asked for is still the wrong asset.
  const finalResults = relevanceRank(aiRanking.results);
  const finalSummary = summariseMatchQuality(finalResults);

  return {
    brief,
    processing: {
      aiAssisted: Boolean(brain?.used || aiRanking.ranking?.used),
      sourceLanguage: brief.sourceLanguage || "Unknown",
      translated: Boolean(brief.translated),
      providerQuery: brief.query,
      attemptedQueries,
      usedAlternateQuery: Boolean(brief.usedAlternateQuery),
      // Degrading to the local parser is silent from the outside: the request still
      // succeeds, it just stops being translated. That is exactly the state that made a
      // broken AI layer look like working software, so it is named here.
      degraded: brain?.used === false && brain?.mode !== "local",
      degradedReason: brain?.used === false && brain?.mode !== "local" ? brain?.error || "The language model was unavailable for this request." : null,
    },
    // Says plainly whether these results answer the request, so a caller is never handed
    // an unrelated asset as though it were a match.
    matchQuality: {
      ...finalSummary,
      concepts: brief.coreConcepts || [],
      notice: matchQualityNotice(finalSummary, brief),
    },
    recommendedProvider: providerStatus.find((provider) => provider.ok)?.id || null,
    providers: providerStatus,
    count: finalResults.length,
    results: finalResults,
    generatedAt: new Date().toISOString(),
    disclaimer:
      "ZitoAI provides procurement evidence and policy screening, not legal advice or a replacement for the provider's license.",
  };
}

// Prefers more genuinely matching results, then more partial ones. A retry only replaces
// the first attempt when it is actually better, so a worse rephrasing cannot win.
function isBetterMatch(candidate, current) {
  if (candidate.strongCount !== current.strongCount) return candidate.strongCount > current.strongCount;
  return candidate.partialCount > current.partialCount;
}

async function runSearch(selected, rankedProviders, brief, limit) {
  const settled = await Promise.allSettled(
    selected.map(async (provider) => ({
      provider,
      assets: await provider.search(brief, limit),
    })),
  );

  const results = [];
  const providerStatus = [];
  for (let index = 0; index < settled.length; index += 1) {
    const entry = settled[index];
    const provider = selected[index];
    if (entry.status === "rejected") {
      providerStatus.push({
        id: provider.id,
        ok: false,
        score: rankedProviders[index].score,
        matchedSignals: rankedProviders[index].matchedSignals,
        error: entry.reason?.message || "Provider failed",
      });
      continue;
    }

    providerStatus.push({
      id: provider.id,
      ok: true,
      score: rankedProviders[index].score,
      matchedSignals: rankedProviders[index].matchedSignals,
      count: entry.value.assets.length,
    });

    for (const asset of entry.value.assets) {
      const policy = evaluateAsset(asset, brief);
      if (brief.budgetUsd != null && asset.priceUsd != null && asset.priceUsd > brief.budgetUsd) {
        policy.verdict = "rejected";
        policy.summary = `Price exceeds the $${brief.budgetUsd} budget`;
        policy.warnings = [...policy.warnings, "Choose a cheaper asset or increase the budget."];
      }
      results.push({ ...asset, policy, relevance: scoreAssetRelevance(asset, brief.coreConcepts) });
    }
  }

  return { results, providerStatus };
}
