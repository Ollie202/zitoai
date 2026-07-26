# API key setup

Production credentials belong in Railway variables, `local.env`, or `.env`. Do not commit real credentials.

## App infrastructure

| Component | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| OpenRouter | [API Keys dashboard](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` | Use the model-router key for the brain layer. |
| Supabase | [Project settings](https://supabase.com/dashboard) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Needed for auth, evidence storage and private procurement records. |
| OKX Agent Payments Protocol | OKX Onchain OS payment setup | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `PAY_TO_ADDRESS`, `OKX_PAYMENT_NETWORK`, `OKX_PAYMENT_TOKEN_ADDRESS`, `OKX_PAYMENT_AMOUNT`, `OKX_PAYMENT_PRICE_USD` | The A2MCP service uses x402 with EIP-3009. The three OKX credentials are **required**: the facilitator verifies every authorization, including at a price of 0, and without them the endpoint refuses every call. |

## The three live licensing APIs

| Provider | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| Shutterstock | [Developer applications](https://www.shutterstock.com/account/developers/apps) | `SHUTTERSTOCK_CLIENT_ID`, `SHUTTERSTOCK_CLIENT_SECRET`, `SHUTTERSTOCK_ACCESS_TOKEN` | Use for image licensing only. Keep `SHUTTERSTOCK_SCOPES=licenses.create licenses.view purchases.view`. |
| Freesound | [Apply for API access](https://freesound.org/apiv2/apply/) | `FREESOUND_API_KEY`, optionally `FREESOUND_CLIENT_ID`, `FREESOUND_CLIENT_SECRET` | Use for sound effects and ambience. |
| Jamendo | [Developer portal](https://developer.jamendo.com/v3.0/authentication) | `JAMENDO_CLIENT_ID` | Use for music tracks. Commercial API use requires Jamendo approval. |

## OAuth callback URLs

| Provider | Local callback | Production callback |
|---|---|---|
| Freesound | `http://localhost:3000/auth/freesound/callback` | `https://asp.zitoai.xyz/auth/freesound/callback` |
| Shutterstock | `http://localhost:3000/auth/shutterstock/callback` | `https://asp.zitoai.xyz/auth/shutterstock/callback` |

## Secret handling

1. Copy `.env.example` to `local.env` for local development.
2. Put production credentials only in Railway variables.
3. Never send secrets to browser JavaScript or commit them.
4. Keep Shutterstock scoped for image licensing only.
5. Keep the rest of the source tree free of dead provider wiring.

## x402 values

Use these for the ASP registration:

| Variable | Value |
|---|---|
| `OKX_PAYMENT_NETWORK` | `eip155:196` (X Layer) |
| `OKX_PAYMENT_TOKEN_ADDRESS` | `0x779ded0c9e1022225f8e0630b35a9b54be713736` (USD₮0, EIP-3009) |
| `OKX_PAYMENT_AMOUNT` | `0` — minimal units, 6 decimals (a free call; `10000` would be 0.01 USD₮0) |
| `OKX_PAYMENT_PRICE_USD` | optional — derived from the amount when unset |
| `PAY_TO_ADDRESS` | Your Agentic Wallet or recipient wallet address |
| `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` | Facilitator credentials — required |

`OKX_PAYMENT_AMOUNT` must match the fee on the OKX.AI listing — a listing priced at 0
against an endpoint charging 0.01 will not reconcile.

A zero amount does not weaken the authorization. Verified against the live OKX
facilitator: at amount 0 its `/verify` still checks the EIP-3009 signature in full,
returning `invalid_signature` for a forged `from`, a garbage signature, or a rewritten
`to`, and validating only an honest authorization. A caller therefore still has to produce
a real signed EIP-3009 authorization to be served. The only difference is that nothing is
transferred, so settlement is skipped and the receipt says `no_settlement_required` rather
than reporting a transaction that never happened.

The EIP-712 domain (`OKX_PAYMENT_ASSET_NAME` = `USD₮0`, `OKX_PAYMENT_ASSET_VERSION` = `1`)
is what a payer signs against. The token exposes no `version()` getter, so the version is
only recoverable by reproducing its `DOMAIN_SEPARATOR`; the defaults are verified to do so
and match the OKX SDK's own registry entry for `eip155:196`. Do not change them unless the
payment token changes.
