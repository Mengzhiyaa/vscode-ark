# Ark Positron Session Alignment Gaps

本文档记录当前 `vscode-ark` 相对 `positron` 的 runtime startup / session management 缺口，并标记仍依赖 `vscode-supervisor` 继续补齐的部分。

## 已完成的主要对齐

- `src/types/supervisor-api.d.ts` 已同步一批 Positron 风格命名，并且不再只是类型导入:
  - `registerSessionManager`
  - `onDidStartUiClient`
  - `watchUiClient`
  - `getActiveSessions`
  - `updateActiveLanguages`
  - `getRestoredSessions`
  - `registerRuntimeManager`
  - `completeDiscovery`
- Ark 已新增 `RRuntimeStartupManager`，并通过 `registerRuntimeManager()` 接管了 R 的 startup/discovery ownership:
  - `discoverAllRuntimes()`
  - `recommendWorkspaceRuntimes()`
  - 通过 supervisor shared cache 回写 `registerDiscoveredRuntime()`
  - 通过 `registerExternalDiscoveryManager()` 让 supervisor 跳过 R 的内建发现
- Ark 已新增 `RRuntimeManager`，并通过 `registerSessionManager()` 接管了:
  - `createSession`
  - `validateSession`
  - `restoreSession`
  - `validateMetadata`
- `RCommandIds.startConsole` 已改成显式 `startRuntime()` 语义，不再复用 `autoStartRuntime()`
- `RSessionManager` 已开始实际消费 `watchUiClient()`
- `startConsole` 现在已开始消费 `getRestoredSessions()`:
  - runtime startup 尚未完成时，如果已有 restored R console 正在恢复，就不会再启动重复 runtime

## 当前仍未完成的 Ark 侧缺口

### 1. Ark 还没有把 restored-session 恢复链全部补到 Positron 水平

- Ark 现在已经能接管 restored R session 的 create/validate/restore ownership。
- 也已经开始在 `startConsole` 入口消费 `getRestoredSessions()`，避免 restore 期间重复启动 R。
- 但 restored-session placeholder / startup UI 的主体仍主要由 supervisor console 链路承接，而不是 Ark 自己有更多前端服务消费。

结果:

- R session lifecycle ownership 已经对齐了一大步。
- 但 Ark 自身对 restored session 的前端恢复体验还没有完全对齐 Positron。

### 2. Ark 已开始实质消费 startup/discovery 类 API，但还没有完全对齐 Positron 的 ext-host 语义

- 当前真正已经接上的主要是:
  - `registerSessionManager`
  - `watchUiClient`
  - `startRuntime`
  - `getRestoredSessions`（用于避免 restore 期间重复启动）
  - `registerRuntimeManager`
  - `registerExternalDiscoveryManager`
  - `registerDiscoveredRuntime`
- 但以下能力仍未形成明确的 Ark 行为:
  - 显式 `completeDiscovery`
  - 更强的 `updateActiveLanguages()` / implicit startup 联动

结果:

- Ark 已经不再是“只有命名对齐”，而是已经拥有一条语言扩展自主管 discovery -> supervisor registry 的实际链路。
- 但整体仍不是 Positron 那种更完整的 extension-host runtime manager / new-folder orchestration 结构。

## Ark 仍依赖 supervisor 继续补齐的部分

以下问题即使 Ark 继续接线，也仍依赖 supervisor 进一步补齐:

- `NewFolderTasks` 现在已经是一个真实 startup barrier，但还不是 Positron 那种完整的 new-folder service。
- workspace recommendation 语义仍比 Positron 保守。
- active language / implicit startup 的触发信号仍是增强后的启发式近似，不是完整 Positron 语义。
- persisted session restore 现在已具备最小状态机，但前端 placeholder / UI 恢复体验还没有完全补齐。

## 从 Ark 视角看，下一步最值得继续对齐的项

1. 基于 `getRestoredSessions()` 做 restored-session 前端恢复链。
2. 继续加强 `watchUiClient()` 相关的前后端联动，而不只是 session service 激活补偿。
3. 如果后续要继续向 Positron 收口，需要继续评估是否把当前 supervisor shared-cache discovery 架构拆成更接近 Positron 的 ext-host runtime manager 模式，并补出显式 `completeDiscovery` 语义。
