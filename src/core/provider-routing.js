const PROVIDER_PROFILES = {
  stockfilm: {
    supports: ["video"],
    signals: ["archival", "archive", "vintage", "8mm", "super 8", "home movie", "historical", "1950", "1960", "1970"],
    commercial: 2,
    paidBudget: 2,
    rawAsset: 1,
  },
  wikimedia: {
    supports: ["music", "sound_effect", "image", "video"],
    signals: ["public domain", "cc0", "creative commons", "wikimedia", "commons", "historical", "open license"],
    free: 3,
    rawAsset: 2,
  },
  openverse: {
    supports: ["music", "sound_effect", "image"],
    signals: ["free", "open", "creative commons", "cc0", "attribution", "no copyright"],
    free: 2,
    rawAsset: 1,
  },
  free_to_use: {
    supports: ["music"],
    signals: ["background music", "instrumental", "song", "music", "track", "social media"],
    free: 2,
    personal: 2,
    commercial: -2,
    rawAsset: -2,
  },
  internet_archive: {
    supports: ["music", "sound_effect", "image", "video"],
    signals: ["archive", "historical", "public domain", "old recording", "oral history"],
    free: 2,
    rawAsset: 1,
  },
  freesound: {
    supports: ["music", "sound_effect"],
    signals: ["sound effect", "sfx", "foley", "ambient", "field recording", "sample"],
    free: 2,
    commercial: -1,
    rawAsset: 1,
  },
  jamendo: {
    supports: ["music"],
    signals: ["music", "song", "instrumental", "background", "creative commons"],
    free: 2,
    commercial: -1,
    rawAsset: 1,
  },
  shutterstock: {
    supports: ["image"],
    signals: ["stock", "photo", "image", "advert", "campaign"],
    commercial: 2,
    paidBudget: 2,
    rawAsset: 1,
  },
  adobe_stock: {
    supports: ["image", "video"],
    signals: ["stock", "photo", "image", "video", "commercial"],
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
      if (brief.broadcast && provider.id === "stockfilm") score += 2;
      return { provider, score, matchedSignals };
    })
    .sort((a, b) => b.score - a.score);
}

export function providerProfile(providerId) {
  return PROVIDER_PROFILES[providerId] || null;
}
