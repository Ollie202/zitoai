# API key setup

Production credentials belong in Railway variables, `local.env`, or `.env`. Do not commit real credentials.

## App infrastructure

| Component | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| OpenRouter | [API Keys dashboard](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` | Use the model-router key for the brain layer. |
| Supabase | [Project settings](https://supabase.com/dashboard) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Needed for auth, evidence storage and private procurement records. |
| OKX Agent Payments Protocol | OKX Onchain OS payment setup | `PAY_TO_ADDRESS`, `OKX_PAYMENT_NETWORK`, `OKX_PAYMENT_TOKEN_ADDRESS`, `OKX_PAYMENT_AMOUNT`, `OKX_PAYMENT_PRICE_USD` | Current A2MCP service is zero-fee x402. Use amount `0` and X Layer USDT so agents can complete pay-and-replay. |

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

Use these for the current zero-fee ASP registration:

| Variable | Value |
|---|---|
| `OKX_PAYMENT_NETWORK` | `eip155:196` |
| `OKX_PAYMENT_TOKEN_ADDRESS` | `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| `OKX_PAYMENT_AMOUNT` | `0` |
| `OKX_PAYMENT_PRICE_USD` | `0 USDT` |
| `PAY_TO_ADDRESS` | Your Agentic Wallet or recipient wallet address |
