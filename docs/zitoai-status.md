# ZitoAI status

Last updated: 2026-07-18

ZitoAI is now built as an OKX.AI ASP service with an A2MCP-style API surface.

## Live surface

- Public site: `https://zitoai.xyz`
- Public site alias: `https://www.zitoai.xyz`
- ASP/API host: `https://asp.zitoai.xyz`

## What ZitoAI can do right now

- Parse a plain-language media request into a structured brief.
- Search and rank provider candidates for:
  - images via Shutterstock
  - sound effects / ambience / one-shots via Freesound
  - music tracks via Jamendo
- Show provider-specific policy warnings and licensing caveats.
- Expose provider status endpoints for each source.
- Create an evidence pack (`JSON` or `PDF`) from the selected asset plus user-supplied transaction/licensing evidence.
- Keep procurement history and evidence in Supabase when configured.
- Support provider account connections through OAuth where available.
- Expose a public ASP/A2MCP manifest for OKX.AI marketplace use.
- Use OpenRouter for guarded brief parsing and post-filter result ranking, while keeping licensing decisions in the deterministic provider/policy layer.

## Verified endpoints

### A2MCP / ASP

- `GET https://asp.zitoai.xyz/.well-known/a2mcp.json`
- `GET https://asp.zitoai.xyz/api/a2mcp`
- `GET https://asp.zitoai.xyz/api/a2mcp/manifest`
- `POST https://asp.zitoai.xyz/api/a2mcp/media-search`
- `POST https://asp.zitoai.xyz/api/a2mcp/evidence-manifest`

### Legacy agent endpoints

- `GET /api/agent`
- `GET /.well-known/agent.json`
- `GET /.well-known/agent-card.json`
- `POST /api/agent/search`

### Provider endpoints

- `GET /api/providers/shutterstock/status`
- `GET /api/providers/shutterstock/categories`
- `GET /api/providers/shutterstock/subscriptions`
- `POST /api/providers/shutterstock/license`
- `GET /api/providers/freesound/status`
- `GET /api/providers/freesound/me`
- `POST /api/providers/freesound/sounds/:id/download`
- `GET /api/providers/jamendo/status`

## What is verified and stable

- A2MCP manifest advertises the ASP base as `asp.zitoai.xyz`.
- Railway custom domain is attached and serving the app on the correct port.
- `www.zitoai.xyz` and `zitoai.xyz` still serve the public site.
- The ASP endpoint is live over HTTPS.
- Local install is current: `npm install` reports up to date with no vulnerabilities.
- Local tests currently pass: `26/26`.

## Latest Railway smoke test

Run date: 2026-07-18

- `GET https://asp.zitoai.xyz/.well-known/a2mcp.json` returned `200` and identified ZitoAI as `role=ASP`, `serviceType=A2MCP`.
- `GET /api/providers/shutterstock/status` returned `200`.
- `GET /api/providers/freesound/status` returned `200`.
- `GET /api/providers/jamendo/status` returned `200`.
- `POST /api/a2mcp/media-search` for an image brief recommended Shutterstock and returned live Shutterstock results with preview and purchase/source links.
- `POST /api/a2mcp/media-search` for a sound-effect brief recommended Freesound and returned live Freesound results with previews.
- Jamendo was hardened after the first smoke test:
  - Freesound no longer competes for `music` requests; it is kept to sound effects / ambience / one-shots.
  - Jamendo now uses stricter music-track filters and richer metadata from the Tracks API.
  - Jamendo now falls back to tag-based discovery when exact commercial search returns zero results.
  - Local live checks returned Jamendo tracks for `upbeat advert music`, `corporate instrumental background`, `cinematic music`, and `ambient music`, each with preview and checkout/handoff URL.
- The public A2MCP `media-search` route now serves the deterministic, no-OpenRouter contract from the build spec, returning normalized results for the selected source.
- The deterministic A2MCP route now applies the spec’s hard gate:
  - Jamendo and Freesound do not appear in commercial `media-search` music results.
  - Jamendo still works for non-commercial music discovery.
  - Every returned result includes a preview URL, license type, price, and attribution flag/text in the normalized shape.

Current honest status: all three provider lanes are now ready for structured Railway endpoint testing. Jamendo remains a checkout-handoff provider, not an API-purchase provider.

## Full prompt smoke test

Run date: 2026-07-18

- 10/10 Shutterstock prompts passed.
- 10/10 Freesound prompts passed.
- 10/10 Jamendo prompts passed.
- Every passing result returned:
  - the correct inferred scope
  - the intended recommended provider
  - a preview URL
  - license terms or license reference
  - a purchase / source / checkout link

This is the first confirmed end-to-end natural-language ASP smoke test for all three provider lanes.

