import { freeToUseProvider } from "./free-to-use.js";
import { internetArchiveProvider } from "./internet-archive.js";
import { openverseProvider } from "./openverse.js";
import { stockfilmProvider } from "./stockfilm.js";
import { wikimediaProvider } from "./wikimedia.js";
import { providerCatalog } from "./catalog.js";
import { gatedProviders } from "./gated.js";

export const providers = [
  wikimediaProvider,
  openverseProvider,
  freeToUseProvider,
  stockfilmProvider,
  internetArchiveProvider,
];

export const allSearchProviders = [...providers, ...gatedProviders];

export function publicProviderInfo() {
  const live = providers.map(({ search: _search, ...provider }) => ({
    ...provider,
    status: "live_public_connector",
  }));
  const gated = gatedProviders.map(({ search: _search, isConfigured, ...provider }) => ({
    ...provider,
    configured: isConfigured(),
  }));
  return [...live, ...gated, ...providerCatalog.filter((entry) => !gatedProviders.some((provider) => provider.id === entry.id))];
}
