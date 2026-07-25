import { config } from "../config.js";

// Durable counters backed by Supabase Postgres.
//
// Two different problems, deliberately treated differently:
//
//   Spend  — a cumulative ceiling that resets on every deploy is not a ceiling. The
//            running total lives in Postgres, is restored at startup, and is written
//            after the fact so a storage hiccup never fails a user's request.
//
//   Rate   — the service runs one replica, where the in-memory limiter is both correct
//   limit    and faster than a database round trip on the hot path. The shared backend
//            exists and is tested, but stays opt-in until there is more than one replica.
//
// These call PostgREST directly rather than going through @supabase/supabase-js. That
// client pulls in a realtime transport needing a native WebSocket, which only exists
// from Node 22 — a mismatch that turned every search into a 404 in production. This code
// sits on the search path, and four RPC calls do not justify carrying that dependency.
//
// Every call here is best-effort. Counters are operational guardrails, not user data:
// losing one must degrade a limit, never break a request.

const SPEND_SCOPE = "openrouter_spend";
const SPEND_KEY = "global";
const RPC_TIMEOUT_MS = 5_000;

let unavailableReason = null;

function isConfigured() {
  return Boolean(config.supabase.url && config.supabase.serviceRoleKey);
}

export function usageStoreStatus() {
  return {
    configured: isConfigured(),
    durableSpend: config.usage.durableSpend,
    sharedRateLimit: config.usage.sharedRateLimit,
    lastError: unavailableReason,
  };
}

// Calls a Postgres function through PostgREST with the service role key. Returns null on
// any failure, having recorded why, so callers can degrade rather than propagate.
async function callRpc(fn, args) {
  if (!isConfigured()) {
    unavailableReason = "supabase service role is not configured";
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const base = config.supabase.url.replace(/\/+$/, "");
    const response = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: config.supabase.serviceRoleKey,
        Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args),
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`${fn} failed: HTTP ${response.status} ${text.slice(0, 160)}`);
    unavailableReason = null;
    return text ? JSON.parse(text) : null;
  } catch (error) {
    unavailableReason = error.name === "AbortError" ? `${fn} timed out` : error.message;
    console.error("[zitoai] usage store:", unavailableReason);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Reads the persisted spend total so a restart resumes from where it left off rather
// than silently handing back a fresh budget.
export async function readPersistedSpendUsd() {
  if (!config.usage.durableSpend) return null;
  const value = await callRpc("read_usage_counter", { p_scope: SPEND_SCOPE, p_key: SPEND_KEY });
  return value == null ? null : Number(value) || 0;
}

// Fire-and-forget: the caller has already served its request, and a failure here must
// not surface to the user. Returns the new total when the write succeeds.
export async function recordSpendUsd(deltaUsd) {
  const delta = Number(deltaUsd);
  if (!config.usage.durableSpend || !Number.isFinite(delta) || delta <= 0) return null;
  const value = await callRpc("add_usage_counter", { p_scope: SPEND_SCOPE, p_key: SPEND_KEY, p_delta: delta });
  return value == null ? null : Number(value);
}

// Shared fixed-window limiter. Returns null when the shared store is disabled or
// unreachable, which tells the caller to fall back to its in-memory decision rather
// than fail open or fail closed on a storage problem.
export async function hitSharedRateLimit(key, windowMs, maxRequests) {
  if (!config.usage.sharedRateLimit) return null;
  const data = await callRpc("hit_rate_limit", {
    p_key: String(key),
    p_window_ms: Math.max(1000, Number(windowMs) || 60_000),
    p_max: Math.max(1, Number(maxRequests) || 30),
  });
  if (!data) return null;
  return {
    ok: Boolean(data.allowed),
    count: Number(data.count) || 0,
    retryAfterSeconds: Math.max(1, Number(data.retry_after_seconds) || 1),
  };
}

export async function pruneUsageCounters() {
  const value = await callRpc("prune_usage_counters", {});
  return Number(value) || 0;
}