## OpenRouter Phase 3 sanity check

Run date: 2026-07-18

Docs checked:

- `https://openrouter.ai/docs/quickstart`
- `https://openrouter.ai/docs/features/structured-outputs`
- `https://openrouter.ai/docs/features/app-attribution`

Verified against docs and local behavior:

- ZitoAI calls OpenRouter through `https://openrouter.ai/api/v1/chat/completions`.
- Requests send `Authorization: Bearer ...`, `HTTP-Referer`, `X-OpenRouter-Title`, and JSON content headers.
- Structured output uses `response_format.type=json_schema` with `strict=true`.
- `parse_brief` uses `google/gemini-2.5-flash-lite` with `temperature=0`.
- `rank_results` uses `openai/gpt-4o-mini` with `temperature=0`.
- The LLM does not decide licensing eligibility; source routing, provider filtering, provider policy, and licensing gates remain deterministic.
- `parse_brief` validates the model output enum values before using them and falls back to local parsing on failure.
- `rank_results` validates every returned `asset_id/source` pair against the candidate list before reordering; invalid rankings fall back to the original deterministic order.
- Sound-effect cue handling was tightened after live smoke testing so prompts like ambience, room tone, rain, clicks, pings, whooshes, and birds stay in the Freesound lane instead of drifting to music.
- Guardrails are active:
  - default per-minute call cap: `20`
  - default input-size cap: `12000` characters
  - spend limiting is intentionally left to the OpenRouter-side key/budget configuration
  - every OpenRouter call logs function name, model, token usage, token cost, success/failure, and fallback reason where applicable
  - current runtime spend/guardrail status is exposed through `GET /api/health` under `brain.guardrails`

Local checks:

- `npm test` passed `26/26`.
- A direct live OpenRouter structured-output smoke test passed for both calls:
  - `parse_brief` returned `music` using `google/gemini-2.5-flash-lite`
  - `rank_results` returned a valid candidate ranking using `openai/gpt-4o-mini`
  - combined test cost was about `$0.0001291`
- A real `searchAssets` smoke test still routed a sound-effect/ambience prompt to Freesound and returned a preview URL.

Current honest status: OpenRouter is now additive in the intended places only. It improves brief parsing and result ordering, but does not replace deterministic provider routing, license filtering, purchase gates, or policy review.

## Shutterstock sanity check

Run date: 2026-07-18

Docs checked:

- `https://www.shutterstock.com/developers/documentation`
- `https://www.shutterstock.com/developers/documentation/authentication`
- `https://www.shutterstock.com/developers/documentation/licensing-and-downloading`

Verified against docs:

- Every Shutterstock API call sends a `User-Agent`.
- Search returns image candidates through the configured Shutterstock API base.
- Categories endpoint returns data.
- Subscriptions endpoint returns data.
- The license request builder includes `image_id`, `subscription_id`, `size`, `format`, `price`, and `metadata.customer_id` where applicable.
- The service auto-selects an active image subscription/format when the caller does not provide `subscriptionId`.
- The real license endpoint refuses mutation unless `confirmLicense=true`.
- Redownload support is implemented through the license-download endpoint, but actual redownload depends on the subscription/license type.

Live read-only check:

- `GET /api/providers/shutterstock/status` returned `200`.
- `GET /api/providers/shutterstock/categories` returned `200` with category data.
- `GET /api/providers/shutterstock/subscriptions` returned `200` with one subscription record.
- `POST /api/a2mcp/media-search` for an image brief returned Shutterstock results with preview, license reference, purchase/source link, and `/api/providers/shutterstock/license` as the next license endpoint.
- `POST /api/providers/shutterstock/license` without `confirmLicense=true` safely returned `400` and did not create a license.

Current honest status: Shutterstock search, metadata, subscription discovery, guarded license execution, and redownload plumbing are implemented. Actual license execution still requires a deliberate `confirmLicense=true` request using the current OAuth token and an eligible API subscription.

Practical note for the demo: a free Shutterstock API subscription can work for API use, but it is separate from the Shutterstock website subscription. If the account is operating in a testing/comp-license mode, the API may return a dummy license that does not grant real usage rights.

## Jamendo sanity check

Run date: 2026-07-18

Docs checked:

- `https://support-licensing.jamendo.com/individual-licenses`
- `https://support-licensing.jamendo.com/after-purchase-catalog-licenses`
- `https://developer.jamendo.com/v3.0/tracks`
- `https://developer.jamendo.com/v3.0/authentication`

Verified against docs:

