# ZitoAI architecture

ZitoAI is a rights-aware media search ASP for OKX.AI. It exposes one zero-priced A2MCP API service that accepts natural language media requests and returns provider-backed candidates with licensing metadata after an official OKX x402/EIP-3009 authorization.

## Product boundary

ZitoAI helps users discover licensable media and understand the next licensing step. It does not create rights, transfer rights, provide legal advice, or claim that a provider purchase happened unless provider evidence or user supplied checkout evidence exists.

## Runtime flow

```text
Agent or user request
        |
        v
A2MCP endpoint
        |
        v
Request validation and bounded execution
        |
        v
Brief parser
        |
        v
Provider router
        |
        +--> Shutterstock for images
        +--> Freesound for sound effects and ambience
        +--> Jamendo for music tracks
        |
        v
Provider adapters
        |
        v
Normalized media candidates
        |
        v
Policy screen and evidence metadata
        |
        v
A2MCP response with results, scopes, license metadata, previews and next step
```

## Public API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Runtime status for brain, storage, OAuth and official x402 payment mode |
| `GET` | `/.well-known/a2mcp.json` | OKX.AI A2MCP service manifest |
| `POST` | `/api/a2mcp/media-search` | Primary zero-priced ASP endpoint. Unsigned calls return 402; verified EIP-3009 replays return results |
| `POST` | `/api/search` | Compatibility alias protected by the same x402 middleware |
| `POST` | `/api/brief` | Brief normalization endpoint |
| `GET` | `/api/providers` | Provider configuration status |
| `POST` | `/api/evidence-pack` | JSON or PDF evidence export |

Provider-specific support endpoints exist for OAuth, Shutterstock licensing, Freesound original download, and procurement evidence storage.

## Normalized brief

```ts
type ProcurementBrief = {
  query: string;
  assetType: "image" | "sound_effect" | "music";
  intendedUse: string;
  commercial: boolean;
  broadcast: boolean;
  rawAssetRequired: boolean;
  territory: string;
  budgetUsd: number | null;
  keywords: string[];
};
```

## Provider adapter contract

Each provider adapter returns normalized candidates with this shape:

```ts
type MediaCandidate = {
  id: string;
  provider: "shutterstock" | "freesound" | "jamendo";
  title: string;
  creator: string;
  assetType: "image" | "sound_effect" | "music";
  previewUrl: string | null;
  mediaUrl: string | null;
  sourceUrl: string;
  purchaseUrl: string | null;
  priceUsd: number | null;
  license: {
    code: string | null;
    name: string | null;
    url: string | null;
    attributionRequired: boolean;
  };
  metadata: Record<string, unknown>;
};
```

## Provider responsibilities

### Shutterstock

Used for image results and image licensing workflows. Search uses the configured Shutterstock access token. Real licensing requires an OAuth access token with the correct license scopes and an active image API subscription.

### Freesound

Used for sound effects and ambience. Search and previews use the API token. OAuth is used for user-account actions such as original-file download when authorized. Each sound’s own license remains the controlling license.

### Jamendo

Used for music tracks. The public developer API supports catalog search and metadata. Commercial use is handled as a Jamendo licensing handoff unless the account has a separate commercial agreement that authorizes deeper execution.

## Brain layer

OpenRouter improves intent parsing, translation, provider routing, keyword expansion and ranking. Two models are used:

| Function | Model variable | Default | Role |
|---|---|---|---|
| `parse_brief` | `OPENROUTER_FAST_MODEL` | `google/gemini-2.5-flash` | Detects the source language, translates the request into a provider-ready English query, and classifies media type and usage rights |
| `rank_results` | `OPENROUTER_SMART_MODEL` | `openai/gpt-4o-mini` | Reorders the candidates the providers returned |

Model selection is measured, not assumed. Over 120 parses spanning 20 languages — weighted toward Yoruba, Igbo, Hausa, Nigerian Pidgin and code-switched requests — the candidates scored:

| Model | Meaning | Asset type | Language | Variance | p50 |
|---|---|---|---|---|---|
| `google/gemini-2.5-flash` | 100% | **100%** | 100% | **0** | 510ms |
| `openai/gpt-4o-mini` | 100% | 99% | 100% | 1 | 682ms |
| `openai/gpt-4.1-mini` | 100% | 99% | 100% | 1 | 426ms |
| `google/gemini-2.5-flash-lite` | 100% | 98% | 100% | 1 | 514ms |
| `deepseek/deepseek-chat` | 98% | 98% | 100% | 1 | 829ms |
| `meta-llama/llama-3.3-70b-instruct` | disqualified — returns `undefined` fields under strict mode | | | | |

Translation quality is effectively tied across the top four; `gemini-2.5-flash` takes parsing on asset-type accuracy and zero run-to-run variance. Ranking goes to the other provider's model because its output is validated against the candidate set, so a weaker ranking cannot produce a wrong answer — only a less useful order.

### Fallback

Each function has a model chain: the primary, then a fallback from a *different provider*. A model that errors, or that returns output the caller cannot use — unparseable JSON for parsing, a hallucinated asset id for ranking — hands over to the next model. Only when every model in the chain has failed does the request fall back to the deterministic local parser.

This means a provider-wide incident degrades one function rather than disabling the AI layer. `/api/health` reports both the active model and its fallback.

Both calls use strict JSON-schema structured outputs. Every schema property declares an explicit `type`: an enum without a type is not valid under strict mode, and providers that enforce it satisfy `required` by emitting `null`, which previously caused a complete and correctly translated brief to be rejected by validation.

