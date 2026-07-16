# Changelog

## Unreleased

- Upgraded the bundled Ark kernel to `0.1.252+14.6618e9a`, matching the
  current Positron R extension baseline.
- Added SHA-256 verification for downloaded Ark release assets.
- Added Ark profiling, default repository, Package Manager repository, and
  custom kernel environment settings.
- Added configurable Ark LSP diagnostics, document symbols, workspace symbols,
  and protocol tracing with Positron-compatible configuration mapping.
- Established the standalone `vscode-ark` package structure.
- Added R-extension unit coverage for manifest ownership, local supervisor
  dependency wiring, and LSP selector behavior.
- Added packaging metadata and `.vscodeignore` rules for VSIX publication.
- Added a standalone `webview/` build for `rMonacoSupport` and an API type sync
  script for `src/types/supervisor-api.d.ts`.
- Added repository-local CI/release workflows and target-platform binary
  installation for packaging.
