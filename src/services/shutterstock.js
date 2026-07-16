import { config } from "../config.js";
import { fetchJson } from "../lib/http.js";

const API_BASE = "https://api.shutterstock.com/v2";
const DEFAULT_IMAGE_SIZE = "huge";

function authHeaders() {
  if (!config.credentials.shutterstock.accessToken) {
    throw new Error("Shutterstock access token is not configured");
  }
  return { Authorization: `Bearer ${config.credentials.shutterstock.accessToken}` };
}

export function shutterstockStatus() {
  return {
    configured: Boolean(config.credentials.shutterstock.accessToken),
    imageLicensingEndpoint: "/api/providers/shutterstock/license",
  };
}

export async function listShutterstockImageCategories() {
  const url = new URL(`${API_BASE}/images/categories`);
  return fetchJson(url, { headers: authHeaders() });
}

export async function listShutterstockSubscriptions() {
  const url = new URL(`${API_BASE}/user/subscriptions`);
  return fetchJson(url, { headers: authHeaders() });
}

export async function licenseShutterstockImage(input = {}) {
  const imageId = String(input.imageId || input.assetId || "").trim();
  if (!imageId) throw new Error("Shutterstock imageId is required");
  if (input.confirmLicense !== true) {
    throw new Error("Set confirmLicense=true before creating a real Shutterstock license");
  }

  const customerId = String(input.customerId || input.licenseeId || "zito-demo-customer").trim();
  const size = String(input.size || DEFAULT_IMAGE_SIZE).trim();
  const price = Number.isFinite(Number(input.price)) ? Number(input.price) : 0;

  const licenseRequest = {
    images: [
      {
        image_id: imageId,
        size,
        price,
        metadata: { customer_id: customerId },
      },
    ],
  };

  if (input.subscriptionId) {
    licenseRequest.images[0].subscription_id = String(input.subscriptionId).trim();
  }

  const body = await fetchJson(`${API_BASE}/images/licenses`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(licenseRequest),
    timeoutMs: 20_000,
  });

  const first = Array.isArray(body?.data) ? body.data[0] : null;
  return {
    provider: "shutterstock",
    imageId,
    customerId,
    size,
    allotmentCharge: first?.allotment_charge ?? null,
    downloadUrl: first?.download?.url || null,
    raw: body,
    licensedAt: new Date().toISOString(),
  };
}
