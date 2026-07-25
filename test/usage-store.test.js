// Counters are guardrails, not user data. The governing rule in these tests: a storage
// failure may cost accuracy, but it must never fail a request or silently remove a limit.
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  __setUsageClientForTests,
  hitSharedRateLimit,
  readPersistedSpendUsd,
  recordSpendUsd,
  usageStoreStatus,
} from "../src/services/usage-store.js";

function stubClient(handler) {
  const calls = [];
  __setUsageClientForTests({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return handler(name, args);
    },
  });
  return calls;
}

function restoreConfig(previous) {
  config.usage.durableSpend = previous.durableSpend;
  config.usage.sharedRateLimit = previous.sharedRateLimit;
}

function snapshotConfig() {
  return { durableSpend: config.usage.durableSpend, sharedRateLimit: config.usage.sharedRateLimit };
}

test.afterEach(() => __setUsageClientForTests(null));

test("spend accumulates through the durable counter", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  let total = 0;
  const calls = stubClient((name, args) => {
    if (name !== "add_usage_counter") return { data: null, error: { message: "unexpected rpc " + name } };
    total += Number(args.p_delta);
    return { data: total, error: null };
  });

  try {
    assert.equal(await recordSpendUsd(0.25), 0.25);
    assert.equal(await recordSpendUsd(0.5), 0.75);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.p_scope, "openrouter_spend");
  } finally {
    restoreConfig(previous);
  }
});

test("a storage failure while recording spend is swallowed", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  stubClient(() => ({ data: null, error: { message: "connection refused" } }));

  try {
    // The model call already succeeded and the user already has their result; this must
    // not throw back into the request.
    assert.equal(await recordSpendUsd(0.25), null);
    assert.match(usageStoreStatus().lastError, /connection refused/);
  } finally {
    restoreConfig(previous);
  }
});

test("a thrown storage error while recording spend is also swallowed", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  stubClient(() => { throw new Error("socket hang up"); });

  try {
    assert.equal(await recordSpendUsd(1), null);
  } finally {
    restoreConfig(previous);
  }
});

test("zero, negative and non-numeric spend never reach storage", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  const calls = stubClient(() => ({ data: 1, error: null }));

  try {
    for (const value of [0, -1, NaN, null, undefined, "free"]) {
      assert.equal(await recordSpendUsd(value), null, `${value} must not be written`);
    }
    assert.equal(calls.length, 0);
  } finally {
    restoreConfig(previous);
  }
});

test("durable spend can be turned off entirely", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = false;
  const calls = stubClient(() => ({ data: 5, error: null }));

  try {
    assert.equal(await recordSpendUsd(0.25), null);
    assert.equal(await readPersistedSpendUsd(), null);
    assert.equal(calls.length, 0, "no storage traffic when disabled");
  } finally {
    restoreConfig(previous);
  }
});

test("the persisted total is read back for restart recovery", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  stubClient((name) => (name === "read_usage_counter" ? { data: "12.5", error: null } : { data: null, error: { message: "no" } }));

  try {
    assert.equal(await readPersistedSpendUsd(), 12.5);
  } finally {
    restoreConfig(previous);
  }
});

test("an unreadable total yields null so startup keeps its local figure", async () => {
  const previous = snapshotConfig();
  config.usage.durableSpend = true;
  stubClient(() => ({ data: null, error: { message: "timeout" } }));

  try {
    assert.equal(await readPersistedSpendUsd(), null);
  } finally {
    restoreConfig(previous);
  }
});

test("the shared rate limiter reports allow and deny", async () => {
  const previous = snapshotConfig();
  config.usage.sharedRateLimit = true;
  stubClient((name, args) => {
    assert.equal(name, "hit_rate_limit");
    const count = args.p_key === "over" ? 31 : 1;
    return { data: { allowed: count <= args.p_max, count, retry_after_seconds: 42 }, error: null };
  });

  try {
    const allowed = await hitSharedRateLimit("under", 60_000, 30);
    assert.equal(allowed.ok, true);

    const denied = await hitSharedRateLimit("over", 60_000, 30);
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfterSeconds, 42);
  } finally {
    restoreConfig(previous);
  }
});

test("an unreachable shared limiter returns null rather than failing open or closed", async () => {
  const previous = snapshotConfig();
  config.usage.sharedRateLimit = true;
  stubClient(() => { throw new Error("database unreachable"); });

  try {
    // null tells the caller to trust its in-memory decision. Returning ok:true would
    // remove the limit during an outage; ok:false would take the service down with it.
    assert.equal(await hitSharedRateLimit("ip", 60_000, 30), null);
  } finally {
    restoreConfig(previous);
  }
});

test("the shared limiter is off by default and costs no round trip", async () => {
  const previous = snapshotConfig();
  config.usage.sharedRateLimit = false;
  const calls = stubClient(() => ({ data: { allowed: false }, error: null }));

  try {
    assert.equal(await hitSharedRateLimit("ip", 60_000, 30), null);
    assert.equal(calls.length, 0, "a single replica must not pay for a database call per request");
  } finally {
    restoreConfig(previous);
  }
});

test("window and max arguments are clamped to sane values", async () => {
  const previous = snapshotConfig();
  config.usage.sharedRateLimit = true;
  const calls = stubClient(() => ({ data: { allowed: true, count: 1, retry_after_seconds: 1 }, error: null }));

  try {
    await hitSharedRateLimit("ip", 5, 0);
    assert.equal(calls[0].args.p_window_ms, 1000, "a sub-second window would spin the database");
    assert.equal(calls[0].args.p_max, 30, "a zero maximum would block every request");

    await hitSharedRateLimit("ip", "nonsense", "nonsense");
    assert.equal(calls[1].args.p_window_ms, 60_000);
    assert.equal(calls[1].args.p_max, 30);
  } finally {
    restoreConfig(previous);
  }
});