- Jamendo’s public API is read/catalog oriented and requires a `client_id` on every call.
- The default Jamendo API application plan is `read only`; `read & write` requires Jamendo approval and is only for OAuth-protected write/private methods.
- The tracks API supports search and metadata discovery, including fields such as `musicinfo`, `licenses`, `prourl`, `audiodownload`, `audiodownload_allowed`, `content_id_free`, `audioformat`, `audiodlformat`, and `tags`.
- `prolicensing` and `content_id_free` filters are valid ways to steer toward commercially usable / Content ID safe candidates.
- Jamendo’s individual license workflow is an external checkout flow, not a purchase API inside ZitoAI.
- After purchase, Jamendo requires the user to add a project and generate a License Certificate on the Jamendo Licensing site.
- Jamendo licenses are one-project, one-track sync licenses; the user must keep the invoice / certificate evidence.
- Credits should be recorded in the format: `Artist — Track — Provided by Jamendo`.

Live check:

- `GET /api/providers/jamendo/status` returned `200`.
- Status shows `configured=true`, `apiBase=https://api.jamendo.com/v3.0`, and `mode=read_only_catalog`.
- 10/10 natural-language Jamendo ASP prompts returned:
  - recommended provider: `jamendo`
  - inferred scope: `music`
  - preview URL
  - source URL
  - purchase / licensing handoff URL
  - license reference or CC URL
  - policy verdict: `review`
  - `checkoutRequired=true`

Current honest status: Jamendo search, previews, metadata, licensing handoff URLs, and evidence capture are implemented. ZitoAI does not buy Jamendo licenses through the public API; the actual checkout and License Certificate generation still happen on Jamendo’s licensing site unless a separate Jamendo commercial agreement is arranged.

## Freesound sanity check

Run date: 2026-07-18

Docs checked:

- `https://freesound.org/docs/api/`
- `https://freesound.org/docs/api/authentication.html`
- `https://freesound.org/docs/api/resources_apiv2.html`

Verified against docs:

- Freesound API v2 supports browsing/searching sounds and retrieving sound metadata, previews, packs, users, similar sounds, comments, and audio analysis data.
- Token authentication is enough for read/search requests. ZitoAI uses the Freesound API key as the `token` query parameter for text search.
- Search requests use `GET https://freesound.org/apiv2/search/text/`.
- Search requests request only useful fields: `id`, `name`, `username`, `license`, `previews`, `duration`, `tags`, `description`, and `url`.
- Results expose Freesound preview URLs, source URLs, creator names, duration, tags, descriptions, and license URLs/references.
- OAuth2 is correctly treated as required for original-quality downloads and user-account actions.
- ZitoAI has OAuth start/callback plumbing for Freesound and stores encrypted provider tokens through Supabase.
- Original download is guarded behind `POST /api/providers/freesound/sounds/:id/download` and requires an authenticated connected Freesound user.
- Freesound is correctly scoped to sound effects, ambience, and one-shots. Music-track requests should route to Jamendo, not Freesound.

Live check:

- `GET /api/providers/freesound/status` returned `200`.
- Live status shows `configured=true` and `oauthConfigured=true`.
- OAuth callback is `https://asp.zitoai.xyz/auth/freesound/callback`.
- 10/10 natural-language Freesound ASP prompts returned:
  - recommended provider: `freesound`
  - inferred scope: `sound_effect`
  - preview URL
  - source URL
  - license reference
  - policy verdict: `review`
- `GET /api/providers/freesound/me` without an authenticated user safely returned `400` with `Authentication required.`
- `POST /api/providers/freesound/sounds/:id/download` without an authenticated user safely returned `400` with `Authentication required.`

Current honest status: Freesound search, previews, metadata, license/reference exposure, natural-language routing, OAuth connection plumbing, and guarded original-download endpoint are implemented. ZitoAI does not buy Freesound licenses because Freesound’s API is not a purchase/licensing checkout API; the correct workflow is to surface each sound’s Creative Commons/license terms and require user review before reuse.

## What still needs real user/provider action

- Freesound live OAuth approval still requires the user to connect an actual Freesound account.
- Shutterstock licensing still depends on real access-token / subscription entitlement on the provider side.
- Jamendo public API is read/catalog oriented; the actual music checkout and license certificate step still happens on Jamendo’s web flow, not inside ZitoAI.
- Paid x402 billing is not enabled yet; the ASP currently runs as a free A2MCP-style service.

## Current provider model

- Shutterstock: image licensing and evidence capture.
- Freesound: sound search/preview and original download via OAuth2-backed actions.
- Jamendo: music search/preview plus manual checkout handoff and certificate evidence capture. The connector uses `prolicensing`, music metadata/license includes, artist grouping, track type filters, optional instrumental/speed/content-id-safe hints, and fallback tag discovery.

## Testing schedule from here

