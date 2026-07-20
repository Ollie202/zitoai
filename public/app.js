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
const connectionList = $("#connection-list");
let lastSearch = null;
let selectedAsset = null;
let authConfigured = false;

await Promise.all([loadHealth(), loadProviders(), setupAuth()]);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Reading the brief, choosing the provider lane, and checking licensing metadata...");
  summary.classList.add("hidden");
  results.innerHTML = "";
  const selectedType = $("#asset-type").value;
  const payload = {
    query: $("#query").value,
    intendedUse: $("#intended-use").value,
    commercial: $("#intended-use").value !== "personal_content",
    territory: $("#territory").value || "worldwide",
    budgetUsd: $("#budget").value,
    rawAssetRequired: selectedType !== "auto",
    limit: 6,
  };
  if (selectedType !== "auto") payload.assetType = selectedType;
  try {
    const wrapped = await api("/api/a2mcp/media-search", { method: "POST", body: payload, auth: false });
    const body = wrapped.result || wrapped;
    lastSearch = body;
    render(body);
    setStatus(providerRunSummary(body));
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
$("#license-shutterstock").addEventListener("click", licenseSelectedShutterstockImage);
$("#license-jamendo").addEventListener("click", captureJamendoLicenseTerms);
$("#download-freesound-original").addEventListener("click", downloadFreesoundOriginal);
connectionList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-connect]");
  if (!button) return;
  try {
    const result = await api(`/api/oauth/${button.dataset.connect}/start`, { method: "POST" });
    location.href = result.authorizeUrl;
  } catch (error) {
    setStatus(error.message, true);
  }
});

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
    brain.textContent = body.brain.configured ? `AI ready · ${shortModel(body.brain.fastModel)} + ${shortModel(body.brain.smartModel)}` : "Local parser ready";
    storage.textContent = body.storage.configured ? "Evidence vault ready" : "Evidence downloads ready";
    $("#service-mode").textContent = body.payment?.mode === "free" ? "Free A2MCP service" : "Service mode available";
    await refreshOAuthConnections(body.oauth || {});
  } catch {
    brain.textContent = "Service offline";
    storage.textContent = "Backend unavailable";
    $("#service-mode").textContent = "Retry connection";
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
    refreshOAuthConnections().catch(() => {});
  } else {
    button.textContent = authConfigured ? "Sign in" : "Storage pending";
    form.classList.toggle("hidden", !authConfigured);
    signOutButton.classList.add("hidden");
    $("#history-button").classList.add("hidden");
    $("#auth-status").textContent = authConfigured ? "" : "Supabase is not connected yet. Local downloads still work.";
  }
}

async function refreshOAuthConnections(oauth = null) {
  const body = oauth || (await api("/api/health", { auth: false })).oauth || {};
  let connections = [];
  try {
    const result = await api("/api/oauth/connections");
    connections = result.connections || [];
  } catch {
    connections = [];
  }
  renderConnections(body, connections);
}

function renderConnections(oauth, connections = []) {
  const entries = [
    ["freesound", "Freesound", "Connect OAuth for authorized original-file actions."],
    ["shutterstock", "Shutterstock", "Connect OAuth when image licensing needs user-scoped access."],
  ];
  $("#connection-list").innerHTML = entries.map(([id, name, copy]) => {
    const item = oauth[id] || {};
    const connected = connections.find((connection) => connection.provider === id);
    const labelText = connected ? `Connected as ${connected.account_label || connected.provider_account_id || "account"}` : item.configured ? "Connect account" : "Credentials pending";
    return `<article class="connection-card"><h3>${name}</h3><p class="microcopy">${copy}</p><button class="secondary-button" data-connect="${id}" ${item.configured && !connected ? "" : "disabled"}>${escapeHtml(labelText)}</button></article>`;
  }).join("");
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
  summary.textContent = `${body.count} result${body.count === 1 ? "" : "s"} · ${recommended} selected first · ${body.brief.commercial ? "commercial" : "personal"} use · ${body.brief.territory || "worldwide"}`;
  if (!body.results.length) {
    results.innerHTML = '<div class="notice">No provider returned a strong match. Try a broader brief, remove extra constraints, or choose a specific media type.</div>';
    return;
  }
  results.innerHTML = body.results.map(card).join("");
}

