# vscode-ark

Standalone R language extension for VS Code, built on top of the local
`ark.vscode-supervisor` framework extension.

## Development

- Install dependencies with `npm install`.
- Sync the supervisor public API types with `npm run sync:supervisor-api -- ../vscode-supervisor`.
- Build the R Monaco support bundle with `npm run build:webview`.
- Build the extension bundle with `npm run build`.
- Compile the test bundle with `npm run compile-tests`.
- Run the extension unit suite with `npm run test:unit:ext`.
  Linux headless runs use `xvfb-run` automatically when needed.

### Debugging with F5

Open `vscode-ark` as the VS Code workspace and choose one of these launch
configurations:

- `Run Ark + Supervisor` builds the Ark and Supervisor webview assets, starts
  both extension bundle watchers, and opens an Extension Development Host for
  manual testing.
- `Ark Extension Tests` performs the same split-extension preparation, compiles
  `out/test`, and runs the Mocha extension test entrypoint inside an Extension
  Development Host.

The pre-launch check verifies the copied Supervisor API and confirms that the
Ark, RET, and Kallichore binaries can execute on the current platform. Binary
downloads are deliberately kept out of the F5 path. If the check reports a
missing or incompatible binary, run `npm run install:binaries` in both
`vscode-ark` and `../vscode-supervisor`.

Both repositories must have their dependencies installed. The default sibling
Supervisor checkout for F5 is `../vscode-supervisor`, matching the development
extension paths in `.vscode/launch.json`. The command-line test runner also
supports `SUPERVISOR_DEV_EXTENSION_PATH` when a different checkout layout is
required.

The child repo keeps the R language contributions, runtime wiring, syntax
assets, and bundled `ark` runtime resources. During local test runs it loads
`../vscode-supervisor` as a second development extension when that sibling repo
is present; otherwise the test runner falls back to the declared extension
dependency flow.

`webview/` now contains only the R-specific Monaco support bundle that
`vscode-supervisor` loads into its console and data explorer webviews. Running
`npm run build:webview` rebuilds `webview/dist/rMonacoSupport` locally.

## CI And Release

- `npm run install:binaries` installs the target-platform `ark` runtime into `resources/ark/`.
- `.github/workflows/ci.yml` verifies build/tests, packages target VSIX artifacts for branch pushes, and republishes them into a single `CI Pre-release` GitHub prerelease.
- The CI prerelease is recreated from the fixed `ci-latest` tag on each `main`/`master` push so it stays at the top of the Releases page and always carries the newest CI VSIX files.
- `.github/workflows/release.yml` builds tagged target VSIX artifacts, creates a GitHub Release, and publishes to marketplaces when `VSCE_PAT` and `OVSX_PAT` secrets are configured.
- Release runs can also be started manually with `workflow_dispatch`, while tagged pushes matching `v*` remain the default publish trigger.
- The repository should define `VSCE_PAT` for Visual Studio Marketplace publishing and `OVSX_PAT` for Open VSX publishing.
- The ark release/CI workflow checks out `Mengzhiyaa/vscode-supervisor` into `.deps/vscode-supervisor` to verify the copied public API and run extension tests against a local supervisor dev extension.

## Packaging

- Create a VSIX with `npm run vsce:package`.
- Packaging uses `.vscodeignore` to keep compiled output and release metadata
  while excluding source and test artifacts.