1. Baseline platform checks
   - Confirm public site loads: `https://www.zitoai.xyz`
   - Confirm ASP manifest loads: `https://asp.zitoai.xyz/.well-known/a2mcp.json`
   - Confirm legacy agent card loads for compatibility.

2. Provider health checks
   - Shutterstock status, categories, subscriptions.
   - Freesound status and OAuth connection state.
   - Jamendo status and client-id/read-only mode.

3. Search routing checks
   - Image request must route to Shutterstock first.
   - Sound effect / ambience / one-shot request must route to Freesound first.
   - Song / music track request must route to Jamendo first.

4. Provider result quality checks
   - Confirm each result has title, creator/source, preview/source URL, license/policy summary, and provider-specific caveats.
   - Confirm media previews actually play where previews are expected.
   - Confirm “purchase/open provider checkout” links go to the correct provider asset page.

5. Provider action checks without payment
   - Shutterstock: verify license endpoint rejects unsafe/invalid requests cleanly before using a real license action.
   - Freesound: verify OAuth connect flow and original-download eligibility using the logged-in Freesound account.
   - Jamendo: verify external checkout handoff and certificate-evidence fields.

6. Evidence-pack checks
   - Generate JSON evidence pack for one asset from each provider.
   - Generate PDF evidence pack for one asset from each provider.
   - Confirm hashes, provider ID, asset ID, source URLs, license notes, and user evidence are included.

7. Supabase persistence checks
   - Confirm procurements save.
   - Confirm purchase/evidence records save only when provider-backed evidence exists.
   - Confirm incomplete/manual checkout records are clearly marked as handoff, not completed purchase.

8. OKX.AI ASP readiness checks
   - Confirm A2MCP manifest service metadata is correct.
   - Confirm `POST /api/a2mcp/media-search` response is understandable to another agent.
   - Confirm no paid/x402 metadata is advertised until payment integration is intentionally added.

9. Demo rehearsal
   - Run one image demo through Shutterstock.
   - Run one SFX/ambience demo through Freesound.
   - Run one music-track demo through Jamendo handoff.
   - Generate an evidence pack for the strongest demo asset.

10. Payment phase
   - OKX Agent Payments Protocol / x402 is wired behind `OKX_PAYMENT_ENABLED`.
   - Re-test paid endpoint behavior separately after the Railway payment variables are set.

## OKX Payment SDK / x402 install status

Checked against the official OKX Onchain OS Payment docs on 2026-07-19.

Installed Node SDK packages:

- `@okxweb3/x402-express`
- `@okxweb3/x402-core`
- `@okxweb3/x402-evm`
- `express`

Current honest status:

- The SDK is installed in `package.json` / `package-lock.json`.
- The A2MCP `POST /api/a2mcp/media-search` route is the pay-per-call route.
- Default listing/runtime price is `$0.02` via `OKX_PAYMENT_PRICE_USD`.
- Payment remains off unless `OKX_PAYMENT_ENABLED=true`.
- When enabled, the same endpoint first returns a standard x402 `402 Payment Required` challenge, then returns the normal media-search result after paid replay.
- Existing tests pass after wiring.
- The remaining payment setup is operational, not code: set `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `PAY_TO_ADDRESS`, and `OKX_PAYMENT_ENABLED=true` in Railway.
- Production listing should use X Layer mainnet (`eip155:196`). Use testnet only for separate non-marketplace testing.

## OKX.AI registration stance

ZitoAI should be listed as an ASP with A2MCP services. It is not an A2A negotiation worker. The current service contract is intentionally free for now and returns the result directly through standardized API endpoints.

Alignment with the OKX.AI docs checked on 2026-07-18:

- OKX.AI supports three roles: User, ASP, and Evaluator. ZitoAI is an ASP.
- ASPs can register A2A, A2MCP, or both. ZitoAI is currently A2MCP only.
- A2MCP is for standardized MCP/API services. ZitoAI exposes `POST /api/a2mcp/media-search` and `POST /api/a2mcp/evidence-manifest` as standardized API services.
- A2MCP services are expected to run automatically after registration and launch. ZitoAI’s endpoints are machine-callable and do not require manual negotiation.
- OKX.AI A2MCP settlement is normally instant per call through OKX Payment SDK. ZitoAI can now advertise `paymentRequired=true` and `pricingType=pay_per_call` when `OKX_PAYMENT_ENABLED=true`; it remains free when that switch is off.
- Because ZitoAI is A2MCP/free right now, there is no arbitration flow in the current service contract. Provider purchase/licensing gates remain inside ZitoAI’s provider-specific workflow and evidence pack.

## Working rule for edits

Update this file whenever any of these change:

- endpoint URLs
- provider coverage
- pricing / x402 status
- evidence workflow
- anything that changes what the service can actually do
