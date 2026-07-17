# API key setup

Verified against official provider pages on 2026-07-16.

## App infrastructure

| Component | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| OpenRouter | [API Keys dashboard](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` | Use the model-router key for the brain layer. |
| Supabase | [Project settings](https://supabase.com/dashboard) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Needed for auth, evidence storage and private procurement records. |

## The three live licensing APIs

| Provider | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| Shutterstock | [Developer applications](https://www.shutterstock.com/account/developers/apps) | `SHUTTERSTOCK_CLIENT_ID`, `SHUTTERSTOCK_CLIENT_SECRET`, `SHUTTERSTOCK_ACCESS_TOKEN` | Use for image licensing only. Keep `SHUTTERSTOCK_SCOPES=licenses.create licenses.view purchases.view`. |
| Freesound | [Apply for API access](https://freesound.org/apiv2/apply/) | `FREESOUND_API_KEY`, optionally `FREESOUND_CLIENT_ID`, `FREESOUND_CLIENT_SECRET` | Use for sound effects, ambience and one-shots. |
| Jamendo | [Developer portal](https://developer.jamendo.com/v3.0/authentication) | `JAMENDO_CLIENT_ID` | Use for music tracks. Commercial API use requires Jamendo approval. |

## OAuth callback URLs

| Provider | Local callback | Production callback |
|---|---|---|
| Freesound | `http://localhost:3000/auth/freesound/callback` | `https://www.zitoai.xyz/auth/freesound/callback` |
| Shutterstock | `http://localhost:3000/auth/shutterstock/callback` | `https://www.zitoai.xyz/auth/shutterstock/callback` |

## Secret handling

1. Copy `.env.example` to `.env`.
2. Put credentials only in `.env` or Railway variables.
3. Never send secrets to browser JavaScript or commit them.
4. Keep Shutterstock scoped for image licensing only.
5. Keep the rest of the source tree free of dead provider wiring.
