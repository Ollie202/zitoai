# Openverse

## Live connector

- API: <https://api.openverse.org/>
- Terms: <https://docs.openverse.org/terms_of_service.html>
- Endpoints: `/v1/audio/` and `/v1/images/`
- Authentication: none for the current public search flow

## Request process

1. Search by query and asset type.
2. Store `foreign_landing_url`, creator, license code, license URL and attribution.
3. Independently verify the original source page before download or delivery.
4. Do not describe Openverse as the licensor.

## Legal guardrail

Openverse explicitly says that it aggregates metadata, does not verify licensing status and requires independent verification. It also requires attribution to CC works, prohibits scraping and reserves the right to charge commercial/heavy users later.

## Credential status

No signup or API key is required for the current public connector. Rate limits and terms can change.
