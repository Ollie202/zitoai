# ZitoAI

ZitoAI is a production-oriented OKX.AI ASP and A2MCP service for rights-aware media search.

It helps users find licensable images, sound effects, music tracks, and ambience. The service accepts a natural language media brief in any major language, chooses the right provider, filters results by media type and usage fit, and returns strong matches with licensing metadata and the next licensing step.

## How a request is handled

1. **Parse and translate.** The brief is normalised into a provider-ready English search query. Requests in Yoruba, Igbo, Hausa, Nigerian Pidgin, Chinese, Arabic, Spanish and other major languages are translated before they reach a provider; the response reports `sourceLanguage` and `translated`.
2. **Route.** The detected media type selects the provider — images to Shutterstock, sound effects to Freesound, music to Jamendo.
3. **Screen.** Each result is scored against the provider's own licensing rules and the caller's intended use, producing a policy verdict rather than a legal opinion.
4. **Rank.** Candidates are ordered by policy verdict and price, then re-ranked for fit against the brief. The ranking model can only reorder assets the providers actually returned; it cannot introduce one.

If the model layer is unavailable, rate limited, or over budget, the service falls back to a deterministic local parser and still returns results.

## Live endpoints

| Surface | URL |
|---|---|
| Website | https://www.zitoai.xyz |
| ASP base | https://asp.zitoai.xyz |
| Health check | https://asp.zitoai.xyz/api/health |
| A2MCP manifest | https://asp.zitoai.xyz/.well-known/a2mcp.json |
| A2MCP media search | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |

## Active providers

| Media type | Provider | Purpose |
|---|---|---|
| Images | Shutterstock | Image search, metadata, licensing endpoint support when the account token has the correct scopes and entitlement |
| Sound effects and ambience | Freesound | Sound search, previews, metadata, license capture, and OAuth-backed original download where authorized |
| Music tracks | Jamendo | Track search, previews, metadata, and commercial licensing handoff evidence |

ZitoAI does not route production search traffic to earlier prototype or research providers. The production boundary is intentionally limited to Shutterstock, Freesound, and Jamendo.

## A2MCP service

The current public OKX.AI listing mode is zero-fee x402.

```text
Service name: Rights Media Search
Service type: API service
Fee: 0 USDT
Endpoint: https://asp.zitoai.xyz/api/a2mcp/media-search
```

Unpaid calls return HTTP `402` with an `accepts` array. OKX agents should complete the standard pay-and-replay handshake, then replay the POST request to receive results.

Example request:

```bash
curl -X POST https://asp.zitoai.xyz/api/a2mcp/media-search \
  -H "X-PAYMENT: <payment-proof-from-okx-pay-and-replay>" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"upbeat music for a 30 second product launch video\",\"assetType\":\"music\",\"intendedUse\":\"commercial_content\",\"territory\":\"worldwide\",\"limit\":5}"
```

The endpoint is CORS-enabled for any origin and answers `OPTIONS` preflight with `204`, so browser-based agents can read the `402` challenge rather than seeing an opaque network failure.

### Zero-fee mode and payment verification

The listed price is `0 USDT`. The endpoint gates on the presence of a payment proof header so that agents complete the standard handshake, but it does not cryptographically verify the authorization, because at a zero amount a valid signature and an arbitrary one grant identical access. Verification of the signer, amount, recipient and nonce must be added in the same change that introduces a non-zero price. The same applies to `/api/search`, which serves the same results without a payment header while the service is free.

## Operational guardrails

| Guard | Default | Behaviour on limit |
|---|---|---|
| Per-IP request rate | 30 per minute | `429` with `Retry-After` |
| Model calls | 20 per minute | Falls back to the local parser |
| Model spend | 25 USD per process | Falls back to the local parser |
| Request body | 100 KB | `413` |
| Provider queries per search | 4 candidates, retried only on the primary | Returns the first response rather than repeating it |

## Local development

Requirements:

- Node.js 20 or newer
- Provider credentials in `local.env` or `.env`

Install and run:

```powershell
npm install
npm test
npm start
```

Open `http://localhost:3000`.

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
- `PAY_TO_ADDRESS`, `OKX_PAYMENT_TOKEN_ADDRESS`, `OKX_PAYMENT_AMOUNT=0` for the zero-fee x402 challenge

Both OpenRouter models must support strict JSON-schema structured outputs. If a replacement model does not, `parse_brief` fails and every request silently degrades to the local parser — check `/api/health` (`brain.models`) and the `[openrouter]` log lines for `"success":false` to confirm which model is in use and why it fell back.

See [API key setup](docs/API-KEYS.md) for exact provider links and scopes.

## Project structure

```text
public/                 Static website, browser UI, legal pages, logo assets
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
- Paid provider purchases remain separate from the zero-fee A2MCP call and must be backed by provider evidence.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API keys and callbacks](docs/API-KEYS.md)
- [Provider matrix](docs/provider-matrix.md)
- [Provider routing](docs/provider-routing.md)
- [Credential-aware adapters](docs/gated-adapters.md)
- [Operational status](docs/zitoai-status.md)
