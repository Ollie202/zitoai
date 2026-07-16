# Free To Use

## Live connector

- API: <https://freetouse.com/api>
- License: <https://freetouse.com/license>
- Base URL: `https://api.freetouse.com/v3`
- Authentication: none for the public catalog endpoint

## Request process

1. `GET /music/tracks/all?limit=100&offset=0`
2. Rank returned tracks locally against the user's keywords.
3. Return the source and license links.
4. Require the user to complete provider checkout/download for commercial use.

## Legal guardrail

The provider's license is non-transferable and prohibits selling, transferring, sublicensing, sharing or distributing the digital asset to a third party. License Hunter therefore exposes discovery but not autonomous raw-file handoff for this provider.

## Credential status

No signup or API key is required for the public connector.
