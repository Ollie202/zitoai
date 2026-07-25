import { createClient } from "@supabase/supabase-js";
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
// Every call here is best-effort. Counters are operational guardrails, not user data:
// losing one must degrade a limit, never break a request.

const SPEND_SCOPE = "openrouter_spend";
const SPEND_KEY = "global";

let client = null;
let unavailableReason = null;

function adminClient() {
  if (client) return client;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    unavailableReason = "supabase service role is not configured";
    return null;
  }
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function usageStoreStatus() {
  return {
    configured: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
    durableSpend: config.usage.durableSpend,
    sharedRateLimit: config.usage.sharedRateLimit,
    lastError: unavailableReason,
  };
}

// Reads the persisted spend total so a restart resumes from where it left off rather
// than silently handing back a fresh budget.
export async function readPersistedSpendUsd() {
  const admin = adminClient();
  if (!admin || !config.usage.durableSpend) return null;
  try {
    const { data, error } = await admin.rpc("read_usage_counter", { p_scope: SPEND_SCOPE, p_key: SPEND_KEY });
    if (error) throw new Error(error.message);
    unavailableReason = null;
    return Number(data) || 0;
  } catch (error) {
    unavailableReason = error.message;
    console.error("[zitoai] could not read persisted spend:", error.message);
    return null;
  }
}

// Fire-and-forget: the caller has already served its request, and a failure here must
// not surface to the user. Returns the new total when the write succeeds.
export async function recordSpendUsd(deltaUsd) {
  const admin = adminClient();
  const delta = Number(deltaUsd);
  if (!admin || !config.usage.durableSpend || !Number.isFinite(delta) || delta <= 0) return null;
  try {
    const { data, error } = await admin.rpc("add_usage_counter", { p_scope: SPEND_SCOPE, p_key: SPEND_KEY, p_delta: delta });
    if (error) throw new Error(error.message);
    unavailableReason = null;
    return Number(data);
  } catch (error) {
    unavailableReason = error.message;
    console.error("[zitoai] could not persist spend:", error.message);
    return null;
  }
}

// Shared fixed-window limiter. Returns null when the shared store is disabled or
// unreachable, which tells the caller to fall back to its in-memory decision rather
// than fail open or fail closed on a storage problem.
export async function hitSharedRateLimit(key, windowMs, maxRequests) {
  const admin = adminClient();
  if (!admin || !config.usage.sharedRateLimit) return null;
  try {
    const { data, error } = await admin.rpc("hit_rate_limit", {
      p_key: String(key),
      p_window_ms: Math.max(1000, Number(windowMs) || 60_000),
      p_max: Math.max(1, Number(maxRequests) || 30),
    });
    if (error) throw new Error(error.message);
    unavailableReason = null;
    return {
      ok: Boolean(data?.allowed),
      count: Number(data?.count) || 0,
      retryAfterSeconds: Math.max(1, Number(data?.retry_after_seconds) || 1),
    };
  } catch (error) {
    unavailableReason = error.message;
    console.error("[zitoai] shared rate limit unavailable, using in-memory:", error.message);
    return null;
  }
}

export async function pruneUsageCounters() {
  const admin = adminClient();
  if (!admin) return 0;
  try {
    const { data, error } = await admin.rpc("prune_usage_counters");
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  } catch (error) {
    console.error("[zitoai] could not prune usage counters:", error.message);
    return 0;
  }
}

// Test seam: lets a test point the module at a stub without reaching the network.
export function __setUsageClientForTests(stub) {
  client = stub;
  unavailableReason = null;
}
