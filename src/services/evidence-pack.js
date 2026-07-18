import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { config } from "../config.js";

const logoPath = join(fileURLToPath(new URL("../../public", import.meta.url)), "assets", "zito-logo.png");

export function buildEvidenceManifest(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const core = {
    schema: "zito.evidence-pack.v1",
    generatedAt: new Date().toISOString(),
    issuer: { name: "ZitoAI", role: "procurement evidence recorder", website: config.publicBaseUrl },
    brief: clean(input.brief || {}),
    asset: clean(input.asset || {}),
    purchase: clean(input.purchase || {}),
    controllingLicense: clean(input.asset?.license || {}),
    policyScreen: clean(input.asset?.policy || {}),
    providerWorkflow: clean(providerWorkflow(input.asset || {}, input.purchase || {})),
    evidenceStatement: "This pack records supplied source, license and transaction evidence. It does not create, transfer or expand rights.",
  };
  const manifestSha256 = sha256(canonical(core));
  return { ...core, manifestSha256 };
}

export async function buildEvidencePdf(manifest) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "ZitoAI License Evidence Pack", Author: "ZitoAI" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.image(logoPath, 48, 42, { width: 54 });
  doc.fillColor("#17223c").font("Helvetica-Bold").fontSize(21).text("ZitoAI License Evidence Pack", 116, 49);
  doc.fillColor("#ff4d00").fontSize(9).text("FIND IT. LICENSE IT. PROVE IT.", 116, 76, { characterSpacing: 1 });
  doc.moveDown(4);
  section(doc, "Evidence identity", [
    ["Manifest SHA-256", manifest.manifestSha256],
    ["Generated", manifest.generatedAt],
    ["Provider", manifest.asset.provider],
    ["Provider asset ID", manifest.asset.id],
  ]);
  section(doc, "Procurement brief", [
    ["Request", manifest.brief.query],
    ["Asset type", manifest.brief.assetType],
    ["Intended use", manifest.brief.intendedUse],
    ["Commercial", yesNo(manifest.brief.commercial)],
    ["Territory", manifest.brief.territory],
    ["Budget", money(manifest.brief.budgetUsd)],
  ]);
  section(doc, "Selected asset", [
    ["Title", manifest.asset.title],
    ["Creator", manifest.asset.creator],
    ["Original source", manifest.asset.sourceUrl],
    ["Media type", manifest.asset.assetType],
  ]);
  section(doc, "Transaction record", [
    ["Order ID", manifest.purchase.providerOrderId],
    ["Receipt", manifest.purchase.receiptNumber],
    ["Amount", `${money(manifest.purchase.amount)} ${manifest.purchase.currency || ""}`.trim()],
    ["Status", manifest.purchase.status],
    ["Purchased", manifest.purchase.purchasedAt],
  ]);
  if (manifest.providerWorkflow?.summary) {
    section(doc, "Provider workflow", [
      ["Workflow mode", manifest.providerWorkflow.mode],
      ["Summary", manifest.providerWorkflow.summary],
      ["Checkout URL", manifest.providerWorkflow.checkoutUrl],
      ["Required proof", manifest.providerWorkflow.requiredProof],
      ["Evidence status", manifest.providerWorkflow.evidenceStatus],
    ]);
    if (manifest.providerWorkflow.steps?.length) {
      heading(doc, "Provider steps");
      for (const step of manifest.providerWorkflow.steps) doc.fillColor("#505b6d").font("Helvetica").fontSize(9).text(`• ${step}`, { indent: 8, paragraphGap: 4 });
      doc.moveDown(.6);
    }
    if (manifest.providerWorkflow.expectedProjectDetails?.length) {
      heading(doc, "Project details expected by provider");
      for (const detail of manifest.providerWorkflow.expectedProjectDetails) doc.fillColor("#505b6d").font("Helvetica").fontSize(9).text(`• ${detail}`, { indent: 8, paragraphGap: 4 });
      doc.moveDown(.6);
    }
  }
  section(doc, "Controlling license", [
    ["License", manifest.controllingLicense.name || manifest.controllingLicense.code],
    ["License URL", manifest.controllingLicense.url],
    ["Attribution required", yesNo(manifest.controllingLicense.attributionRequired)],
    ["Attribution", manifest.controllingLicense.attribution],
  ]);
  section(doc, "Zito policy screen", [
    ["Verdict", manifest.policyScreen.verdict],
    ["Summary", manifest.policyScreen.summary],
    ["Checkout required", yesNo(manifest.policyScreen.checkoutRequired)],
    ["Raw delivery allowed", yesNo(manifest.policyScreen.rawDeliveryAllowed)],
  ]);
  const warnings = Array.isArray(manifest.policyScreen.warnings) ? manifest.policyScreen.warnings : [];
  if (warnings.length) {
    heading(doc, "Warnings and conditions");
    for (const warning of warnings) doc.fillColor("#505b6d").font("Helvetica").fontSize(9).text(`• ${warning}`, { indent: 8, paragraphGap: 4 });
    doc.moveDown(.6);
  }
  heading(doc, "Evidence statement");
  doc.fillColor("#505b6d").font("Helvetica").fontSize(9).text(manifest.evidenceStatement, { lineGap: 3 });
  doc.moveDown(.5).fillColor("#bd2c35").text("Verify the provider’s current controlling terms and any third-party clearances. This document is not legal advice or a replacement license.");
  doc.end();
  return done;
}

