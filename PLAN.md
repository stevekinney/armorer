# Plan: Armorer Core/Runtime Split and Requirement Closure

## Plan summary

This plan splits the repository into a provider-neutral core package and separate runtime/adapters/MCP packages, adds tool identity/versioning/risk metadata, introduces a structured error model, and replaces OpenAI-shaped serialization with a deterministic provider-neutral format. The runtime becomes the only place for execution policies (timeouts/retries/concurrency/budgets) and composition utilities. With these changes, a re-audit should mark the core as **Pass** for all requirements and remove boundary violations.

## Guiding decisions (explicit)

- **Core vs runtime tool model**: Core defines **ToolDefinition** (no execution). Runtime defines **RunnableTool** (ToolDefinition + run handler) and handles execution.
- **ToolId format**: Canonical `ToolId` is `namespace:name@version`, where each component is `encodeURIComponent`-escaped; `namespace` defaults to `default`, `@version` omitted if undefined.
- **Version resolution**: `resolve()` picks highest semver when all versions parse as semver; otherwise uses deterministic registration order. Override via `RegistryOptions.versionSelector`.
- **Lookup API**: `get()` requires a fully-qualified ToolId or identity with version. `resolve()` is the only API that can choose among versions/aliases.
- **Alias vs deprecation**: Aliases are registry-only; deprecation is intrinsic to the ToolDefinition lifecycle. Alias chains are resolved with cycle detection and a max depth.
- **ToolContext layering**: Core exports minimal `ToolContext`; runtime exports `RuntimeToolContext` that extends it with execution-only fields.
- **Error model**: Canonical `ToolResult.error?: ToolError`. Legacy string fields remain as deprecated aliases for one major.
- **Serialization**: Use `zod-to-json-schema` (pinned) to JSON Schema draft 2020-12. Output is deterministic via stable key ordering and stable `$ref` naming. Detect lossy Zod features and emit warnings.
- **Metadata serialization**: `metadata` is constrained to JSON-serializable values. Serializer throws with path on invalid values.
- **Adapters**: Adapters import core only (no runtime imports). Any provider execution helpers live in separate integration packages.
- **Umbrella package**: `armorer` re-exports core/runtime/adapters with optional peerDependencies to keep pnpm layouts working.

## Target package/module architecture

### Monorepo layout

```
/packages
  /core
  /runtime
  /adapters-openai
  /adapters-anthropic
  /adapters-gemini
  /mcp
  /claude-agent-sdk
  /toolbox (compat umbrella)
```

### Entry points and boundaries

- `@armorer/core`
  - Allowed imports: **none** outside core.
  - Exports: ToolDefinition, ToolRegistry, query/search, identity helpers, ToolContext types, errors, serialization.
- `armorer/utilities`
  - Allowed imports: `@armorer/core` only.
  - Exports: createTool, createRunner (alias createToolbox), composition utilities, search tool, lazy loader, runner-specific types.
- `@armorer/adapters-openai|anthropic|gemini`
  - Allowed imports: `@armorer/core` only.
  - Exports: provider-specific formatter functions consuming serialized tool definitions.
- `@armorer/mcp`
  - Allowed imports: `@armorer/core` (and runtime only if explicitly required for execution helpers; default plan: core-only).
- `@armorer/claude-agent-sdk`
  - Allowed imports: `@armorer/core` (core-only for formatting; runtime usage moved to integration package if needed).
- `armorer` (compat)
  - Re-exports core/runtime/adapters for one major; declares adapters as optional peerDependencies.

### Boundary enforcement

- ESLint `no-restricted-imports` rules in each package.
- CI `scripts/check-boundaries.ts` to validate import graph and package.json dependencies.
- Export surface snapshot tests per package to ensure no runtime symbols leak into core.

## Workstreams

### 1) Core package creation and tool model split

**Scope and rationale**
Create `@armorer/core` as a provider-neutral library that defines tool specifications, registry/discovery, and serialization without execution policies.

**Concrete steps (file-level)**

- Move to core:
  - `src/registry/*` → `packages/core/src/registry/*`
  - `src/query-predicates.ts` → `packages/core/src/query-predicates.ts`
  - `src/inspect.ts` → `packages/core/src/inspect.ts`
  - `src/schema-utilities.ts` → `packages/core/src/schema-utilities.ts`
  - `src/tag-utilities.ts` → `packages/core/src/tag-utilities.ts`
- Replace `src/is-tool.ts` with:
  - `packages/core/src/is-tool-definition.ts`
  - `packages/runtime/src/is-runnable-tool.ts`
- Add new core modules:
  - `packages/core/src/tool-definition.ts`
  - `packages/core/src/identity.ts`
  - `packages/core/src/context.ts`
  - `packages/core/src/errors.ts`
  - `packages/core/src/serialization/*`
  - `packages/core/src/json.ts`
- Add new runtime modules:
  - `packages/runtime/src/tool.ts` (RunnableTool)
  - `packages/runtime/src/context.ts` (RuntimeToolContext)

**API changes**

- New core exports: `ToolDefinition`, `ToolIdentity`, `ToolId`, `ToolRisk`, `ToolLifecycle`, `ToolContext`, `ToolRegistry`, `createRegistry`, `serializeToolDefinition`.
- Runtime retains `createTool` and `createToolbox` (from new runtime package).

**Compatibility/migration**

- `armorer` umbrella re-exports `armorer/utilities` symbols for one major.
- Add deprecation JSDoc on `armorer` top-level exports, pointing to `armorer/utilities` or `@armorer/core`.

**Tests/docs**

- New core tests for ToolDefinition and identity helpers.
- Update documentation to explain core/runtime separation.

**Acceptance criteria**

- `@armorer/core` has **no** execution APIs and no runtime policy knobs.
- Import graph shows no edges from core to runtime/adapters/MCP/SDKs.

---

### 2) Tool identity, versioning, and risk metadata

**Scope and rationale**
Add canonical identity/versioning and declarative risk metadata required for tool-organization scope.

**Concrete steps (file-level)**

- Implement `ToolIdentity`, `ToolId`, `ToolRisk`, `ToolLifecycle` in `packages/core/src/tool-definition.ts`.
- Add `formatToolId`, `parseToolId`, `normalizeIdentity` in `packages/core/src/identity.ts`.
- Update search indexing to include `title`/`examples` if present.

**API changes**

- ToolDefinition includes:
  - `identity: { namespace?: string; name: string; version?: string }`
  - `title?: string`
  - `description: string`
  - `examples?: string[]`
  - `risk?: { effects: 'none'|'read'|'write'|'unknown'; requiresApproval?: boolean; dataSensitivity?: 'public'|'internal'|'restricted'|'secret'; externalNetwork?: boolean; systemAccess?: boolean }`

**Compatibility/migration**

- Runtime `createTool` accepts existing `name`/`description` and maps to ToolIdentity with default namespace/version.
- Existing metadata flags (`mutates/readOnly/dangerous`) remain supported in runtime; runtime maps them to `risk` on serialize.

**Tests/docs**

- Tests for ToolId formatting/parsing and semver resolution.
- Docs update: identity format and escaping rules.

**Acceptance criteria**

- ToolDefinition supports namespace/version/title/examples/risk.
- ToolId format is deterministic, documented, and parseable.

---

### 3) Registry upgrades: unregister, alias, deprecation, version-aware lookup

**Scope and rationale**
Add full registry lifecycle and version-aware resolution, including alias and deprecation support.

**Concrete steps (file-level)**

- Add `packages/core/src/registry/create-registry.ts` implementing:
  - `register(def, { aliases?, override? })`
  - `unregister(id)`
  - `get(id)` (requires full ToolId or identity with version)
  - `resolve(identity, { allowDeprecated? })`
  - `list()`
  - `serialize()`
- Update `packages/core/src/registry/index.ts` to export new registry API and extend query filters to include:
  - `namespace`, `version`, `deprecated`, `risk`.
- Add alias chain resolution with cycle detection and max depth (e.g., 5).

**API changes**

- New types: `RegistryOptions`, `RegistryWarning`, `ToolRegistry`.

**Compatibility/migration**

- Runtime `createToolbox` uses core registry internally; existing `getTool(name)` maps to `resolve({name})`.
- Deprecate runtime `getTool(name)` in favor of `resolve` semantics (warn on ambiguous name-only lookups).

**Tests/docs**

- Tests for alias resolution, deprecation warnings, unregister.
- Update registry docs with alias and deprecation examples.

**Acceptance criteria**

- Registry supports register/unregister, version-aware resolve, alias mapping, and deprecation warnings.
- `get()` rejects ambiguous identity (no version).

---

### 4) Minimal ToolContext improvements (core) + runtime context layering

**Scope and rationale**
Provide standard optional fields for run/request IDs and logging/tracing, without introducing execution policies in core.

**Concrete steps (file-level)**

- Add `packages/core/src/context.ts` with `ToolContext`, `Logger`, `Tracer`, `Span`.
- Add `packages/runtime/src/context.ts` with `RuntimeToolContext extends ToolContext`.

**API changes**

- Core: `ToolContext`, `Logger`, `Tracer`.
- Runtime: `RuntimeToolContext`.

**Compatibility/migration**

- Runtime `createTool` still passes `toolCall`, `timeout`, `dispatch` via RuntimeToolContext.

**Tests/docs**

- Type-level tests verifying compatibility with existing ToolContext usage.
- Doc update: context layering explanation.

**Acceptance criteria**

- Core ToolContext contains run/request IDs and logger/tracer interfaces, but no execution-only fields.
- Runtime ToolContext extends core with execution details.

---

### 5) Structured error model

**Scope and rationale**
Add a stable, provider-neutral error shape with category, code, retryable flag, and details payload.

**Concrete steps (file-level)**

- Add `packages/core/src/errors.ts` with `ToolErrorCategory` and `ToolError`.
- Update runtime ToolResult shape to include `error?: ToolError` and set deprecated `errorMessage` and `errorCategory` for one major.
- Map Zod errors to `validation` with details; map timeouts and cancellations explicitly.

**API changes**

- Core exports `ToolError`, `ToolErrorCategory`, `createToolError()` helper.
- Runtime `ToolResult` updated.

**Compatibility/migration**

- Keep `errorMessage` and `errorCategory` for one major with deprecation docs.

**Tests/docs**

- Tests for validation error shape and retryable mapping.
- Documentation: error code conventions and reserved prefixes (`toolbox.*` and `tool.<namespace>.<name>.*`).

**Acceptance criteria**

- Canonical error shape exists in core and is used by runtime; validation errors are distinct and include details.

---

### 6) Provider-neutral serialization

**Scope and rationale**
Define a stable, provider-neutral serialization format that does not embed Zod objects and is deterministic.

**Concrete steps (file-level)**

- Add `packages/core/src/serialization/serialize-tool.ts` using `zod-to-json-schema` (pinned) targeting JSON Schema draft 2020-12.
- Add `packages/core/src/serialization/stable-json.ts` for deterministic key ordering and stable JSON output.
- Add lossy feature detection for Zod effects/transforms; set `serialization.lossy` and warnings.
- Remove `src/to-json-schema.ts` from core; move provider-specific formatting into adapter packages.

**API changes**

- Core exports `serializeToolDefinition`, `serializeRegistry`, `SerializedToolDefinition`.

**Compatibility/migration**

- Provide a shim in `armorer/openai` that uses adapter formatting; mark old `toJSONSchema` deprecated.

**Tests/docs**

- Determinism test: repeated serialization yields identical JSON strings.
- Tests for lossy warning when schema uses refinements/transforms.
- Docs: JSON Schema draft and lossy feature policy.

**Acceptance criteria**

- Core serialization is provider-neutral, deterministic, and excludes non-JSON values.
- OpenAI-shaped formatting exists only in adapter packages.

---

### 7) Runtime extraction (execution + composition)

**Scope and rationale**
Move execution policies out of core while preserving runtime ergonomics.

**Concrete steps (file-level)**

- Move runtime code:
  - `src/create-tool.ts` → `packages/runtime/src/create-tool.ts`
  - `src/create-toolbox.ts` → `packages/runtime/src/runner.ts` (export `createToolbox` as alias)
  - `src/compose.ts` → `packages/runtime/src/compose.ts`
  - `src/utilities/*` → `packages/runtime/src/utilities/*`
  - `src/tools/search-tools.ts` → `packages/runtime/src/tools/search-tools.ts`
  - `src/lazy/index.ts` → `packages/runtime/src/lazy/index.ts`
  - `src/combine-toolboxes.ts` → split into `packages/core/src/combine-registries.ts` and `packages/runtime/src/combine-runners.ts`

**API changes**

- Runtime exports `createRunner` (new) and `createToolbox` (alias).
- Core has no execute APIs.

**Compatibility/migration**

- `armorer` umbrella re-exports runtime `createToolbox`/`createTool` for one major.

**Tests/docs**

- Move runtime tests to `packages/runtime/test/*`.
- Update docs to point to runtime for execution policies.

**Acceptance criteria**

- Core has no execution or orchestration logic.
- Runtime provides all execution behavior without importing adapters.

---

### 8) Adapters/MCP extraction and dependency hygiene

**Scope and rationale**
Remove SDK dependencies from core and keep adapters as pure formatters.

**Concrete steps (file-level)**

- Move:
  - `src/adapters/openai/*` → `packages/adapters-openai/src/*`
  - `src/adapters/anthropic/*` → `packages/adapters-anthropic/src/*`
  - `src/adapters/gemini/*` → `packages/adapters-gemini/src/*`
  - `src/adapters/claude-agent-sdk/*` → `packages/claude-agent-sdk/src/*`
  - `src/mcp/index.ts` → `packages/mcp/src/index.ts`
- Update adapter code to consume `SerializedToolDefinition` from core.
- Declare SDKs as optional peerDependencies in adapter packages.

**API changes**

- New package entry points for each adapter and MCP integration.

**Compatibility/migration**

- `armorer/openai`, `armorer/anthropic`, etc. remain via umbrella re-exports for one major.

**Tests/docs**

- Move adapter/MCP tests into their packages.
- Update provider docs to new package names.

**Acceptance criteria**

- Core package.json has **no** SDK dependencies.
- Adapters import core only and are pure formatters.

---

### 9) Documentation, exports, and tooling updates

**Scope and rationale**
Keep docs accurate and boundaries enforceable.

**Concrete steps (file-level)**

- Add `packages/*/package.json` with exports, types, and peerDependencies.
- Update root `package.json` for workspaces and `armorer` umbrella.
- Add `scripts/check-boundaries.ts` and CI integration.
- Update README and documentation to explain package split and migration.

**Acceptance criteria**

- CI fails on forbidden imports and dependency drift.
- Docs include core/runtime/adapters usage and migration guide.

## Migration plan

- **Semver**: Next major release.
- **Umbrella re-exports**: `armorer` re-exports core/utilities/adapters via subpaths for one major.
- **Deprecated APIs**:
  - `armorer` top-level exports (use `armorer/utilities` or `@armorer/core`).
  - `toJSONSchema` (OpenAI-shaped) moved to `@armorer/adapters-openai`.
- **Migration guide**: `documentation/migration-v1.md` with before/after imports and examples.

## Verification plan

- **Unit tests**
  - Core: ToolId parsing, alias/deprecation resolution, unregister, version selection.
  - Core: serialization determinism, lossy warnings, metadata JSON validation.
  - Runtime: ToolError mapping, timeout/cancelled categories.
- **Boundary tests**
  - Import graph check for forbidden edges.
  - Package.json dependency check (core has no SDKs).
  - Export surface snapshot for `@armorer/core` (no execute-like symbols).
- **Docs**
  - Core README with boundaries and serialization.
  - Runtime README with execution policies.
  - Adapter README updates.

## Re-audit checklist (evidence mapping)

- Tool definition model: `packages/core/src/tool-definition.ts` exports `ToolDefinition`, `ToolIdentity`, `ToolRisk`, `ToolLifecycle`.
- Registry/discovery: `packages/core/src/registry/create-registry.ts` exports `createRegistry` with register/unregister/resolve.
- Validation & ergonomics: `packages/core/src/schema-utilities.ts` + runtime validation helpers; core has no execution.
- Minimal ToolContext: `packages/core/src/context.ts`.
- Error model: `packages/core/src/errors.ts`.
- Serialization: `packages/core/src/serialization/serialize-tool.ts` with deterministic JSON Schema 2020-12.
- No runtime orchestration in core: no execute functions in `@armorer/core` export surface.
- Package quality: `packages/core/package.json` has no SDK dependencies; adapters are separate.

## Agent checklist

- [ ] Create workspace `packages/` structure and update root `package.json` workspaces
- [ ] Add `@armorer/core` package with ToolDefinition + identity helpers
- [ ] Implement ToolId format/parse helpers and document canonical format
- [ ] Implement core registry with unregister/resolve/versioning/aliases
- [ ] Add ToolRisk + lifecycle/deprecation model to ToolDefinition
- [ ] Add core ToolContext and runtime RuntimeToolContext
- [ ] Add structured error model in core and map in runtime
- [ ] Implement provider-neutral serialization with deterministic output
- [ ] Enforce metadata JSON-serializability in serialization
- [ ] Move execution logic to `armorer/utilities` (createTool/createToolbox/compose/utilities)
- [ ] Move search tool implementation to runtime; keep registry search in core
- [ ] Move adapters to separate packages and update imports to use core serialization
- [ ] Move MCP and Claude SDK integrations to separate packages
- [ ] Add boundary enforcement script and CI checks
- [ ] Update exports map for all packages and umbrella re-exports
- [ ] Update docs: core/runtime/adapters separation + migration guide
- [ ] Add tests for versioning/alias/deprecation/unregister/serialization determinism
- [ ] Add export surface snapshot test for `@armorer/core`
- [ ] Run full test suite and verify boundary checks pass
