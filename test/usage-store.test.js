// Counters are guardrails, not user data. The governing rule in these tests: a storage
// failure may cost accuracy, but it must never fail a request or silently remove a limit.
//
// These stub `fetch` rather than a client object, because the store deliberately calls
// PostgREST directly — @supabase/supabase-js needs a native WebSocket that does not
// exist before Node 22, and this code runs on the search path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "../src/config.js";
import {
  hitSharedRateLimit,
  pruneUsageCounters,
  readPersistedSpendUsd,
  recordSpendUsd,
  usageStoreStatus,
} from "../src/services/usage-store.js";

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const fn = String(url).split("/rpc/")[1];
    const args = JSON.parse(options.body || "{}");
    calls.push({ fn, args, url: String(url), headers: options.headers });
    return handler(fn, args);
  };
  return calls;
}

function ok(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function snapshot() {
  return {
    durableSpend: config.usage.durableSpend,
    sharedRateLimit: config.usage.sharedRateLimit,
    url: config.supabase.url,
    key: config.supabase.serviceRoleKey,
  };
}

function restore(previous) {
  config.usage.durableSpend = previous.durableSpend;
  config.usage.sharedRateLimit = previous.sharedRateLimit;
  config.supabase.url = previous.url;
  config.supabase.serviceRoleKey = previous.key;
}

function configureStore({ durableSpend = false, sharedRateLimit = false } = {}) {
  config.usage.durableSpend = durableSpend;
  config.usage.sharedRateLimit = sharedRateLimit;
  config.supabase.url = "https://project.supabase.co";
  config.supabase.serviceRoleKey = "service-role-key";
}

const previousFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = previousFetch; });

// The regression that took production down: this module runs on the search path, so it
// must not depend on a library with a Node version floor above what the platform runs.
test("the store does not depend on the supabase client library", async () => {
  const source = await readFile(new URL("../src/services/usage-store.js", import.meta.url), "utf8");
  // Matches a real import, not the comment above that explains why there isn't one.
  assert.doesNotMatch(source, /^\s*import[^;]*["']@supabase\/supabase-js["']/m);
  assert.doesNotMatch(source, /require\(\s*["']@supabase\/supabase-js["']\s*\)/);
});

test("spend accumulates through the durable counter", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  let total = 0;
  const calls = stubFetch((fn, args) => {
    assert.equal(fn, "add_usage_counter");
    total += Number(args.p_delta);
    return ok(total);
  });

  try {
    assert.equal(await recordSpendUsd(0.25), 0.25);
    assert.equal(await recordSpendUsd(0.5), 0.75);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.p_scope, "openrouter_spend");
    assert.equal(calls[0].headers.apikey, "service-role-key", "the service role key authenticates the RPC");
  } finally {
    restore(previous);
  }
});

test("a storage error while recording spend is swallowed", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  stubFetch(() => new Response("permission denied", { status: 500 }));

  try {
    // The model call already succeeded and the user already has their result; this must
    // not throw back into the request.
    assert.equal(await recordSpendUsd(0.25), null);
    assert.match(usageStoreStatus().lastError, /HTTP 500/);
  } finally {
    restore(previous);
  }
});

test("a network failure while recording spend is swallowed", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  stubFetch(() => { throw new Error("socket hang up"); });

  try {
    assert.equal(await recordSpendUsd(1), null);
    assert.match(usageStoreStatus().lastError, /socket hang up/);
  } finally {
    restore(previous);
  }
});

test("zero, negative and non-numeric spend never reach storage", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  const calls = stubFetch(() => ok(1));

  try {
    for (const value of [0, -1, NaN, null, undefined, "free"]) {
      assert.equal(await recordSpendUsd(value), null, `${value} must not be written`);
    }
    assert.equal(calls.length, 0);
  } finally {
    restore(previous);
  }
});

test("an unconfigured store makes no network calls", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  config.supabase.url = "";
  config.supabase.serviceRoleKey = "";
  const calls = stubFetch(() => ok(1));

  try {
    assert.equal(await recordSpendUsd(0.25), null);
    assert.equal(calls.length, 0);
    assert.match(usageStoreStatus().lastError, /not configured/);
  } finally {
    restore(previous);
  }
});

test("durable spend can be turned off entirely", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: false });
  const calls = stubFetch(() => ok(5));

  try {
    assert.equal(await recordSpendUsd(0.25), null);
    assert.equal(await readPersistedSpendUsd(), null);
    assert.equal(calls.length, 0, "no storage traffic when disabled");
  } finally {
    restore(previous);
  }
});

test("the persisted total is read back for restart recovery", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  stubFetch((fn) => (fn === "read_usage_counter" ? ok("12.5") : ok(null)));

  try {
    assert.equal(await readPersistedSpendUsd(), 12.5);
  } finally {
    restore(previous);
  }
});

test("an unreadable total yields null so startup keeps its local figure", async () => {
  const previous = snapshot();
  configureStore({ durableSpend: true });
  stubFetch(() => new Response("timeout", { status: 504 }));

  try {
    assert.equal(await readPersistedSpendUsd(), null);
  } finally {
    restore(previous);
  }
});

test("the shared rate limiter reports allow and deny", async () => {
  const previous = snapshot();
  configureStore({ sharedRateLimit: true });
  stubFetch((fn, args) => {
    assert.equal(fn, "hit_rate_limit");
    const count = args.p_key === "over" ? 31 : 1;
    return ok({ allowed: count <= args.p_max, count, retry_after_seconds: 42 });
  });

  try {
    assert.equal((await hitSharedRateLimit("under", 60_000, 30)).ok, true);
    const denied = await hitSharedRateLimit("over", 60_000, 30);
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfterSeconds, 42);
  } finally {
    restore(previous);
  }
});

test("an unreachable shared limiter returns null rather than failing open or closed", async () => {
  const previous = snapshot();
  configureStore({ sharedRateLimit: true });
  stubFetch(() => { throw new Error("database unreachable"); });

  try {
    // null tells the caller to trust its in-memory decision. Returning ok:true would
    // remove the limit during an outage; ok:false would take the service down with it.
    assert.equal(await hitSharedRateLimit("ip", 60_000, 30), null);
  } finally {
    restore(previous);
  }
});

test("the shared limiter is off by default and costs no round trip", async () => {
  const previous = snapshot();
  configureStore({ sharedRateLimit: false });
  const calls = stubFetch(() => ok({ allowed: false }));

  try {
    assert.equal(await hitSharedRateLimit("ip", 60_000, 30), null);
    assert.equal(calls.length, 0, "a single replica must not pay for a database call per request");
  } finally {
    restore(previous);
  }
});

test("window and max arguments are clamped to sane values", async () => {
  const previous = snapshot();
  configureStore({ sharedRateLimit: true });
  const calls = stubFetch(() => ok({ allowed: true, count: 1, retry_after_seconds: 1 }));

  try {
    await hitSharedRateLimit("ip", 5, 0);
    assert.equal(calls[0].args.p_window_ms, 1000, "a sub-second window would spin the database");
    assert.equal(calls[0].args.p_max, 30, "a zero maximum would block every request");

    await hitSharedRateLimit("ip", "nonsense", "nonsense");
    assert.equal(calls[1].args.p_window_ms, 60_000);
    assert.equal(calls[1].args.p_max, 30);
  } finally {
    restore(previous);
  }
});

test("pruning failures are non-fatal", async () => {
  const previous = snapshot();
  configureStore({});
  stubFetch(() => new Response("nope", { status: 500 }));

  try {
    assert.equal(await pruneUsageCounters(), 0);
  } finally {
    restore(previous);
  }
});
