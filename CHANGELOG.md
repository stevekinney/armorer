# Changelog

## 0.7.0

### Core Runtime Completeness

- **Dry-Run in Composition**: `pipe`, `compose`, `parallel`, `retry`, `when`, `tap`, `bind`, `preprocess`, and `postprocess` now correctly propagate `dryRun` mode to underlying tools.
- **Consistent Tool Identity**: The registry now indexes tools by ID (`namespace:name@version`) instead of just name, resolving collisions when multiple versions or namespaces share a name. `getTool` now accepts ID or name.
- **OpenAI Adapter Naming**: Added `naming: 'safe-id'` option to `toOpenAI` to solve name collisions by using sanitized IDs. Added `createNameMapper` helper to resolve sanitized names back to tool IDs.
- **Policy Outcomes**: Added first-class `action_required` outcome for policy decisions with `status: 'needs_approval'` or `'needs_input'`, and new event `policy-action-required`.
- **API Surface**: Exported `ToolboxExecuteOptions` and ensured `createTool` passes all options (including `outputShaping`, `telemetry`, `diagnostics`) when used with an Toolbox instance.

## 0.6.1

- Aligned build output paths with package exports so types and sourcemaps ship under `dist/`.
- Added a tag-driven GitHub Actions release workflow with npm trusted publishing.
- Added release tag/version verification for CI.

## 0.5.0

- Added `armorer/claude-agent-sdk` adapter helpers for Claude Agent SDK MCP tooling.
- Added `createClaudeToolGate` to generate SDK tool allow/deny policies.
- Added `metadata.dangerous` with registry-level `allowDangerous` enforcement.
- Auto-annotated read-only MCP tools with `readOnlyHint`.
