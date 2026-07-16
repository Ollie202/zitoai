const COMMERCIAL_OPEN_LICENSES = new Set([
  "cc0",
  "pdm",
  "publicdomain",
  "by",
  "by-sa",
]);

function contains(value, token) {
  return String(value || "").toLowerCase().includes(token);
}

export function evaluateAsset(asset, brief) {
  switch (asset.provider) {
    case "wikimedia":
      return evaluateOpenLicense(asset, brief, false);
    case "openverse":
      return evaluateOpenLicense(asset, brief, true);
    case "free_to_use":
      return evaluateFreeToUse(asset, brief);
    case "stockfilm":
      return evaluateStockfilm(asset, brief);
    case "internet_archive":
      return evaluateInternetArchive(asset, brief);
    case "adobe_stock":
      return checkoutOnly("Customer must authorize Adobe Stock licensing", [
        "Use customer OAuth or an Adobe-approved enterprise workflow.",
        "Do not license from a central agent account and distribute without a provider agreement.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
    case "shutterstock":
      return review("Shutterstock Platform License requires in-app project restrictions", [
        "Free API access is image-focused; video/music access is plan-dependent.",
        "Standalone raw-file delivery requires the customer's own Standard or Enhanced license.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
    case "freesound":
      return review("Freesound asset license must be checked separately", [
        "Commercial API usage requires provider approval; file-level Creative Commons terms still apply.",
      ], { rawDeliveryAllowed: true, checkoutRequired: false });
    case "jamendo":
      return review("Jamendo commercial API and music license require separate verification", [
        "Commercial API use requires an agreement; verify the specific track license and attribution terms.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
    default:
      return review("Unknown provider policy", ["Provider policy is not installed."]);
  }
}

function evaluateInternetArchive(asset, brief) {
  if (!asset.license?.url) {
    return rejected("Internet Archive item has no explicit license URL", [
      "Internet Archive hosts material with different rights; missing metadata is not permission to reuse.",
    ]);
  }
  return review("Explicit source license found; verify the item page and intended use", [
    "Internet Archive does not guarantee that every uploaded item is reusable.",
    "Check the original item page, rights statement and any performer/personality/trademark issues.",
  ], { rawDeliveryAllowed: true, checkoutRequired: false });
}

function evaluateOpenLicense(asset, brief, sourceVerificationRequired) {
  const license = String(asset.license?.code || asset.license?.name || "").toLowerCase();
  const warnings = [];

  if (!license) {
    return review("License metadata is missing", ["Do not download until the source license is verified."]);
  }

  if (contains(license, "nc") && brief.commercial) {
    return rejected("Non-commercial license conflicts with the requested commercial use", [
      "Choose a commercially reusable asset or obtain separate permission.",
    ]);
  }

  if (contains(license, "nd")) {
    warnings.push("NoDerivatives terms may prevent editing, remixing, trimming, or adaptation.");
  }
  if (contains(license, "sa")) {
    warnings.push("ShareAlike obligations may apply to adaptations.");
  }
  if (asset.license?.attributionRequired) {
    warnings.push("Creator attribution and a license link must accompany the final use.");
  }
  if (sourceVerificationRequired) {
    warnings.push("Openverse is an aggregator; verify the license on the original source page.");
  }
  warnings.push("Check trademarks, identifiable people, privacy, publicity, and moral rights separately.");

  const recognized = [...COMMERCIAL_OPEN_LICENSES].some(
    (item) => license === item || license.startsWith(`${item}-`) || license.includes(item),
  );
  if (!recognized || contains(license, "nd") || sourceVerificationRequired) {
    return review("Usable only after source and restriction checks", warnings, {
      rawDeliveryAllowed: true,
      checkoutRequired: false,
    });
  }

  return allowed("Open license permits redistribution when its conditions are followed", warnings, {
    rawDeliveryAllowed: true,
    checkoutRequired: false,
  });
}

function evaluateFreeToUse(asset, brief) {
  const warnings = [
    "The provider license is non-transferable.",
    "License Hunter must not send the raw song to a customer after downloading it under its own identity.",
  ];

  if (brief.commercial || brief.broadcast) {
    warnings.push("The free license does not cover commercial, broadcast, software, game, or product use.");
  }

  return checkoutOnly(
    "User must obtain the correct license directly from Free To Use",
    warnings,
    { rawDeliveryAllowed: false, checkoutRequired: true },
  );
}

function evaluateStockfilm(asset, brief) {
  const warnings = [
    "The x402 flow is agent-native, but the public terms do not clearly identify the end-customer licensee.",
    "Do not enable autonomous raw-file delivery until Stockfilm confirms the customer-licensee workflow in writing.",
  ];

  const flags = asset.rights?.flags || asset.rights || {};
  if (asset.rights?.eligible === false) {
    return rejected("Stockfilm rights endpoint says this clip is not eligible", [
      asset.rights.reason || "Choose another clip.",
    ]);
  }
  if (asset.rights?.confidence != null && Number(asset.rights.confidence) < 0.8) {
    warnings.push(`Provider rights confidence is ${asset.rights.confidence}; manual review is recommended.`);
  }
  if (flags.people || flags.recognizable_people) warnings.push("Recognizable people may require additional clearance.");
  if (flags.minors) warnings.push("The footage may show minors.");
  if (flags.logos) warnings.push("Visible logos or trademarks require review.");
  if (flags.music || flags.ambient_music) warnings.push("Ambient music rights may require review.");

  return review("Purchase path works; customer-licensee confirmation is still required", warnings, {
    rawDeliveryAllowed: false,
    checkoutRequired: true,
    paymentProtocol: "OKX Agent Payments Protocol",
  });
}

function outcome(verdict, summary, warnings, extra = {}) {
  return { verdict, summary, warnings, ...extra };
}

function allowed(summary, warnings = [], extra = {}) {
  return outcome("allowed", summary, warnings, extra);
}

function review(summary, warnings = [], extra = {}) {
  return outcome("review", summary, warnings, extra);
}

function checkoutOnly(summary, warnings = [], extra = {}) {
  return outcome("checkout_only", summary, warnings, extra);
}

function rejected(summary, warnings = [], extra = {}) {
  return outcome("rejected", summary, warnings, extra);
}
