# API key acquisition checklist

Verified against official provider pages on 2026-07-16.

## Get these first

| Provider | Where to obtain access | Environment variable | Notes |
|---|---|---|---|
| OpenRouter | [API Keys dashboard](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` | Create a normal inference key, preferably with a $5 spending limit. |
| MotionElements | [Developer Console](https://www.motionelements.com/developer) | `MOTION_ELEMENTS_API_SECRET` | Create a member account, then create the secret key. API uses Basic Auth with the secret as username and no password. |
| Shutterstock | [Developer applications](https://www.shutterstock.com/account/developers/apps) | `SHUTTERSTOCK_CLIENT_ID`, `SHUTTERSTOCK_CLIENT_SECRET`, later `SHUTTERSTOCK_ACCESS_TOKEN` | Create an app and select the free API subscription. Free access currently covers the test image collection, not music/video. |
| Freesound | [Request API credentials](https://freesound.org/apiv2/apply) | `FREESOUND_API_KEY` | Create a Freesound account first. Use the Client secret/API key for read-only search. |
| Jamendo | [Developer Portal](https://devportal.jamendo.com/) | `JAMENDO_CLIENT_ID` | Create a developer account and application. Commercial API use requires contacting `licensing@jamendo.com`. |
| Epidemic Sound | [Developer API page](https://www.epidemicsound.com/business/developers/) | `EPIDEMIC_SOUND_API_KEY` | Request the free prototype/evaluation key. Production access requires a partnership agreement and Developer Portal access. |

## Approval or sales process

| Provider | Where to apply | Environment variable | Notes |
|---|---|---|---|
| Adobe Stock | [Getting started](https://developer.adobe.com/stock/docs/getting-started/) and [Adobe Developer Console](https://developer.adobe.com/console) | `ADOBE_STOCK_API_KEY`, plus OAuth/service credentials later | Since Nov. 2024, new access is generally Enterprise, Affiliate, or specifically approved. Search needs the API key; licensing needs authorization. |
| Soundstripe | [API partnership page](https://www.soundstripe.com/api) | `SOUNDSTRIPE_API_KEY` | No public self-service key path is documented. Use Talk to Sales; Soundstripe assigns a server-side token. |
| Stockfilm standard API | [Agent/API documentation](https://stockfilm.com/for-ai-agents) | Future `STOCKFILM_API_KEY` | Not needed for the x402 endpoints. Contact Stockfilm only for standard/production API or HD/4K terms. |

## Paid API access

| Provider | Where | Environment variable | Notes |
|---|---|---|---|
| Lots of Sounds | [Pricing](https://www.lotsofsounds.com/pricing) and [sign up](https://www.lotsofsounds.com/sign-up) | Future `LOTS_OF_SOUNDS_API_KEY` | Free accounts browse/preview only. API access currently starts with Pro at $15/month. |

## No API key required

| Provider | Official entry point | Notes |
|---|---|---|
| Wikimedia Commons | [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page) | Public read-only search; use a descriptive User-Agent. |
| Openverse | [Openverse API](https://api.openverse.org/) | Public API; original source licenses must still be verified. |
| Free To Use | [Public API](https://freetouse.com/api) | No key or account. Commercial asset use still needs the appropriate license. |
| Stockfilm x402 | [Agent documentation](https://stockfilm.com/for-ai-agents) | Search, details and rights checks require no key; licensing is pay-per-use. |
| Internet Archive | [Developer portal](https://archive.org/developers/) | Advanced search is public. Account/S3 credentials are only needed for account operations such as uploads. |

## No documented media API

- [SoundsFree](https://www.soundsfree.art/) — browser tool; do not scrape.
- [Musickits](https://musickits.net/) — website downloads; request an official feed before automating.
- [Creative Commons chooser](https://creativecommons.org/choose/) — license-selection tool, not a media catalog.

## Secret handling

1. Copy `.env.example` to `.env`.
2. Put credentials only in `.env`.
3. Never send secrets to browser JavaScript or commit `.env`.
4. Use separate test and production applications when the provider supports them.
5. Record callback URLs exactly. Use `http://localhost:3000` while testing unless the provider requires HTTPS.
