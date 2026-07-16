const form = document.querySelector("#search-form");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
const brain = document.querySelector("#brain");

loadHealth();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Searching public providers and screening licenses…");
  summary.classList.add("hidden");
  results.innerHTML = "";

  const payload = {
    query: document.querySelector("#query").value,
    assetType: document.querySelector("#asset-type").value,
    intendedUse: document.querySelector("#intended-use").value,
    commercial: document.querySelector("#intended-use").value !== "personal_content",
    budgetUsd: document.querySelector("#budget").value,
    rawAssetRequired: true,
    limit: 6,
  };

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Search failed");
    render(body);
    setStatus(
      body.providers.map((item) => `${label(item.id)}: ${item.ok ? `${item.count} found` : item.error}`).join(" · "),
    );
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const body = await response.json();
    brain.textContent = body.brain.configured ? `OpenRouter · ${body.brain.model}` : "Local brain · key optional";
  } catch {
    brain.textContent = "Service offline";
  }
}

function render(body) {
  summary.classList.remove("hidden");
  const recommended = body.recommendedProvider ? label(body.recommendedProvider) : "no provider";
  summary.textContent = `${body.count} candidates for ${body.brief.assetType.replace("_", " ")} · best first source: ${recommended} · ${body.brief.commercial ? "commercial" : "personal"} use · ${body.brief.territory}`;
  if (!body.results.length) {
    results.innerHTML = '<div class="panel">No compatible provider returned results. Try a broader query or another asset type.</div>';
    return;
  }
  results.innerHTML = body.results.map(card).join("");
}

function card(asset) {
  const image = asset.previewUrl
    ? `<img src="${escapeAttribute(asset.previewUrl)}" alt="" loading="lazy" />`
    : "No visual preview";
  const warnings = (asset.policy.warnings || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const price = asset.priceUsd == null ? "Check price" : asset.priceUsd === 0 ? "Free" : `$${asset.priceUsd}`;
  const source = asset.sourceUrl ? `<a href="${escapeAttribute(asset.sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : "";
  const license = asset.license?.url ? `<a href="${escapeAttribute(asset.license.url)}" target="_blank" rel="noreferrer">License terms</a>` : "";

  return `
    <article class="card">
      <div class="preview">${image}</div>
      <div class="card-body">
        <div class="card-top">
          <div>
            <div class="provider">${escapeHtml(label(asset.provider))}</div>
            <h2>${escapeHtml(asset.title)}</h2>
            <p class="creator">${escapeHtml(asset.creator || "Unknown creator")}</p>
          </div>
          <div class="price">${escapeHtml(price)}</div>
        </div>
        <span class="badge ${asset.policy.verdict}">${escapeHtml(asset.policy.verdict.replace("_", " "))}</span>
        <p class="policy-summary">${escapeHtml(asset.policy.summary)}</p>
        <ul class="warnings">${warnings}</ul>
        <div class="actions">${source}${license}</div>
      </div>
    </article>`;
}

function setStatus(message, isError = false) {
  status.classList.remove("hidden", "error");
  if (isError) status.classList.add("error");
  status.textContent = message;
}

function label(value) {
  return ({
    wikimedia: "Wikimedia Commons",
    openverse: "Openverse",
    free_to_use: "Free To Use",
    stockfilm: "Stockfilm",
  })[value] || value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
