# Changelog

## 0.6.1

- Aligned build output paths with package exports so types and sourcemaps ship under `dist/`.
- Added a tag-driven GitHub Actions release workflow with npm trusted publishing.
- Added release tag/version verification for CI.

## 0.5.0

- Added `armorer/claude-agent-sdk` adapter helpers for Claude Agent SDK MCP tooling.
- Added `createClaudeToolGate` to generate SDK tool allow/deny policies.
- Added `metadata.dangerous` with registry-level `allowDangerous` enforcement.
- Auto-annotated read-only MCP tools with `readOnlyHint`.