export function evidenceHash(buffer) {
  return sha256(buffer);
}

function section(doc, title, rows) {
  heading(doc, title);
  for (const [label, value] of rows) {
    if (value === undefined || value === null || value === "") continue;
    doc.fillColor("#697386").font("Helvetica-Bold").fontSize(8).text(String(label).toUpperCase(), { continued: false });
    doc.fillColor("#17223c").font("Helvetica").fontSize(9).text(String(value), { lineGap: 2, paragraphGap: 5, link: /^https?:/.test(String(value)) ? String(value) : undefined });
  }
  doc.moveDown(.5);
}

function heading(doc, value) {
  if (doc.y > 720) doc.addPage();
  doc.fillColor("#ff4d00").font("Helvetica-Bold").fontSize(11).text(value);
  doc.moveTo(48, doc.y + 3).lineTo(547, doc.y + 3).strokeColor("#dfe3ea").stroke();
  doc.moveDown(.8);
}

function clean(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item === undefined ? null : item));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function providerWorkflow(asset, purchase) {
  if (asset.provider !== "jamendo") return null;
  const jamendoLicense = asset.metadata?.jamendoLicense || {};
  const externalPurchaseRecorded = purchase.status === "external_purchase_recorded";
  return {
    provider: "jamendo",
    mode: jamendoLicense.mode || "checkout_handoff_certificate_required",
    summary: externalPurchaseRecorded
      ? "Jamendo purchase evidence was recorded from an external Jamendo checkout or agreement. Verify the invoice and License Certificate before relying on this pack."
      : "Jamendo public API returned catalog/licensing metadata only. This is a checkout handoff, not a completed license. Commercial licensing must be completed through Jamendo checkout or a separate Jamendo agreement.",
    checkoutUrl: jamendoLicense.checkoutUrl || asset.purchaseUrl || asset.sourceUrl || null,
    requiredProof: "Jamendo invoice/order reference, License Certificate, purchase date, licensee/client name, project title/type, usage/channel, selected track ID, and any restrictions shown by Jamendo.",
    evidenceStatus: externalPurchaseRecorded
      ? "External Jamendo purchase evidence recorded by user; ZitoAI did not independently execute the checkout."
      : "License certificate pending; do not treat this asset as commercially cleared yet.",
    steps: jamendoLicense.requiredExternalSteps || [
      "Complete Jamendo Licensing checkout for the selected track.",
      "Add the project title, project type, licensee/client, usage/channel, and territory details inside Jamendo if requested.",
      "Generate and keep the Jamendo License Certificate after purchase.",
      "Record the invoice/order reference and certificate reference in ZitoAI.",
      "Attach or archive the Jamendo certificate outside this evidence pack if the final demo/client handoff requires the original document.",
    ],
    expectedProjectDetails: jamendoLicense.projectDetailsExpected || [
      "Project title",
      "Project type",
      "Licensee/client name",
      "Usage/channel such as YouTube, paid ad, app, game, film, podcast, or social campaign",
      "Territory",
      "Purchase invoice/order reference",
      "Jamendo License Certificate reference",
    ],
  };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function yesNo(value) { return value === true ? "Yes" : value === false ? "No" : "Not recorded"; }
function money(value) { return value === null || value === undefined || value === "" ? "Not recorded" : `$${Number(value).toFixed(2)}`; }
