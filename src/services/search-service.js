import { evaluateAsset } from "../core/policy-engine.js";
import { rankProviders } from "../core/provider-routing.js";
import { allSearchProviders } from "../providers/index.js";
import { normalizeBrief } from "./openrouter.js";

export async function searchAssets(input) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const { brief, brain } = await normalizeBrief(input);
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
      results.push({ ...asset, policy });
    }
  }

  return {
    brief,
    brain,
    recommendedProvider: providerStatus.find((provider) => provider.ok)?.id || null,
    providers: providerStatus,
    count: results.length,
    results: rank(results),
    generatedAt: new Date().toISOString(),
    disclaimer:
      "ZitoAI provides procurement evidence and policy screening, not legal advice or a replacement for the provider's license.",
  };
}

function rank(results) {
  const verdictScore = { allowed: 4, review: 3, checkout_only: 2, rejected: 0 };
  return results.sort((a, b) => {
    const scoreDiff = (verdictScore[b.policy.verdict] || 0) - (verdictScore[a.policy.verdict] || 0);
    if (scoreDiff) return scoreDiff;
    return (a.priceUsd ?? Number.MAX_SAFE_INTEGER) - (b.priceUsd ?? Number.MAX_SAFE_INTEGER);
  });
}
