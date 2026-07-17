export function evaluateAsset(asset, brief) {
  switch (asset.provider) {
    case "shutterstock":
      return review("Shutterstock Platform License requires in-app project restrictions", [
        "Standalone raw-file delivery requires the customer's own Standard or Enhanced license.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
    case "freesound":
      return review("Freesound search and previews are available, but original downloads and user actions require OAuth2", [
        "Token auth is enough for search.",
        "OAuth2 is required for non-read resources like uploads, ratings, bookmarks, and original-file downloads.",
        "Check each sound’s own license before reuse.",
      ], { rawDeliveryAllowed: true, checkoutRequired: false });
    case "jamendo":
      return review("Jamendo music can be searched and previewed, but commercial clearance is a license handoff unless Jamendo grants a direct commercial API flow", [
        "Use the returned Jamendo license/commercial URL as the controlling rights step.",
        "Do not mark a Jamendo track as purchased unless the user provides real external checkout or agreement evidence.",
        "Creative Commons tracks may still require attribution or may not fit every commercial use.",
      ], { rawDeliveryAllowed: false, checkoutRequired: Boolean(brief.commercial || asset.metadata?.proLicenseUrl) });
    default:
      return review("Unknown provider policy", ["Provider policy is not installed."]);
  }
}

function outcome(verdict, summary, warnings, extra = {}) {
  return { verdict, summary, warnings, ...extra };
}

function review(summary, warnings = [], extra = {}) {
  return outcome("review", summary, warnings, extra);
}
