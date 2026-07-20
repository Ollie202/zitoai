import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

const DEFAULT_IMAGE_SIZE = "huge";
const DEFAULT_IMAGE_FORMAT = "jpg";

export function shutterstockApiBase() {
  return String(config.credentials.shutterstock.apiBase || "https://api.shutterstock.com/v2").replace(/\/$/, "");
}

function authHeaders() {
  if (!config.credentials.shutterstock.accessToken) {
    throw new Error("Shutterstock access token is not configured");
  }
  return { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` };
}

export function shutterstockStatus() {
  return {
    configured: Boolean(config.credentials.shutterstock.accessToken),
    apiBase: shutterstockApiBase(),
    sandbox: shutterstockApiBase().includes("api-sandbox.shutterstock.com"),
    requiredScopes: ["licenses.create", "licenses.view", "purchases.view"],
    imageLicensingEndpoint: "/api/providers/shutterstock/license",
    imageLicensesEndpoint: "/api/providers/shutterstock/licenses",
  };
}

export async function listShutterstockImageCategories() {
  const url = new URL(`${shutterstockApiBase()}/images/categories`);
  return fetchJson(url, { headers: authHeaders() });
}

export async function listShutterstockSubscriptions() {
  const url = new URL(`${shutterstockApiBase()}/user/subscriptions`);
  return fetchJson(url, { headers: authHeaders() });
}

export async function getShutterstockImageDetails(imageId) {
  const id = String(imageId || "").trim();
  if (!id) throw new Error("Shutterstock imageId is required");
  const url = new URL(`${shutterstockApiBase()}/images/${encodeURIComponent(id)}`);
  url.searchParams.set("view", "full");
  return fetchJson(url, { headers: authHeaders() });
}

export function buildShutterstockImageLicenseRequest(input = {}) {
  const imageId = String(input.imageId || input.assetId || "").trim();
  if (!imageId) throw new Error("Shutterstock imageId is required");

  const customerId = String(input.customerId || input.licenseeId || "zito-customer").trim();
  if (!customerId) throw new Error("Shutterstock customerId is required");
  const size = String(input.size || DEFAULT_IMAGE_SIZE).trim();
  const format = String(input.format || DEFAULT_IMAGE_FORMAT).trim();
  const price = Number.isFinite(Number(input.price)) ? Number(input.price) : 0;
  if (price < 0) throw new Error("Shutterstock price cannot be negative");

  const metadata = {
    ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}),
    customer_id: customerId,
  };

  const image = {
    image_id: imageId,
    size,
    format,
    price,
    metadata,
  };

  if (input.subscriptionId) image.subscription_id = String(input.subscriptionId).trim();
  if (input.editorialAcknowledgement === true) image.editorial_acknowledgement = true;

  if (size === "custom") {
    const custom = input.customDimensions || input.custom_dimensions || {};
    const width = Number(custom.width);
    const height = Number(custom.height);
    if (!Number.isFinite(width) && !Number.isFinite(height)) {
      throw new Error("Custom Shutterstock image licenses require customDimensions.width or customDimensions.height");
    }
    image.custom_dimensions = {};
    if (Number.isFinite(width)) image.custom_dimensions.width = width;
    if (Number.isFinite(height)) image.custom_dimensions.height = height;
  }

  return { images: [image] };
}

export async function licenseShutterstockImage(input = {}) {
  if (input.confirmLicense !== true) {
    throw new Error("Set confirmLicense=true before creating a real Shutterstock license");
  }

  const normalizedInput = await resolveImageLicenseDefaults(input);
  const licenseRequest = buildShutterstockImageLicenseRequest(normalizedInput);

  const body = await fetchJson(`${shutterstockApiBase()}/images/licenses`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(licenseRequest),
    timeoutMs: 20_000,
  }).catch((error) => {
    if (error.status === 401 || error.status === 403) {
      const reason = error.body?.message || error.body?.detail || error.body?.error || "Shutterstock token is missing licensing scope or an active entitlement";
      throw new Error(`Shutterstock licensing failed: ${reason}`);
    }
    throw error;
  });

  const first = Array.isArray(body?.data) ? body.data[0] : null;
  const image = licenseRequest.images[0];
  return {
    provider: "shutterstock",
    imageId: image.image_id,
    customerId: image.metadata.customer_id,
    subscriptionId: image.subscription_id || null,
    size: image.size,
    format: image.format,
    apiBase: shutterstockApiBase(),
    sandbox: shutterstockApiBase().includes("api-sandbox.shutterstock.com"),
    allotmentCharge: first?.allotment_charge ?? null,
    licenseId: first?.id || first?.license_id || null,
    downloadUrl: first?.download?.url || null,
    downloadExpiresAt: first?.download?.url ? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() : null,
    request: licenseRequest,
    raw: body,
    licensedAt: new Date().toISOString(),
  };
}

async function resolveImageLicenseDefaults(input = {}) {
  if (input.subscriptionId) return { ...input };
  const subscriptions = await listShutterstockSubscriptions();
  const items = Array.isArray(subscriptions?.data) ? subscriptions.data : [];
  const requestedSize = input.size ? String(input.size).trim() : null;
  const requestedFormat = input.format ? String(input.format).trim() : null;
  const now = Date.now();
  let selectedFormat = null;
  const match = items.find((item) => {
    if (!item?.id) return false;
    if (item.expiration_time && Date.parse(item.expiration_time) < now) return false;
    if (item.allotment?.downloads_left != null && Number(item.allotment.downloads_left) <= 0) return false;
    const formats = Array.isArray(item.formats) ? item.formats : [];
    if (!formats.length) return true;
    selectedFormat =
      formats.find((format) =>
        format.media_type === "image" &&
        (!requestedSize || format.size === requestedSize) &&
        (!requestedFormat || format.format === requestedFormat)
      ) || null;
    return Boolean(selectedFormat);
  });
  if (!match?.id) {
    throw new Error("No active Shutterstock image subscription was found for the requested size/format.");
  }
  return {
    ...input,
    subscriptionId: match.id,
    size: requestedSize || selectedFormat?.size || DEFAULT_IMAGE_SIZE,
    format: requestedFormat || selectedFormat?.format || DEFAULT_IMAGE_FORMAT,
  };
}

export async function listShutterstockImageLicenses(input = {}) {
  const url = new URL(`${shutterstockApiBase()}/images/licenses`);
  if (input.imageId) url.searchParams.set("image_id", String(input.imageId).trim());
  if (input.licenseId) url.searchParams.set("id", String(input.licenseId).trim());
  if (input.page) url.searchParams.set("page", String(input.page));
  if (input.perPage) url.searchParams.set("per_page", String(input.perPage));
  return fetchJson(url, { headers: authHeaders() });
}

export async function redownloadShutterstockImage(input = {}) {
  const licenseId = String(input.licenseId || input.id || "").trim();
  if (!licenseId) throw new Error("Shutterstock licenseId is required");
  const body = {};
  if (input.size) body.size = String(input.size).trim();
  if (input.format) body.format = String(input.format).trim();

  const response = await fetchJson(`${shutterstockApiBase()}/images/licenses/${encodeURIComponent(licenseId)}/downloads`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });

  return {
    provider: "shutterstock",
    licenseId,
    downloadUrl: response?.url || response?.download?.url || null,
    downloadExpiresAt: response?.url || response?.download?.url ? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() : null,
    raw: response,
  };
}
