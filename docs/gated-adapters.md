# Credential-aware adapters

The first authenticated adapters are intentionally search-only until credentials and provider agreements are present. They become active automatically when the corresponding environment variable is set.

## Adobe Stock

- Env: `ADOBE_STOCK_API_KEY`
- Search: Adobe Stock Search API
- Purchase: customer OAuth or Enterprise service account
- Delivery: signed provider download URL only after customer entitlement/license is confirmed
- Policy: central-account licensing for customers requires Adobe approval

## Shutterstock

- Env: `SHUTTERSTOCK_ACCESS_TOKEN`
- Search: image search endpoint with `view=full` so categories and keywords are captured
- Purchase: `POST /v2/images/licenses` with `licenses.create`, `licenses.view`, and `purchases.view` scopes
- Delivery: keep assets inside the integrated project unless the customer owns a separate Standard/Enhanced license
- Policy: use Shutterstock for image licenses only in this build; do not treat a free test account as video/music production access

## Freesound

- Env: `FREESOUND_API_KEY`
- Search: text search with previews and file-level license metadata
- Purchase: normally not a stock checkout; file license controls use
- Delivery: only after the file license and API commercial approval are both satisfied
- Policy: no service-bureau behavior without valid provider authorization

## Jamendo

- Env: `JAMENDO_CLIENT_ID`
- Search: Jamendo tracks endpoint
- Purchase: provider-specific licensing/checkout
- Delivery: verify track-level commercial rights and attribution
- Policy: commercial API access requires a separate Jamendo agreement

## Why the other providers remain catalog-only

MotionElements, Epidemic Sound and Soundstripe have partner/account-specific entitlement flows that should not be guessed from public search documentation. Their catalog entries already define the adapter contract and the exact approval question; implement them only after credentials and a sample authorized response are available.
