import { getAccessToken, getSession, initAuth, onAuthChange, sendMagicLink, signOut } from "./auth.js";

const $ = (selector) => document.querySelector(selector);
const form = $("#search-form");
const status = $("#status");
const summary = $("#summary");
const results = $("#results");
const brain = $("#brain");
const storage = $("#storage");
const evidencePanel = $("#evidence-panel");
const authPanel = $("#auth-panel");
let lastSearch = null;
let selectedAsset = null;
let authConfigured = false;

await Promise.all([loadHealth(), loadProviders(), setupAuth()]);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Zito is understanding the brief, ranking providers and screening license conditions…");
  summary.classList.add("hidden");
  results.innerHTML = "";
  const payload = {
    query: $("#query").value,
    assetType: $("#asset-type").value,
    intendedUse: $("#intended-use").value,
    commercial: $("#intended-use").value !== "personal_content",
    territory: $("#territory").value || "worldwide",
    budgetUsd: $("#budget").value,
    rawAssetRequired: true,
    limit: 6,
  };
  try {
    const body = await api("/api/search", { method: "POST", body: payload, auth: false });
    lastSearch = body;
    render(body);
    setStatus(body.providers.map((item) => `${label(item.id)}: ${item.ok ? `${item.count} found` : item.error}`).join(" · "));
  } catch (error) {
    setStatus(error.message, true);
  }
});

results.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select]");
  if (!button || !lastSearch) return;
  selectedAsset = lastSearch.results[Number(button.dataset.select)];
  openEvidence(selectedAsset);
});

$("#evidence-close").addEventListener("click", () => evidencePanel.classList.add("hidden"));
$("#auth-close").addEventListener("click", () => authPanel.classList.add("hidden"));
$("#history-close").addEventListener("click", () => $("#history-panel").classList.add("hidden"));
$("#history-button").addEventListener("click", loadHistory);
$("#auth-button").addEventListener("click", () => authPanel.classList.remove("hidden"));
$("#download-pdf").addEventListener("click", () => generatePack("pdf"));
$("#download-json").addEventListener("click", () => generatePack("json"));

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = $("#auth-status");
  try {
    await sendMagicLink($("#auth-email").value);
    output.textContent = "Magic link sent. Check your inbox and return here after signing in.";
  } catch (error) {
    output.textContent = error.message;
  }
});
$("#sign-out").addEventListener("click", () => signOut());

async function loadHealth() {
  try {
    const body = await api("/api/health", { auth: false });
    brain.textContent = body.brain.configured ? `AI ready · ${shortModel(body.brain.fastModel)} + ${shortModel(body.brain.smartModel)}` : "AI fallback · local parser";
    storage.textContent = body.storage.configured ? "Private evidence storage ready" : "Evidence downloads ready · cloud storage pending";
    renderConnections(body.oauth || {});
  } catch {
    brain.textContent = "Service offline";
    storage.textContent = "Storage unavailable";
  }
}

async function loadProviders() {
  try {
    const body = await api("/api/providers", { auth: false });
    $("#provider-list").innerHTML = body.providers.map((provider) => `<span class="provider-token ${escapeAttribute(provider.status || "")}">${escapeHtml(provider.name)} · ${providerStatus(provider)}</span>`).join("");
  } catch {
    $("#provider-list").textContent = "Provider status unavailable.";
  }
}

async function setupAuth() {
  try {
    const auth = await initAuth();
    authConfigured = auth.configured;
    updateAuth(auth.session);
    onAuthChange(updateAuth);
  } catch (error) {
    $("#auth-status").textContent = error.message;
  }
}

function updateAuth(session) {
  const button = $("#auth-button");
  const form = $("#auth-form");
  const signOutButton = $("#sign-out");
  if (session?.user) {
    button.textContent = session.user.email;
    form.classList.add("hidden");
    signOutButton.classList.remove("hidden");
    $("#history-button").classList.remove("hidden");
    $("#auth-status").textContent = "Signed in. Evidence can be saved privately.";
  } else {
    button.textContent = authConfigured ? "Sign in" : "Storage pending";
    form.classList.toggle("hidden", !authConfigured);
    signOutButton.classList.add("hidden");
    $("#history-button").classList.add("hidden");
    $("#auth-status").textContent = authConfigured ? "" : "Supabase is not connected yet. Local downloads still work.";
  }
}

