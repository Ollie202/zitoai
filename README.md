# ZitoAI

ZitoAI is a production-oriented OKX.AI ASP and A2MCP service for rights-aware media search.

It helps users find licensable images, sound effects, music tracks, and ambience. The service accepts a natural language media brief in any major language, chooses the right provider, filters results by media type and usage fit, and returns strong matches with licensing metadata and the next licensing step.

## How a request is handled

1. **Parse and translate.** The brief is normalised into a provider-ready English search query. Requests in Yoruba, Igbo, Hausa, Nigerian Pidgin, Chinese, Arabic, Spanish and other major languages are translated before they reach a provider; the response reports `sourceLanguage` and `translated`.
2. **Route.** The detected media type selects the provider — images to Shutterstock, sound effects to Freesound, music to Jamendo.
3. **Screen.** Each result is scored against the provider's own licensing rules and the caller's intended use, producing a policy verdict rather than a legal opinion.
4. **Check the match.** Every result is scored against the concepts the request was actually about. If nothing matches, the same intent is searched again in different words before anything is returned.
5. **Rank.** Candidates are ordered by how well they match, then by policy verdict and price. The ranking model can only reorder assets the providers actually returned; it cannot introduce one.

A provider always returns *something*, even when its catalogue holds nothing close. Responses carry `matchQuality` and a per-result `relevance` verdict, so an off-target result is labelled rather than presented as an answer — and when nothing matches, the response says so.

If the model layer is unavailable, rate limited, or over budget, the service falls back to a deterministic local parser and still returns results.

## Live endpoints

| Surface | URL |
|---|---|
| ASP base | https://asp.zitoai.xyz |
| Health check | https://asp.zitoai.xyz/api/health |
| Agent card | https://asp.zitoai.xyz/.well-known/agent.json |
| A2MCP manifest | https://asp.zitoai.xyz/.well-known/a2mcp.json |
| A2MCP media search | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |

ZitoAI is an ASP on the OKX.AI marketplace, not a website. There is no browser UI and no static file surface — the base URL returns a JSON service descriptor pointing at the endpoints above. Agents are the only intended callers, and the marketplace listing is the only front door.

## Active providers

| Media type | Provider | Purpose |
|---|---|---|
| Images | Shutterstock | Image search, metadata, licensing endpoint support when the account token has the correct scopes and entitlement |
| Sound effects and ambience | Freesound | Sound search, previews, metadata, license capture, and OAuth-backed original download where authorized |
| Music tracks | Jamendo | Track search, previews, metadata, and commercial licensing handoff evidence |

ZitoAI does not route production search traffic to earlier prototype or research providers. The production boundary is intentionally limited to Shutterstock, Freesound, and Jamendo.

## A2MCP service

The public OKX.AI listing is x402, scheme `exact`, authorized with EIP-3009, priced at 0.

```text
Service name: Rights Media Search
Service type: API service
Fee: 0 USDT
Endpoint: https://asp.zitoai.xyz/api/a2mcp/media-search
```

Free is a price, not an exemption: a caller must still present a genuine EIP-3009 authorization to be served. Nothing is transferred, so nothing settles.

Unpaid calls return HTTP `402` with the challenge in the `PAYMENT-REQUIRED` header. Sign the `accepts` entry as an EIP-3009 `transferWithAuthorization` and replay the POST with a `PAYMENT-SIGNATURE` header; the result comes back with a `PAYMENT-RESPONSE` receipt.

Example request:

```bash
curl -X POST https://asp.zitoai.xyz/api/a2mcp/media-search \
  -H "PAYMENT-SIGNATURE: <base64 x402 v2 payment payload>" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"upbeat music for a 30 second product launch video\",\"assetType\":\"music\",\"intendedUse\":\"commercial_content\",\"territory\":\"worldwide\",\"limit\":5}"
```

Check the endpoint the way a listing review does:

```bash
node scripts/x402-selfcheck.mjs https://asp.zitoai.xyz
```

The endpoint is CORS-enabled for any origin and answers `OPTIONS` preflight with `204`, so browser-based agents can read the `402` challenge rather than seeing an opaque network failure.

### Payment verification

`/api/a2mcp/media-search` is gated by the official OKX Payment SDK — `@okxweb3/x402-express`'s `paymentMiddleware`, `@okxweb3/x402-evm`'s `ExactEvmScheme`, and the `OKXFacilitatorClient` from `@okxweb3/x402-core` — wired in [src/services/x402-sdk.js](src/services/x402-sdk.js). The SDK builds and encodes the 402 challenge, extracts the `PAYMENT-SIGNATURE` payload, and calls the live OKX facilitator to verify the EIP-3009 signature and settle; this service adds one thing on top the SDK does not provide itself — a local `(from, nonce)` claim (`onBeforeVerify`), closing the window before a settlement confirms on chain where the same signed header could otherwise be replayed. Missing facilitator credentials make `createPaymentGate` return `null`, and every gated route then fails closed with `503` rather than serving unauthenticated.

