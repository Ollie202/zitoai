# Wikimedia Commons

## Live connector

- API: <https://www.mediawiki.org/wiki/API:Main_page>
- Reuse rules: <https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia>
- Endpoint: `https://commons.wikimedia.org/w/api.php`
- Authentication: none for read-only search

## Request process

1. Search the file namespace.
2. Request `imageinfo` with URL, MIME and extended metadata.
3. Reject files whose MIME type does not match the requested asset type.
4. Extract file-level license, creator, attribution and restrictions.
5. Generate the attribution line and preserve the source page.

## Legal guardrail

Commons permits reuse according to each file's license, but warns that license correctness is not guaranteed and that trademarks, personality, privacy and moral rights can still apply. The MVP is conservative about NC, ND and ambiguous licenses.

## Credential status

No signup or API key is required for the current read-only connector. Use a descriptive User-Agent and respect Wikimedia rate limits.
