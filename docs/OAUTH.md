# ZitoAI OAuth setup

ZitoAI keeps provider access tokens on the server. Tokens are encrypted before they are written to Supabase and are never returned to browser JavaScript.

## Callback URLs

| Provider | Local callback | Current production callback |
|---|---|---|
| Freesound | `http://localhost:3000/auth/freesound/callback` | `https://www.zitoai.xyz/auth/freesound/callback` |
| Adobe Stock | `http://localhost:3000/auth/adobe_stock/callback` | `https://www.zitoai.xyz/auth/adobe_stock/callback` |
| Shutterstock | `http://localhost:3000/auth/shutterstock/callback` | `https://www.zitoai.xyz/auth/shutterstock/callback` |

The production origin is `https://www.zitoai.xyz`. Register it exactly in each provider console and keep `OAUTH_CALLBACK_BASE_URL` identical.

## Required server variables

Generate two long, independent secrets for `OAUTH_STATE_SECRET` and `OAUTH_TOKEN_ENCRYPTION_KEY`. Add provider client IDs and secrets only on Railway; never add them to Vercel client variables or commit them.

Adobe and Freesound use their documented authorization-code endpoints. Shutterstock endpoints are intentionally environment-configured because ZitoAI must not guess or hard-code a retired provider endpoint.

## Security flow

1. The signed-in user selects **Connect**.
2. ZitoAI creates a ten-minute HMAC-signed state bound to that user and provider.
3. The provider redirects to the registered callback.
4. ZitoAI verifies the state and exchanges the one-time code server-side.
5. Access and refresh tokens are AES-256-GCM encrypted and stored in `provider_connections`.
6. Browser clients can read connection status but never token ciphertext.