At the current price of 0 nothing settles, and the receipt reports it accordingly rather than inventing a transaction. Raising `OKX_PAYMENT_AMOUNT` turns settlement on with no other change; the listing fee must be raised to match.

`/api/search` and `/api/agent/search` run the same provider search and return the same product, so they sit behind the same gate and require the same EIP-3009 authorization — the gate is mounted once, ahead of all three routes, rather than copied per route.

An earlier version of this gate was hand-rolled (recovering the EIP-3009 signature and calling the facilitator directly) and was protocol-correct — proven against the live facilitator — but was rejected on resubmission for not using the official SDK. The SDK is now the only payment logic this service runs.

## Operational guardrails

| Guard | Default | Behaviour on limit |
|---|---|---|
| Per-IP request rate | 30 per minute | `429` with `Retry-After` |
| Model calls | 20 per minute | Falls back to the local parser |
| Model spend | 25 USD per process | Falls back to the local parser |
| Request body | 100 KB | `413` |
| Provider queries per search | 4 candidates, retried only on the primary | Returns the first response rather than repeating it |
| Model failure | Cross-provider fallback model | Retries on the other provider, then the local parser |

Spend accounting is persisted to Supabase and restored at startup, so the ceiling survives a deploy. Rate limiting is in-memory by default because the service runs a single replica; a shared Postgres limiter is available behind `USAGE_SHARED_RATE_LIMIT` for multi-replica deployments.

## Downloads

Jamendo's own download URL returns a valid MP3 with `Content-Type: text/html`, so any client that trusts the header renders binary audio as a web page. Music results therefore expose `mediaUrl` as a ZitoAI route that re-serves the same bytes as `audio/mpeg`:

```text
GET /api/providers/jamendo/tracks/{trackId}/download
```

The route accepts only a numeric track id and builds the upstream URL itself, so it cannot be used as a general proxy. Results also carry an explicit `mediaContentType` and `previewContentType` so agents never have to trust an upstream header, and `metadata.providerDownloadUrl` still records the original link.

## Local development

Requirements:

- Node.js 22 or newer — `@supabase/supabase-js` needs a native WebSocket, which older runtimes do not provide
- Provider credentials in `local.env` or `.env`

Install and run:

```powershell
npm install
npm test
npm start
```

There is no page to open. Check the service is up with:

```bash
curl http://localhost:3000/api/health
```

The search routes require an EIP-3009 authorization, so the way to exercise them locally
is the self-check, which signs one with a throwaway key and drives the whole handshake:

```bash
node scripts/x402-selfcheck.mjs http://localhost:3000
```

`/api/brief` is ungated and normalises a request without running a provider search:

```bash
curl -X POST http://localhost:3000/api/brief -H "Content-Type: application/json" -d "{\"query\":\"happy birthday music\"}"
```

The app loads `local.env` first, then `.env`, then process environment variables. Do not commit real secrets.

## Environment setup

Start from the template:

```powershell
Copy-Item .env.example local.env
```

Minimum useful production variables:

- `PUBLIC_BASE_URL`
- `ASP_BASE_URL`
- `OPENROUTER_API_KEY`
- `SHUTTERSTOCK_ACCESS_TOKEN`
- `FREESOUND_API_KEY`
- `JAMENDO_CLIENT_ID`
- Supabase variables if private history and evidence storage are enabled
- `PAY_TO_ADDRESS`, `OKX_PAYMENT_TOKEN_ADDRESS`, `OKX_PAYMENT_AMOUNT` for the x402 challenge
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` — required, or every paid call fails closed

Both OpenRouter models must support strict JSON-schema structured outputs. If a replacement model does not, `parse_brief` fails and every request silently degrades to the local parser — check `/api/health` (`brain.models`) and the `[openrouter]` log lines for `"success":false` to confirm which model is in use and why it fell back.

See [API key setup](docs/API-KEYS.md) for exact provider links and scopes.

## Project structure

```text
assets/                 Logo used when rendering Evidence Pack PDFs
src/
  core/                 Brief parsing, routing, policy logic
  lib/                  Shared HTTP helpers
  providers/            Provider catalog and search adapters
  services/             API services, OAuth, evidence, Supabase, A2MCP
test/                   Node test suite
docs/                   Production docs and operating notes
supabase/               Database migration for evidence and procurement records
```

## Production safety rules

- Provider API keys stay server-side.
- Browser code never receives provider secrets or wallet credentials.
- ZitoAI does not invent licenses, receipts, or legal clearance.
- Provider terms control the actual rights.
- Evidence Packs record proof supplied by provider APIs, receipts, and user supplied checkout evidence. They do not create new rights.
- Paid provider purchases remain separate from the A2MCP call fee and must be backed by provider evidence. Paying the call fee does not license the assets it returns.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API keys and callbacks](docs/API-KEYS.md)
- [Provider matrix](docs/provider-matrix.md)
- [Provider routing](docs/provider-routing.md)
- [Credential-aware adapters](docs/gated-adapters.md)
- [Operational status](docs/zitoai-status.md)
