import { mkdir, writeFile } from "node:fs/promises";
import { buildEvidenceManifest, buildEvidencePdf } from "../src/services/evidence-pack.js";

const output = new URL("../artifacts/zito-demo-evidence-pack.pdf", import.meta.url);
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });

const manifest = buildEvidenceManifest({
  brief: { query: "Upbeat Afrobeats instrumental for a 30-second paid social campaign", assetType: "music", intendedUse: "commercial_content", commercial: true, territory: "Nigeria and United Kingdom", budgetUsd: 50 },
  asset: { id: "demo-cc-by-1", provider: "wikimedia", title: "Demonstration track", creator: "Example creator", sourceUrl: "https://commons.wikimedia.org/", assetType: "music", license: { code: "cc-by-4.0", name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attributionRequired: true, attribution: "Example creator — CC BY 4.0" }, policy: { verdict: "allowed", summary: "Commercial use is allowed when attribution and the controlling license conditions are followed.", checkoutRequired: false, rawDeliveryAllowed: true, warnings: ["Credit the creator and link the controlling license.", "Verify that the source item has no separate third-party rights notice."] } },
  purchase: { providerOrderId: "FREE-ASSET-DEMO", receiptNumber: "ZITO-DEMO-001", amount: 0, currency: "USD", status: "documented_free_asset", purchasedAt: new Date().toISOString() },
});

await writeFile(output, await buildEvidencePdf(manifest));
console.log(output.pathname.replace(/^\/(.:)/, "$1"));
