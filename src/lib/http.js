const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Provider request timed out")),
    options.timeoutMs || DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ZitoAI/0.1 (OKX.AI hackathon prototype)",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 500) };
    }

    if (!response.ok) {
      const error = new Error(
        body?.detail || body?.message || body?.error || `HTTP ${response.status}`,
      );
      error.status = response.status;
      error.body = body;
      error.headers = Object.fromEntries(response.headers.entries());
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function asPositiveInt(value, fallback, max = 20) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
