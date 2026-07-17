import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceManifest, buildEvidencePdf, evidenceHash } from "../src/services/evidence-pack.js";

const input = {
  brief: { query: "Afrobeats instrumental", assetType: "music", intendedUse: "commercial_content", commercial: true, territory: "Nigeria and UK", budgetUsd: 50 },
  asset: { id: "demo-1", provider: "shutterstock", title: "Demo track", creator: "Demo creator", sourceUrl: "https://example.com/asset", assetType: "image", license: { code: "shutterstock-platform", name: "Shutterstock Platform License", url: "https://www.shutterstock.com/api/pricing", attributionRequired: false }, policy: { verdict: "review", summary: "Image licensing requires checkout evidence.", checkoutRequired: true, rawDeliveryAllowed: false, warnings: ["License the image through Shutterstock."] } },
  purchase: { providerOrderId: "FREE-DEMO-1", amount: 0, currency: "USD", status: "documented_free_asset", purchasedAt: "2026-07-16T09:00:00.000Z" },
};

test("Evidence manifest includes a SHA-256 digest", () => {
  const manifest = buildEvidenceManifest(input);
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.asset.id, "demo-1");
});

test("Evidence Pack is a non-empty PDF with a response digest", async () => {
  const pdf = await buildEvidencePdf(buildEvidenceManifest(input));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5_000);
  assert.match(evidenceHash(pdf), /^[a-f0-9]{64}$/);
});