Validation is deliberately asymmetric. The translated query is the valuable output, so an unrecognised classifier value degrades rather than discards: `asset_type` falls back to local inference and `usage_rights` to the conservative `personal` default. Only structurally unusable output is rejected.

It is bounded by guardrails:

- 20 model calls per minute
- 25 USD cumulative spend per process
- 12000 input characters per request
- deterministic local fallback when OpenRouter is unavailable, rate limited, or over budget

The model can improve interpretation and ranking. It cannot override provider policies or invent licensing permission — `rank_results` output is checked against the returned candidate set, so a hallucinated asset is rejected.

## Relevance: does the result answer the request?

Translation was never the weak point. The brief is turned into good English, then handed to a provider as a literal keyword search — and when a catalogue has nothing close, the provider still returns its best guess. A Hausa birthday request came back as *"I'm Walking Away"*, presented as a match with nothing marking it off-target.

Three things now sit between the provider and the caller:

**Concepts.** The parser returns `core_concepts` — the two to four ideas a result must actually be about, excluding the media type itself, since every result in a lane satisfies that. When the model is unavailable these are derived locally from the request with a stopword filter, so relevance checking still works on the fallback path.

**Scoring.** Every returned asset is scored against those concepts using everything the provider describes it with: title, album, description, tags, music-info tags, keywords and categories. Matching is substring-with-stemming here, deliberately unlike the brief parser's word-boundary rule — a tag list is not prose, and "birthday" should match "Birthdays".

| Strength | Meaning |
|---|---|
| `strong` | ≥ 2/3 of the concepts are present |
| `partial` | some are present |
| `weak` | none are — the catalogue returned something unrelated |

**Retry.** If nothing scores strong, the same intent is searched again using `alternate_queries` — differently worded English for the same request. A retry only replaces the first attempt when it is genuinely better, and is capped at two rephrasings so an unmatchable request cannot fan out across providers.

Results are ordered by relevance first, then licensing verdict, then price. A permissively licensed asset that is not what was asked for is still the wrong asset.

When nothing matches, the response says so in `matchQuality.notice` rather than letting the closest available result read as an answer. The web UI shows the same thing as a per-result badge next to the licensing verdict.

## Request guardrails

| Guard | Default | Behaviour on limit |
|---|---|---|
| Per-IP rate limit on search routes | 30 per minute | `429` with `Retry-After` |
| Request body size | 100 KB | `413`, with the remaining upload drained so the response is delivered cleanly |
| Provider query candidates per search | 4, retried only on the primary | Returns the first response rather than repeating a known-empty query |

### Durable counters

Guardrail state lives in `public.usage_counters`, written only by the service role. RLS is enabled with no policies, so the anon and authenticated roles have no access at all — these are operational counters, never user data.

**Spend is durable by default.** An in-memory total resets on every deploy, which makes a cumulative ceiling meaningless: the service would hand itself a fresh $25 budget on each release. The running total is now persisted through an atomic `add_usage_counter` and restored at startup. Writes happen after the model response is already in hand and are never awaited, so a storage failure costs accounting accuracy rather than the user's request.

**Rate limiting stays in memory by default.** The service runs a single replica, where the local window is both correct and faster than a database round trip on every request. A shared Postgres limiter is implemented and tested behind `USAGE_SHARED_RATE_LIMIT`; enable it when running more than one instance.

When the shared limiter is enabled it is authoritative, because it sees every replica, but the in-memory window is still consulted. If the shared store is unreachable the request falls back to the local decision — deliberately neither failing open, which would remove the limit during an outage, nor failing closed, which would take the service down with the database.

The A2MCP endpoint sets permissive CORS on every response and answers `OPTIONS` preflight with `204`.

## Storage and evidence

Supabase stores private procurement records, provider connections, purchases and evidence artifacts when configured. Evidence Packs can also be generated locally as PDF or JSON without requiring a signed-in user.

Evidence Packs record:

- request and normalized brief
- provider, asset ID and source URL
- license metadata and controlling URL
- policy verdict and warnings
- purchase or checkout evidence if supplied
- generated hash

An Evidence Pack is proof of recorded evidence, not a replacement license.

## Service delivery mode

`/api/a2mcp/media-search` is registered with a `0 USDT` fee. It uses the official `@okxweb3/x402-express`, `@okxweb3/x402-core`, and `@okxweb3/x402-evm` packages. An unsigned POST returns an x402 v2 `402` challenge. Its `accepts` entry selects `exact`, X Layer (`eip155:196`), USD₮0, and amount `0`. The caller signs an EIP-3009 `transferWithAuthorization` and replays the request; the OKX facilitator verifies it before the search handler runs.

Each request receives an `X-Request-Id`. Structured start, success, failure, duration, provider, and result-count events are written to the service log. `A2MCP_SEARCH_TIMEOUT_MS` bounds the synchronous call and returns `504` if the provider pipeline cannot finish in time.

All three search paths use the same middleware. The zero-value settlement path does not fabricate a token transfer: after OKX verification succeeds, it returns the SDK-compatible zero-value receipt because there is no token amount to broadcast.

Provider purchases, if performed later, must still be explicitly confirmed and backed by provider evidence. A zero-priced A2MCP call does not license the provider assets it returns.

## Security model

- Provider secrets stay in server environment variables.
- Browser code never receives provider secrets, service role keys or wallet credentials.
- Authorization headers and OAuth tokens must not be logged.
- Raw media delivery is only allowed when provider terms permit it.
- Metadata can be cached; raw assets should not be cached unless provider terms allow it.
- User supplied evidence is recorded as evidence, not treated as automatically verified.
