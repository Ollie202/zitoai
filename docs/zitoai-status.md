# ZitoAI production status

Last updated: 2026-07-20

## Current state

ZitoAI is a zero-fee OKX.AI ASP and A2MCP API service for rights-aware media search. The endpoint is free to call, but it still uses an x402 challenge so OKX agents can complete the standard pay-and-replay flow.

| Item | Status |
|---|---|
| Public website | Live at https://www.zitoai.xyz |
| ASP base | Live at https://asp.zitoai.xyz |
| A2MCP manifest | Live at https://asp.zitoai.xyz/.well-known/a2mcp.json |
| Primary service endpoint | `POST https://asp.zitoai.xyz/api/a2mcp/media-search` |
| Pricing mode | Zero-fee x402 |
| Payment challenge | Enabled with amount `0` |
| Active providers | Shutterstock, Freesound, Jamendo |
| Brain layer | OpenRouter with deterministic fallback |
| Storage | Supabase optional for private history and evidence |

## What the service can do

ZitoAI can:

- Accept natural language media requests from users, agents or OKX.AI callers.
- Accept multilingual briefs, including English, major world languages, Nigerian Pidgin, Yoruba, Igbo and Hausa.
- Preserve the original user request while creating an English provider-ready search query for Shutterstock, Freesound and Jamendo.
- Infer or respect requested media type.
- Route image requests to Shutterstock.
- Route sound effect and ambience requests to Freesound.
- Route music track requests to Jamendo.
- Return normalized results with provider, asset ID, title, creator, preview URL, source URL, license metadata and policy notes.
- Generate PDF or JSON License Evidence Packs from supplied provider and transaction evidence.
- Store private procurement history and evidence when Supabase is configured.
- Expose an A2MCP manifest for OKX.AI registration.
- Return a valid 402 payment challenge on unpaid A2MCP media-search requests.

## What the service does not claim

ZitoAI does not:

- Create legal rights by itself.
- Replace the provider’s license agreement.
- Provide legal advice.
- Claim a paid provider purchase happened unless provider evidence or user supplied checkout evidence is recorded.
- Automatically make Jamendo commercial purchases through the public read API.
- Treat Freesound files as automatically commercial-safe without checking file-level license terms and provider authorization.
- License Shutterstock images unless the configured OAuth token has the correct scopes and account entitlement.

## Provider status

### Shutterstock

Purpose: image search and image licensing support.

Production dependency:

- `SHUTTERSTOCK_ACCESS_TOKEN`
- Correct OAuth scopes: `licenses.create`, `licenses.view`, `purchases.view`
- Active image API subscription or entitlement

Search can work before licensing is fully entitled. Real licensing requires the account and token to be valid for licensing.

### Freesound

Purpose: sound effects and ambience.

Production dependency:

- `FREESOUND_API_KEY`
- `FREESOUND_CLIENT_ID` and `FREESOUND_CLIENT_SECRET` for OAuth-backed account actions

Each result’s own license remains controlling.

### Jamendo

Purpose: music tracks.

Production dependency:

- `JAMENDO_CLIENT_ID`

The public API supports catalog search and metadata. Commercial licensing is handled as a Jamendo checkout or agreement handoff unless a separate commercial API agreement authorizes deeper execution.

## OpenRouter guardrails

The AI layer is intentionally bounded:

- 20 calls per minute
- 12000 input characters per request
- deterministic fallback when OpenRouter is unavailable

There is no hardcoded dollar spend cap in the application because spend is managed at the OpenRouter key level.

## Testing checklist

Before registration or production handoff:

1. Run `npm test`.
2. Check `GET https://asp.zitoai.xyz/api/health`.
3. Check `GET https://asp.zitoai.xyz/.well-known/a2mcp.json`.
4. Test one image prompt against `/api/a2mcp/media-search`.
5. Test one sound effect or ambience prompt against `/api/a2mcp/media-search`.
6. Test one music prompt against `/api/a2mcp/media-search`.
7. Confirm unpaid calls to `/api/a2mcp/media-search` return HTTP `402` with an `accepts` array.
8. Confirm Railway has only the production variables listed in `.env.example`.

## Latest endpoint flow test

Date: 2026-07-20

Endpoint tested locally:

```text
POST /api/a2mcp/media-search
```

Test shape:

- 15 languages and moods for Shutterstock image licensing discovery.
- 15 languages and moods for Freesound sound effect and ambience discovery.
- 15 languages and moods for Jamendo music licensing discovery.
- Provider lanes were forced during testing so each provider was validated directly.
- OpenRouter parsing and ranking were active, with calls paced to respect the 20 calls per minute guardrail.

Result:

| Provider | Final result |
|---|---:|
| Shutterstock | 15 / 15 |
| Freesound | 15 / 15 |
| Jamendo | 14 / 15 on full rerun, then the remaining Russian Jamendo case passed on isolated rerun |

Hardening added from this test:

- Multilingual media-type detection for image, sound effect and music prompts.
- Search fallback handling for translated or non-English provider queries.
- Top-level `licenseUrl` fields on provider results so agents can find license links without inspecting nested metadata.
- Retry handling for transient provider fetch failures.

Current multilingual behavior:

- OpenRouter/Gemini parses incoming language, usage, mood, keywords and media type.
- The backend stores `originalQuery`, `sourceLanguage`, `translated`, and provider-ready English `query` in the normalized brief.
- Local fallback includes basic support for Nigerian Pidgin, Yoruba, Igbo and Hausa media cues when OpenRouter is unavailable.
- The frontend shows the detected language, provider search query and original request when they differ.

Latest x402 reviewer fix:

- The endpoint is no longer treated as plain free HTTP.
- Unpaid GET and POST requests to `/api/a2mcp/media-search` return HTTP `402`.
- The 402 body includes `x402Version: 1` and an `accepts` array.
- The accepted asset is X Layer USDT: `0x779ded0c9e1022225f8e0630b35a9b54be713736`.
- The accepted amount is `0`, matching the free listing while preserving the OKX pay-and-replay handshake.
- Replayed POST requests with a payment proof header return HTTP `200` and the normal A2MCP result.

Honest limitation:

The endpoint returns provider licensing, source and checkout links. It does not claim that a paid provider purchase has happened unless a real provider license action or external checkout evidence is recorded.

## Current registration copy

ASP description:

```text
ZitoAI helps users quickly find licensable images, sound effects, music tracks, and ambience for real creative work. It understands natural language requests, searches the most relevant provider, filters the results, and returns the strongest matches with the licensing details needed to move from idea to usable asset.
```

Service description:

```text
ZitoAI provides zero-fee x402 access to a rights-aware media search and licensing assistant. It takes a natural language request, understands the intended use, searches the most relevant provider, filters the results by media type and usage fit, and returns the strongest matches for images, sound effects, music tracks, and ambience with the licensing details needed to choose the right asset.
```

## Remaining operational work

- Re-run OKX x402 validation against the live Railway deployment after this fix is deployed.
- Keep provider tokens fresh in Railway.
- Rotate any provider secrets that were exposed in screenshots or chat.
- If the listing intentionally changes from zero-fee to paid, update `OKX_PAYMENT_AMOUNT`, the registration fee, and the reviewer-facing docs together.
