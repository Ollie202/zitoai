const PROVIDER_PROFILES = {
  freesound: {
    supports: ["sound_effect"],
    signals: ["sound effect", "sfx", "foley", "ambient", "field recording", "sample"],
    free: 2,
    rawAsset: 1,
  },
  jamendo: {
    supports: ["music"],
    signals: ["music", "song", "instrumental", "background"],
    free: 2,
    rawAsset: 1,
  },
  shutterstock: {
    supports: ["image"],
    signals: ["stock", "photo", "image", "advert", "campaign"],
    commercial: 2,
    paidBudget: 2,
    rawAsset: 1,
  },
};

export function rankProviders(providers, brief) {
  const query = `${brief.query} ${(brief.keywords || []).join(" ")}`.toLowerCase();
  return providers
    .map((provider) => {
      const profile = PROVIDER_PROFILES[provider.id] || { supports: [] };
      let score = profile.supports.includes(brief.assetType) ? 10 : -100;
      const matchedSignals = (profile.signals || []).filter((signal) => query.includes(signal));
      score += matchedSignals.length * 4;
      if (brief.commercial) score += profile.commercial || 0;
      if (!brief.commercial) score += profile.personal || 0;
      if (brief.budgetUsd != null && brief.budgetUsd > 0) score += profile.paidBudget || 0;
      else score += profile.free || 0;
      if (brief.rawAssetRequired) score += profile.rawAsset || 0;
      return { provider, score, matchedSignals };
    })
    .sort((a, b) => b.score - a.score);
}

export function providerProfile(providerId) {
  return PROVIDER_PROFILES[providerId] || null;
}
