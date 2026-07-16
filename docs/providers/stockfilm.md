# Stockfilm

## Public connector

- Agent documentation: <https://stockfilm.com/for-ai-agents>
- Terms: <https://stockfilm.com/terms-and-conditions>
- Public search: `GET https://api.stockfilm.com/x402/search?q=...&limit=...`
- Public rights check: `GET https://api.stockfilm.com/x402/clip/{clip_id}/rights`
- Authentication for these read-only endpoints: none

## Request process

1. Search clips.
2. Check each clip's rights endpoint.
3. Show price, rights status, confidence and sensitive-content warnings.
4. The paid `/license` endpoint is intentionally not called by this MVP.

## Payment phase

The provider documents an x402 license endpoint that returns a $10 USDC payment challenge and, after payment, a license plus time-limited download URL. Before enabling that in production, obtain written confirmation that the agent can purchase for an identified customer and that the customer is the named licensee.

## Credential status

The x402 discovery path is public. Stockfilm's standard search/visual APIs require an API key obtained through its contact flow; they are not part of this MVP.
