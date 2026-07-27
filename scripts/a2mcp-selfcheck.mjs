const base = String(process.argv[2] || process.env.ASP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const endpoint = `${base}/api/a2mcp/media-search`;
const timeoutMs = Number(process.env.A2MCP_SMOKE_TIMEOUT_MS || 50_000);
const startedAt = Date.now();

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": `smoke-${Date.now()}`,
    },
    body: JSON.stringify({
      query: "Warm cinematic music for a hopeful travel film",
      assetType: "music",
      limit: 3,
    }),
    signal: controller.signal,
  });

  const durationMs = Date.now() - startedAt;
  const body = await response.json().catch(() => null);
  const failures = [];

  if (response.status !== 200) failures.push(`expected HTTP 200, received ${response.status}`);
  if (response.headers.has("payment-required")) failures.push("free endpoint returned a PAYMENT-REQUIRED challenge");
  if (!response.headers.get("x-request-id")) failures.push("response is missing X-Request-Id");
  if (!body?.ok) failures.push("response body does not declare ok=true");
  if (body?.serviceId !== "rights-media-search") failures.push("unexpected serviceId");
  if (body?.billing?.paymentRequired !== false || body?.billing?.x402 !== false) {
    failures.push("response billing metadata does not declare a free service");
  }
  if (!body?.result || !Array.isArray(body.result.results)) failures.push("response is missing the media result array");
  if (body?.result?.count !== body?.result?.results?.length) failures.push("result count does not match the returned array");
  if (durationMs > timeoutMs) failures.push(`response exceeded ${timeoutMs}ms`);

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, endpoint, durationMs, failures, body }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      ok: true,
      endpoint,
      status: response.status,
      durationMs,
      requestId: response.headers.get("x-request-id"),
      resultCount: body.result.count,
      recommendedProvider: body.result.recommendedProvider,
      matchQuality: body.result.matchQuality?.quality || null,
    }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    endpoint,
    durationMs: Date.now() - startedAt,
    error: error?.name === "AbortError" ? `request exceeded ${timeoutMs}ms` : error?.message,
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