function card(asset, index) {
  const audioUrl = asset.previewUrl || asset.mediaUrl;
  let preview;
  if (asset.assetType === "image") {
    preview = asset.previewUrl ? `<img src="${escapeAttribute(asset.previewUrl)}" alt="" loading="lazy">` : "Image preview unavailable";
  } else if (asset.assetType === "video") {
    preview = asset.mediaUrl
      ? `<video controls preload="metadata" src="${escapeAttribute(asset.mediaUrl)}" ${asset.previewUrl ? `poster="${escapeAttribute(asset.previewUrl)}"` : ""}></video>`
      : asset.previewUrl ? `<img src="${escapeAttribute(asset.previewUrl)}" alt="Video thumbnail" loading="lazy">` : "Video preview unavailable";
  } else {
    preview = audioUrl ? `<audio controls preload="metadata" src="${escapeAttribute(audioUrl)}"></audio>` : "Audio preview unavailable";
  }
  const warnings = (asset.policy?.warnings || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const price = asset.priceUsd == null ? "Provider price" : asset.priceUsd === 0 ? "No API charge" : `$${asset.priceUsd}`;
  const source = asset.sourceUrl ? `<a href="${escapeAttribute(asset.sourceUrl)}" target="_blank" rel="noreferrer">Original source</a>` : "";
  const license = asset.license?.url ? `<a href="${escapeAttribute(asset.license.url)}" target="_blank" rel="noreferrer">License terms</a>` : "";
  const checkout = shouldShowCheckout(asset)
    ? `<a class="checkout-link" href="${escapeAttribute(asset.purchaseUrl || asset.sourceUrl)}" target="_blank" rel="noreferrer">Provider licensing step</a>`
    : "";
  const verdict = asset.policy?.verdict || "review";
  const selectDisabled = verdict === "rejected" ? "disabled" : "";
  return `<article class="card"><div class="preview">${preview}</div><div class="card-body"><div class="card-top"><div><div class="provider">${escapeHtml(label(asset.provider))}</div><h3>${escapeHtml(asset.title)}</h3><p class="creator">${escapeHtml(asset.creator || "Unknown creator")}</p></div><div class="price">${escapeHtml(price)}</div></div><span class="badge ${verdict}">${escapeHtml(statusLabel(verdict))}</span><p class="policy-summary">${escapeHtml(asset.policy?.summary || "Review provider terms before using this asset.")}</p><ul class="warnings">${warnings}</ul><div class="actions">${source}${license}${checkout}<button class="select-button" data-select="${index}" ${selectDisabled}>Document evidence</button></div></div></article>`;
}

function shouldShowCheckout(asset) {
  return Boolean((asset.policy.checkoutRequired || asset.provider === "jamendo") && (asset.purchaseUrl || asset.sourceUrl));
}

function openEvidence(asset) {
  $("#evidence-asset").innerHTML = `<strong>${escapeHtml(asset.title)}</strong><br><span class="microcopy">${escapeHtml(label(asset.provider))} · ${escapeHtml(asset.license?.name || asset.license?.code || "License requires verification")}</span>`;
  $("#evidence-order").value = "";
  $("#evidence-receipt").value = "";
  $("#evidence-customer").value = "";
  $("#evidence-amount").value = asset.priceUsd ?? "";
  $("#evidence-date").value = new Date().toISOString().slice(0, 16);
  $("#evidence-confirm").checked = false;
  $("#license-shutterstock").classList.toggle("hidden", asset.provider !== "shutterstock");
  $("#license-jamendo").classList.toggle("hidden", asset.provider !== "jamendo");
  $("#download-freesound-original").classList.toggle("hidden", asset.provider !== "freesound");
  renderJamendoHandoff(asset);
  evidencePanel.classList.remove("hidden");
}

function renderJamendoHandoff(asset) {
  const panel = $("#jamendo-handoff");
  const link = $("#jamendo-checkout-link");
  const isJamendo = asset.provider === "jamendo";
  panel.classList.toggle("hidden", !isJamendo);
  if (!isJamendo) return;
  const checkoutUrl = asset.metadata?.proLicenseUrl || asset.purchaseUrl || asset.sourceUrl || asset.license?.url;
  link.href = checkoutUrl || "#";
  link.classList.toggle("hidden", !checkoutUrl);
}

async function licenseSelectedShutterstockImage() {
  const output = $("#pack-status");
  if (!selectedAsset || selectedAsset.provider !== "shutterstock") return;
  if (!$("#evidence-confirm").checked) {
    output.textContent = "Confirm the evidence statement before creating a real Shutterstock license.";
    return;
  }
  const customerId = $("#evidence-customer").value.trim() || "zito-customer";
  output.textContent = "Creating Shutterstock image license...";
  try {
    const body = await api("/api/providers/shutterstock/license", {
      method: "POST",
      body: {
        imageId: selectedAsset.id,
        customerId,
        price: $("#evidence-amount").value === "" ? 0 : Number($("#evidence-amount").value),
        confirmLicense: true,
      },
      auth: false,
    });
    const licensed = body.license;
    selectedAsset.mediaUrl = licensed.downloadUrl;
    selectedAsset.metadata = { ...(selectedAsset.metadata || {}), shutterstockLicense: licensed };
    selectedAsset.priceUsd = selectedAsset.priceUsd ?? 0;
    $("#evidence-order").value = `shutterstock-${licensed.imageId}`;
    $("#evidence-receipt").value = `allotment-${licensed.allotmentCharge ?? "0"}`;
    $("#evidence-date").value = new Date(licensed.licensedAt).toISOString().slice(0, 16);
    $("#evidence-customer").value = licensed.customerId || customerId;
    output.textContent = licensed.downloadUrl
      ? "Shutterstock license created. Download URL captured in the evidence pack."
      : "Shutterstock license created, but no download URL was returned.";
  } catch (error) {
    output.textContent = error.message;
  }
}

function captureJamendoLicenseTerms() {
  const output = $("#pack-status");
  if (!selectedAsset || selectedAsset.provider !== "jamendo") return;
  if (!$("#evidence-confirm").checked) {
    output.textContent = "Confirm the evidence statement before capturing Jamendo terms.";
    return;
  }
  const jamendoLicense = {
    trackId: selectedAsset.id,
    sourceUrl: selectedAsset.sourceUrl || null,
    checkoutUrl: selectedAsset.purchaseUrl || selectedAsset.metadata?.proLicenseUrl || selectedAsset.sourceUrl || null,
    licenseUrl: selectedAsset.license?.url || null,
    licenseName: selectedAsset.license?.name || null,
    commercialLicenseUrl: selectedAsset.metadata?.proLicenseUrl || null,
    licenses: selectedAsset.metadata?.licenses || null,
    audiodownloadAllowed: selectedAsset.metadata?.audiodownloadAllowed ?? null,
    rawDownloadUrl: selectedAsset.metadata?.rawDownloadUrl || null,
    tags: selectedAsset.metadata?.tags || [],
    requiredExternalSteps: [
      "Complete Jamendo Licensing checkout for the selected track.",
      "Add the project title, project type, licensee/client, usage/channel, and territory details inside Jamendo if requested.",
      "Generate and keep the Jamendo License Certificate after purchase.",
      "Record the invoice/order reference and certificate reference in ZitoAI before treating the project as licensed.",
      "Archive the original Jamendo certificate outside ZitoAI if the final client handoff requires the provider-issued document.",
    ],
    projectDetailsExpected: [
      "project title",
      "project type",
      "licensee/client name",
      "usage/channel",
      "territory",
      "purchase invoice/order reference",
      "license certificate reference",
    ],
    mode: "checkout_handoff_certificate_required",
    capturedAt: new Date().toISOString(),
  };
  selectedAsset.metadata = { ...(selectedAsset.metadata || {}), jamendoLicense };
  if (!$("#evidence-order").value) $("#evidence-order").value = `jamendo-track-${selectedAsset.id}`;
  if (!$("#evidence-receipt").value) $("#evidence-receipt").value = "license-certificate-pending";
  output.textContent = selectedAsset.metadata?.proLicenseUrl
    ? "Jamendo handoff captured. Open Jamendo, buy the track, add project details, generate the certificate, then replace the pending receipt with the invoice/certificate reference."
    : "Jamendo terms captured. Review the track license, then add real invoice/certificate evidence if you complete checkout externally.";
}

async function downloadFreesoundOriginal() {
  const output = $("#pack-status");
  if (!selectedAsset || selectedAsset.provider !== "freesound") return;
  if (!$("#evidence-confirm").checked) {
    output.textContent = "Confirm the evidence statement before downloading the original Freesound file.";
    return;
  }
  output.textContent = "Requesting Freesound original download through OAuth2…";
  try {
    const body = await api(`/api/providers/freesound/sounds/${selectedAsset.id}/download`, {
      method: "POST",
      body: {},
    });
    const downloadUrl = body.download?.downloadUrl || null;
    if (!downloadUrl) throw new Error("Freesound did not return a downloadable URL.");
    selectedAsset.metadata = { ...(selectedAsset.metadata || {}), freesoundOriginalDownload: body.download };
    selectedAsset.mediaUrl = downloadUrl;
    $("#evidence-order").value = `freesound-${selectedAsset.id}`;
    $("#evidence-receipt").value = "oauth2-original-download";
    output.textContent = "Freesound original download URL captured. Opening the file in a new tab…";
    window.open(downloadUrl, "_blank", "noreferrer");
  } catch (error) {
    output.textContent = error.message;
  }
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
      customerId: $("#evidence-customer").value || null,
      providerResponse: selectedAsset.metadata?.shutterstockLicense?.raw || selectedAsset.metadata?.jamendoLicense || null,
      status: purchaseStatus(selectedAsset),
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

function purchaseStatus(asset) {
  if (asset.provider === "shutterstock" && asset.metadata?.shutterstockLicense) return "paid";
  if (asset.provider === "freesound" && asset.metadata?.freesoundOriginalDownload) return "free_downloaded";
  if (asset.provider === "jamendo" && asset.metadata?.jamendoLicense) {
    const receipt = $("#evidence-receipt").value.trim();
    const amount = $("#evidence-amount").value;
    const hasRealExternalEvidence = receipt && receipt !== "license-certificate-pending" && amount !== "";
    return hasRealExternalEvidence ? "external_purchase_recorded" : "checkout_handoff";
  }
  return $("#evidence-order").value || $("#evidence-receipt").value ? "paid" : "pending";
}

async function persistProcurement(payload, blob, format, sha256) {
  const output = $("#pack-status");
  const created = await api("/api/procurements", { method: "POST", body: { requestText: payload.brief.query, requestPayload: payload, normalizedBrief: payload.brief, status: "quoted" } });
  const hasProviderEvidence = ["paid", "free_downloaded", "external_purchase_recorded"].includes(payload.purchase.status) && (payload.purchase.providerOrderId || payload.purchase.receiptNumber);
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
  return {
    provider: asset.provider,
    providerLicenseId: asset.license?.code || null,
    licenseName: asset.license?.name || null,
    licenseUrl: asset.license?.url || null,
    termsSnapshot: {
      license: asset.license,
      policy: asset.policy,
      shutterstockLicense: asset.metadata?.shutterstockLicense || null,
      jamendoLicense: asset.metadata?.jamendoLicense || null,
      customerId: $("#evidence-customer").value || null,
    },
    commercialUse: lastSearch.brief.commercial,
    attributionRequired: asset.license?.attributionRequired ?? null,
    territory: lastSearch.brief.territory,
  };
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
function label(value) { return ({ shutterstock: "Shutterstock", freesound: "Freesound", jamendo: "Jamendo" })[value] || value; }
function statusLabel(value) { return ({ allowed: "Allowed", review: "Review needed", checkout_only: "Provider step", rejected: "Rejected" })[value] || String(value).replaceAll("_", " "); }
function providerRunSummary(body) {
  if (!Array.isArray(body.providers) || body.providers.length === 0) return "Backend responded. Review the results below.";
  return body.providers.map((item) => `${label(item.id)}: ${item.ok ? `${item.count} result${item.count === 1 ? "" : "s"}` : item.error}`).join(" · ");
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }
