export function evaluateAsset(asset, brief) {
  switch (asset.provider) {
    case "shutterstock":
      return review("Shutterstock Platform License requires in-app project restrictions", [
        "Standalone raw-file delivery requires the customer's own Standard or Enhanced license.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
    case "freesound":
      return review("Freesound asset license must be checked separately", [
        "Commercial API usage requires approval; file-level Creative Commons terms still apply.",
      ], { rawDeliveryAllowed: true, checkoutRequired: false });
    case "jamendo":
      return review("Jamendo commercial API and music license require separate verification", [
        "Commercial API use requires an agreement; verify the specific track license and attribution terms.",
      ], { rawDeliveryAllowed: false, checkoutRequired: true });
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