function renderConnections(oauth) {
  const entries = [
    ["freesound", "Freesound", "Connect a user account for authenticated audio actions."],
    ["adobe_stock", "Adobe Stock", "Connect the customer account before any licensed checkout."],
    ["shutterstock", "Shutterstock", "Enabled only when current provider OAuth endpoints are supplied."],
  ];
  $("#connection-list").innerHTML = entries.map(([id, name, copy]) => {
    const item = oauth[id] || {};
    return `<article class="connection-card"><h3>${name}</h3><p class="microcopy">${copy}</p><button class="secondary-button" data-connect="${id}" ${item.configured ? "" : "disabled"}>${item.configured ? "Connect account" : "Credentials pending"}</button></article>`;
  }).join("");
  $("#connection-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-connect]");
    if (!button) return;
    try {
      const result = await api(`/api/oauth/${button.dataset.connect}/start`, { method: "POST" });
      location.href = result.authorizeUrl;
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

async function loadHistory() {
  const panel = $("#history-panel");
  const list = $("#history-list");
  panel.classList.remove("hidden");
  list.innerHTML = '<p class="microcopy">Loading private procurement history…</p>';
  try {
    const body = await api("/api/procurements");
    list.innerHTML = body.procurements.length ? body.procurements.map((item) => `<article class="history-item"><strong>${escapeHtml(item.request_text || "Untitled procurement")}</strong><div class="history-meta">${escapeHtml(item.status)} · ${new Date(item.created_at).toLocaleString()} · ${(item.evidence_artifacts || []).length} evidence file(s)</div></article>`).join("") : '<p class="microcopy">No saved procurements yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="microcopy">${escapeHtml(error.message)}</p>`;
  }
}

function render(body) {
  summary.classList.remove("hidden");
  const recommended = body.recommendedProvider ? label(body.recommendedProvider) : "no provider";
  summary.textContent = `${body.count} candidates · routed to ${recommended} first · ${body.brief.commercial ? "commercial" : "personal"} use · ${body.brief.territory}`;
  if (!body.results.length) {
    results.innerHTML = '<div class="notice">No compatible provider returned results. Try a broader request or another asset type.</div>';
    return;
  }
  results.innerHTML = body.results.map(card).join("");
}

function card(asset, index) {
  const preview = asset.assetType === "image" || asset.assetType === "video"
    ? asset.previewUrl ? `<img src="${escapeAttribute(asset.previewUrl)}" alt="" loading="lazy">` : "No visual preview"
    : asset.previewUrl ? `<audio controls preload="none" src="${escapeAttribute(asset.previewUrl)}"></audio>` : "Audio preview unavailable";
  const warnings = (asset.policy.warnings || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const price = asset.priceUsd == null ? "Check price" : asset.priceUsd === 0 ? "Free" : `$${asset.priceUsd}`;
  const source = asset.sourceUrl ? `<a href="${escapeAttribute(asset.sourceUrl)}" target="_blank" rel="noreferrer">Original source</a>` : "";
  const license = asset.license?.url ? `<a href="${escapeAttribute(asset.license.url)}" target="_blank" rel="noreferrer">License terms</a>` : "";
  const checkout = asset.policy.checkoutRequired && (asset.purchaseUrl || asset.sourceUrl)
    ? `<a class="checkout-link" href="${escapeAttribute(asset.purchaseUrl || asset.sourceUrl)}" target="_blank" rel="noreferrer">Open provider checkout</a>`
    : "";
  const selectDisabled = asset.policy.verdict === "rejected" ? "disabled" : "";
  return `<article class="card"><div class="preview">${preview}</div><div class="card-body"><div class="card-top"><div><div class="provider">${escapeHtml(label(asset.provider))}</div><h3>${escapeHtml(asset.title)}</h3><p class="creator">${escapeHtml(asset.creator || "Unknown creator")}</p></div><div class="price">${escapeHtml(price)}</div></div><span class="badge ${asset.policy.verdict}">${escapeHtml(asset.policy.verdict.replace("_", " "))}</span><p class="policy-summary">${escapeHtml(asset.policy.summary)}</p><ul class="warnings">${warnings}</ul><div class="actions">${source}${license}${checkout}<button class="select-button" data-select="${index}" ${selectDisabled}>Select and document</button></div></div></article>`;
}

function openEvidence(asset) {
  $("#evidence-asset").innerHTML = `<strong>${escapeHtml(asset.title)}</strong><br><span class="microcopy">${escapeHtml(label(asset.provider))} · ${escapeHtml(asset.license?.name || asset.license?.code || "License requires verification")}</span>`;
  $("#evidence-amount").value = asset.priceUsd ?? "";
  $("#evidence-date").value = new Date().toISOString().slice(0, 16);
  $("#evidence-confirm").checked = false;
  evidencePanel.classList.remove("hidden");
}

async function generatePack(format) {
  if (!selectedAsset || !lastSearch) return;
  const output = $("#pack-status");
  if (!$("#evidence-confirm").checked) {
    output.textContent = "Confirm the evidence statement before generating the pack.";
    return;
  }
  const payload = {
    brief: lastSearch.brief,
    asset: selectedAsset,
    purchase: {
      provider: selectedAsset.provider,
      providerOrderId: $("#evidence-order").value || null,
      providerAssetId: selectedAsset.id,
      checkoutUrl: selectedAsset.purchaseUrl || selectedAsset.sourceUrl || null,
      receiptNumber: $("#evidence-receipt").value || null,
      amount: $("#evidence-amount").value === "" ? null : Number($("#evidence-amount").value),
      currency: "USD",
      status: $("#evidence-order").value || $("#evidence-receipt").value ? "paid" : "pending",
      purchasedAt: $("#evidence-date").value ? new Date($("#evidence-date").value).toISOString() : new Date().toISOString(),
    },
  };
  output.textContent = `Generating ${format.toUpperCase()} evidence pack…`;
  try {
    const response = await fetch(`/api/evidence-pack?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error((await response.json()).error || "Pack generation failed");
    const blob = await response.blob();
    downloadBlob(blob, `zito-evidence-${selectedAsset.provider}-${selectedAsset.id}.${format}`);
    output.textContent = `Evidence Pack generated. SHA-256: ${response.headers.get("X-Evidence-SHA256") || "included in manifest"}`;
    if (getSession()) await persistProcurement(payload, blob, format, response.headers.get("X-Evidence-SHA256"));
  } catch (error) {
    output.textContent = error.message;
  }
}

async function persistProcurement(payload, blob, format, sha256) {
  const output = $("#pack-status");
  const created = await api("/api/procurements", { method: "POST", body: { requestText: payload.brief.query, requestPayload: payload, normalizedBrief: payload.brief, status: "quoted" } });
  const hasProviderEvidence = payload.purchase.status === "paid" && (payload.purchase.providerOrderId || payload.purchase.receiptNumber);
  const purchase = hasProviderEvidence
    ? await api(`/api/procurements/${created.procurement.id}/purchase`, { method: "POST", body: { purchase: payload.purchase, license: licensePayload(payload.asset) } })
    : null;
  const fileName = `zito-evidence-${payload.asset.provider}-${payload.asset.id}.${format}`;
  const signed = await api(`/api/procurements/${created.procurement.id}/evidence/upload`, { method: "POST", body: { fileName } });
  const uploadResponse = await fetch(signed.upload.signedUrl, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob });
  if (!uploadResponse.ok) throw new Error("Evidence generated, but private upload failed.");
  await api(`/api/procurements/${created.procurement.id}/evidence`, { method: "POST", body: { purchaseId: purchase?.result.purchaseId || null, licenseId: purchase?.result.licenseId || null, artifactType: format === "pdf" ? "license_certificate" : "delivery_manifest", storagePath: signed.upload.path, originalName: fileName, contentType: blob.type, byteSize: blob.size, sha256 } });
  output.textContent += hasProviderEvidence ? " Saved privately with provider evidence." : " Saved privately as a checkout handoff; no purchase was recorded.";
}

function licensePayload(asset) {
  return { provider: asset.provider, providerLicenseId: asset.license?.code || null, licenseName: asset.license?.name || null, licenseUrl: asset.license?.url || null, termsSnapshot: { license: asset.license, policy: asset.policy }, commercialUse: lastSearch.brief.commercial, attributionRequired: asset.license?.attributionRequired ?? null, territory: lastSearch.brief.territory };
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}) };
  if (options.auth !== false && getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
  const response = await fetch(path, { method: options.method || "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function setStatus(message, isError = false) { status.classList.remove("hidden", "error"); if (isError) status.classList.add("error"); status.textContent = message; }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function shortModel(value) { return String(value || "").split("/").pop(); }
function providerStatus(provider) { return provider.configured === false ? "credentials needed" : provider.status === "live_public_connector" ? "live" : String(provider.status || "catalogued").replaceAll("_", " "); }
function label(value) { return ({ wikimedia: "Wikimedia Commons", openverse: "Openverse", free_to_use: "Free To Use", stockfilm: "Stockfilm", internet_archive: "Internet Archive", adobe_stock: "Adobe Stock", shutterstock: "Shutterstock", freesound: "Freesound", jamendo: "Jamendo" })[value] || value; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }
