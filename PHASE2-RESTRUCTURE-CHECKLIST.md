# Phase 2 Restructure Checklist

Target: standalone `vscode-ark` repository.
Landing directory for all copy steps in this document: `/home/mzy/vscode/vscode-ark/submodule/vscode-ark`.

## 1. Bootstrap Repo Metadata

- [ ] Seed `package.json` from `/home/mzy/vscode/vscode-ark/packages/vscode-ark/package.json`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/tsconfig.json` and make `rootDir` match the standalone R repo layout.
- [ ] Derive an R-only `webpack.config.js` from `/home/mzy/vscode/vscode-ark/webpack.config.js`.
- [ ] Keep `LICENSE.txt`, `ThirdPartyNotices.txt`, and an R-specific `README.md`.
- [ ] Keep `extensionDependencies: ["ark.vscode-supervisor"]`.

## 2. Copy Public Supervisor Type Surface

- [ ] Copy `/home/mzy/vscode/vscode-ark/src/types/supervisor-api.d.ts` to `src/types/supervisor-api.d.ts`.
- [ ] Treat that file as the only supervisor type dependency entrypoint.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/api.ts`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/positronTypes.ts`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/types/positron-supervisor.ts`.

## 3. Move R Source Files Into Standalone Layout

- [ ] Move `/home/mzy/vscode/vscode-ark/src/rExtension.ts` to `src/extension.ts`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/rLanguageContribution.ts` to `src/rLanguageContribution.ts`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/rCommandIds.ts` to `src/rCommandIds.ts`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/languageIds.ts` to `src/languageIds.ts`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/editor/tabCompletion.ts` to `src/editor/tabCompletion.ts`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/runtime/` to `src/runtime/`.
- [ ] Move `/home/mzy/vscode/vscode-ark/src/languages/r/services/help/helpActions.ts` to `src/services/help/helpActions.ts`.
- [ ] Rewrite relative imports after flattening the `src/languages/r/` prefix away.

## 4. Copy R-Owned Assets

- [ ] Copy `/home/mzy/vscode/vscode-ark/images/logo.png`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/images/Rlogo.svg`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/syntaxes/r.tmGrammar.gen.json`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/language-configuration.json`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/resources/ark/ark`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/resources/scripts/startup.R`.

## 5. Copy Runtime-Required Webview Artifacts

- [ ] Copy `/home/mzy/vscode/vscode-ark/webview/dist/rMonacoSupport/index.js`.
- [ ] Copy the shared chunks and assets required by that module from `/home/mzy/vscode/vscode-ark/webview/dist/`.
- [ ] Start with copying the full `webview/dist/` tree as the safe baseline, then minimize later if needed.
- [ ] Decide whether the standalone R repo should also own the build step that emits `rMonacoSupport`.

## 6. Keep Only R Manifest Surface

- [ ] Keep R activation events, commands, keybindings, grammars, configuration, debugger, and breakpoints.
- [ ] Remove all supervisor-owned views, menus, data explorer contributions, console panel containers, and shared framework commands not owned by the R extension.
- [ ] Preserve any command IDs that the R extension contributes even when their runtime handling is delegated through supervisor APIs.

## 7. Tests And Verification

- [ ] Carry R-owned tests such as `rExtension.unit.test.ts`, LSP selector coverage, and tab completion tests.
- [ ] Drop supervisor-only tests from this repo.
- [ ] Add standalone verification for `npm run compile`, `npm run compile-tests`, and R-owned unit suites.

## 8. Import Boundary Rules In The New Repo

- [ ] Keep the current rule: all cross-repo imports must terminate at `src/types/supervisor-api.d.ts`.
- [ ] Do not add direct imports to supervisor implementation files.
- [ ] Keep `supervisor.shouldTabComplete` as an inlined string constant, not a runtime dependency on supervisor source.

## 9. Final Parent-Repo Cleanup Trigger

- [ ] Only after this workspace builds independently, remove R-owned code from the future `vscode-supervisor` repo source tree.
