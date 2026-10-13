# Changelog

## 0.3.0

- Treat consecutive incoming texts after welcome as one reply; process only the latest event and use a stable welcome-based send key.
- Read shared welcome and reply texts from an n8n name/message Data Table, with missing/duplicate/empty configuration guards.
- Ignore stickers throughout the first-reply gate, LLM context and history recheck.
- Remove welcome-specific parameters and filtering from Get Messages; it only reads history.
- Move the strict first-reply gate into the inactive example workflow, with one Code node.
- Use Edit Fields and IF nodes for settings, validated intent routing and unchanged-history recheck.
- Use Basic LLM Chain, Chat Model and Structured Output Parser for conservative classification.
- Breaking before 1.0: migrate workflows using the removed filter before upgrading (see docs/INCOMING.md).

## 0.2.0

- Add Events trigger with separate follower/message outputs and authenticated, validated payloads.
- Add Get Messages with pagination, gap/exhaustion metadata and a fail-closed first-welcome-reply filter.
- Add an inactive context-only reply example with exact intent allowlists and a final history recheck.
- Keep existing follower/send nodes and stable idempotency behavior compatible; no dialog stages.

## 0.1.5

- Use the TikTok Gateway logo for all three n8n nodes and the npm README.

## 0.1.4

- Fix the local archive path in the npm publication job.

## 0.1.3

- Release through GitHub Actions using npm Trusted Publishing.
- Make npm Community Nodes installation the primary installation path.

## 0.1.2

- Prepare public npm distribution and tag-triggered Trusted Publishing with provenance.
- Document Community Nodes installation and one-time npm owner setup.

## 0.1.1

- Build and attach tested package archives and checksums to GitHub Releases automatically on version tags.
- Wait for webhook registration during isolated n8n startup checks.

## 0.1.0

- Extracted three legacy TikTok Gateway nodes into an installable TypeScript package.
- Preserved credential type, action keys, event data, and item links.
- Added payload and operation validation, sanitized errors, and disabled HTTP redirects.
- Added safe offline workflow migration, unit tests, and isolated real-n8n restart smoke tests.
