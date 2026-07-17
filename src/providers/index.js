import { gatedProviders } from "./gated.js";

export const providers = [];

export const allSearchProviders = [...providers, ...gatedProviders];

export function publicProviderInfo() {
  const gated = gatedProviders.map(({ search: _search, isConfigured, ...provider }) => ({
    ...provider,
    configured: isConfigured(),
  }));
  return gated;
}
