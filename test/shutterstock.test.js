import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  buildShutterstockImageLicenseRequest,
  licenseShutterstockImage,
  redownloadShutterstockImage,
} from "../src/services/shutterstock.js";

test("Shutterstock image license request includes subscription, price and customer metadata", () => {
  const request = buildShutterstockImageLicenseRequest({
    imageId: "59656357",
    subscriptionId: "s12345678",
    size: "medium",
    format: "jpg",
    price: 12.5,
    customerId: "client-123",
    metadata: { purchase_order: "PO-1" },
  });

  assert.deepEqual(request, {
    images: [
      {
        image_id: "59656357",
        subscription_id: "s12345678",
        size: "medium",
        format: "jpg",
        price: 12.5,
        metadata: { purchase_order: "PO-1", customer_id: "client-123" },
      },
    ],
  });
});

test("Shutterstock licensing auto-selects an active image subscription and records download expiry", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = config.credentials.shutterstock.accessToken;
  const previousBase = config.credentials.shutterstock.apiBase;
  const calls = [];

  config.credentials.shutterstock.accessToken = "test-token";
  config.credentials.shutterstock.apiBase = "https://api-sandbox.shutterstock.com/v2";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/user/subscriptions")) {
      return jsonResponse({
        data: [
          {
            id: "s12345678",
            allotment: { downloads_left: 10 },
            formats: [{ media_type: "image", size: "medium", format: "jpg" }],
          },
        ],
      });
    }
    if (String(url).endsWith("/images/licenses")) {
      const request = JSON.parse(options.body);
      assert.equal(request.images[0].subscription_id, "s12345678");
      assert.equal(request.images[0].size, "medium");
      return jsonResponse({
        data: [{ id: "i987", image_id: "59656357", download: { url: "https://download.example/image.jpg" }, allotment_charge: 1 }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const result = await licenseShutterstockImage({ imageId: "59656357", customerId: "client-123", confirmLicense: true });
    assert.equal(result.subscriptionId, "s12345678");
    assert.equal(result.size, "medium");
    assert.equal(result.licenseId, "i987");
    assert.equal(result.downloadUrl, "https://download.example/image.jpg");
    assert.ok(result.downloadExpiresAt);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.shutterstock.accessToken = previousToken;
    config.credentials.shutterstock.apiBase = previousBase;
  }
});

test("Shutterstock redownload posts to the license download endpoint", async () => {
  const previousFetch = globalThis.fetch;
  const previousToken = config.credentials.shutterstock.accessToken;
  const previousBase = config.credentials.shutterstock.apiBase;

  config.credentials.shutterstock.accessToken = "test-token";
  config.credentials.shutterstock.apiBase = "https://api-sandbox.shutterstock.com/v2";
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api-sandbox.shutterstock.com/v2/images/licenses/i987/downloads");
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).size, "medium");
    return jsonResponse({ url: "https://download.example/redownload.jpg" });
  };

  try {
    const result = await redownloadShutterstockImage({ licenseId: "i987", size: "medium" });
    assert.equal(result.downloadUrl, "https://download.example/redownload.jpg");
    assert.ok(result.downloadExpiresAt);
  } finally {
    globalThis.fetch = previousFetch;
    config.credentials.shutterstock.accessToken = previousToken;
    config.credentials.shutterstock.apiBase = previousBase;
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
