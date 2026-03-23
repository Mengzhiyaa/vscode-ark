# vscode-ark

Standalone R language extension for VS Code, built on top of the local
`ark.vscode-supervisor` framework extension.

## Development

- Install dependencies with `npm install`.
- Sync the supervisor public API types with `npm run sync:supervisor-api -- ../vscode-supervisor`.
- Build the `rMonacoSupport` module with `npm run build:webview`.
- Build the extension bundle with `npm run build`.
- Compile the test bundle with `npm run compile-tests`.
- Run the extension unit suite with `npm run test:unit:ext`.
  Linux headless runs use `xvfb-run` automatically when needed.

The child repo keeps the R language contributions, runtime wiring, syntax
assets, and bundled `ark` runtime resources. During local test runs it loads
`../vscode-supervisor` as a second development extension when that sibling repo
is present; otherwise the test runner falls back to the declared extension
dependency flow.

`webview/` is source-owned in this repo for the Monaco support module, so
`webview/dist/rMonacoSupport` can be rebuilt locally instead of copied from the
parent workspace.

## CI And Release

- `npm run install:binaries` installs the target-platform `ark` runtime into `resources/ark/`.
- `.github/workflows/ci.yml` verifies build, tests, API sync, and a Linux VSIX smoke package.
- `.github/workflows/release.yml` builds tagged target VSIX artifacts, creates a GitHub Release, and publishes to marketplaces when `VSCE_PAT` and `OVSX_PAT` secrets are configured.
- Release runs can also be started manually with `workflow_dispatch`, while tagged pushes matching `v*` remain the default publish trigger.
- The repository should define `VSCE_PAT` for Visual Studio Marketplace publishing and `OVSX_PAT` for Open VSX publishing.
- The ark release/CI workflow checks out `Blakfs24/vscode-supervisor` into `.deps/vscode-supervisor` to verify the copied public API and run extension tests against a local supervisor dev extension.

## Packaging

- Create a VSIX with `npm run vsce:package`.
- Packaging uses `.vscodeignore` to keep compiled output and release metadata
  while excluding source and test artifacts.
