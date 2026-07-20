# Credential-aware adapters

These adapters become active when the corresponding environment variables are set. They are production scoped to the three active providers only.

## Shutterstock

- Env: `SHUTTERSTOCK_ACCESS_TOKEN`
- Search: image search endpoint with `view=full` so categories and keywords are captured
- Licensing: `POST /v2/images/licenses` with `licenses.create`, `licenses.view`, and `purchases.view` scopes
- Delivery: keep assets inside the integrated project unless the customer owns a separate Standard/Enhanced license
- Policy: use Shutterstock for image licenses only in this build; do not treat a free test account as video/music production access

## Freesound

- Env: `FREESOUND_API_KEY`
- Search: text search with previews and file-level license metadata
- Purchase: normally not a stock checkout; file license controls use
- Delivery: only after the file license, account authorization and API commercial approval are satisfied
- Policy: no service-bureau behavior without valid provider authorization

## Jamendo

- Env: `JAMENDO_CLIENT_ID`
- Search: Jamendo tracks endpoint
- Licensing: provider-specific checkout or commercial agreement handoff
- Delivery: verify track-level commercial rights and attribution
- Policy: commercial API access requires a separate Jamendo agreement
