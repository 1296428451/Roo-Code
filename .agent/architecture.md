# Roo-Code 项目架构地图

> 最后更新: 2026-09-18
> 项目: [Roo-Code](https://github.com/RooVetCode/Roo-Code) - VS Code AI 编程助手扩展
> 扩展版本: 3.53.0（见 `src/package.json`）
> 用途: 定位「某个功能在哪个文件」，以及该文件提供什么

---

## 项目概述

Roo-Code 是 VS Code 的 AI 编程助手扩展，支持多种 LLM 提供商（Anthropic / OpenAI / Gemini / Bedrock / Ollama / OpenRouter 等），提供代码生成与编辑、调试、代码库语义索引、MCP 工具调用、多 Agent 后台并行执行等能力。项目为 monorepo（pnpm workspace + Turbo）：扩展主工程在 `src/`，Webview UI 在 `webview-ui/`，扩展与 CLI 共用的类型与逻辑在 `packages/`。

---

## 核心目录结构

```
Roo-Code/
├── src/                          # VS Code 扩展主工程 (version 3.53.0)
│   ├── extension.ts              # 扩展入口 (activate / deactivate)
│   ├── esbuild.mjs               # 扩展打包脚本 (bundle)
│   ├── activate/                 # 激活逻辑 (命令 / 代码操作 / URI / 终端操作)
│   ├── api/                      # LLM API 层 (providers / transform / fetchers)
│   ├── core/                     # 核心业务逻辑 (webview / task / tools / prompts ...)
│   ├── extension/                # 对外扩展 API (api.ts)
│   ├── i18n/                     # 国际化 (i18next 封装，导出 t())
│   ├── integrations/             # VS Code 集成 (editor / terminal / workspace / theme ...)
│   ├── services/                 # 服务层 (code-index / mcp / checkpoints / skills ...)
│   ├── shared/                   # 扩展内共享模块 (模式 / 工具类型 / 消息类型 ...)
│   ├── types/                    # 仅剩 global-agent.d.ts (类型已迁至 packages/types)
│   ├── utils/                    # 工具函数 (path / shell / logging ...)
│   ├── webview-ui/               # Webview 构建产物落地目录 (audio / build)
│   ├── workers/                  # Web Worker (countTokens)
│   └── dist/extension.js         # esbuild 产物，VS Code 实际加载的文件
├── webview-ui/                   # Webview UI 源码 (React + Vite)
│   └── src/                      # 组件 / context / hooks / utils
├── packages/                     # 共享包
│   ├── build/                    # 共享 esbuild / vitest 构建工具
│   ├── config-eslint/            # ESLint 配置
│   ├── config-typescript/        # TypeScript 配置
│   ├── core/                     # 核心逻辑包 (custom-tools / message-utils / worktree ...)
│   ├── types/                    # 类型定义包 @roo-code/types (扩展与 CLI 共用)
│   ├── vscode-shim/              # VS Code API Mock (供 CLI / 测试使用)
│   └── ipc/                      # IPC 通信 (CLI 与扩展宿主)
├── apps/                         # 应用
│   ├── cli/                      # CLI 工具 (含 agent 子运行时)
│   ├── docs/                     # Docusaurus 文档站
│   ├── vscode-e2e/               # E2E 测试
│   └── vscode-nightly/           # 夜间构建
└── locales/                      # 翻译文件 (ca/de/es/fr/hi/id/it/ja/ko/nl/... /zh-CN/zh-TW)
```

> 注意：`src/webview-ui/build/` 是 Vite 的构建**输出**目录（由 `webview-ui` 的 `vite build` 写入），不是源码。前端源码在仓库根的 `webview-ui/src/`。

---

## 核心模块

### 1. 扩展入口与激活

`src/extension.ts` -> `activate()` # 扩展激活入口：输出通道 → `initializeNetworkProxy()` → `migrateSettings()` → `initializeI18n()` → `TerminalRegistry.initialize()` → `initSettingsStore()` → `ContextProxy.getInstance()` → 为每个 workspace folder 创建并后台 initialize `CodeIndexManager` → `new ClineProvider(...)` → 注册 Webview View / 命令 / 代码操作 / URI handler
`src/activate/index.ts` -> 激活模块汇总导出
`src/activate/registerCommands.ts` -> `registerCommands()` # 注册命令
`src/activate/registerCodeActions.ts` -> `registerCodeActions()` # 注册代码操作
`src/activate/registerTerminalActions.ts` -> `registerTerminalActions()` # 注册终端操作
`src/activate/CodeActionProvider.ts` -> `CodeActionProvider` # 代码操作提供者
`src/activate/handleTask.ts` -> `handleTask()` # 任务处理
`src/activate/handleUri.ts` -> `handleUri()` # URI 处理
`src/i18n/index.ts` -> `initializeI18n()` / `t()` / `changeLanguage()` # i18next 封装，`t()` 是扩展侧取文案的唯一入口

### 2. 核心业务逻辑 (`src/core/`)

#### 2.1 Webview 管理

`src/core/webview/ClineProviderBase.ts` -> `ClineProviderBase` # 提供者**基类**（`extends EventEmitter<TaskProviderEvents>`）：持共享状态与生命周期（`view` / `clineStack` / `backgroundTaskDelegate` / `mcpHub` / `skillsManager` / `currentWorkspacePath` / `_workspaceTracker`）与核心 getter
`src/core/webview/ClineProviderBase.ts` -> `getCurrentWorkspaceCodeIndexManager()` # 动态 `CodeIndexManager.getInstance(this.context)`；实例按工作区文件夹路径 keyed
`src/core/webview/ClineProviderBase.ts` -> `updateCodeIndexStatusSubscription()` # 把当前工作区 manager 的 `onProgressUpdate` 转发为 `indexingStatusUpdate` 消息，并立即推送一次初始状态
`src/core/webview/ClineProvider.ts` -> `ClineProvider` # Webview 视图提供者（`extends ClineProviderBase`，`implements vscode.WebviewViewProvider, TaskProviderLike`）：薄门面，把各职责转发给 Delegate；静态成员 `sideBarId` / `tabPanelId` / `activeInstances` / `getInstance()`
`src/core/webview/webviewMessageHandler.ts` -> `webviewMessageHandler()` # Webview 消息总入口：构造 `HandlerContext` 后按 `message.type` 分发到 handlers/*（文件恢复分支内联在此）
`src/core/webview/handlers/context.ts` -> `HandlerContext` # 处理器上下文：provider / 全局状态读写 / cwd / mode
`src/core/webview/handlers/index.ts` -> 处理器汇总导出

**Handlers（按消息域拆分）:**

`src/core/webview/handlers/taskHandlers.ts` -> `handleTaskOperations()` / `handleChatOperations()` # 任务生命周期与聊天消息
`src/core/webview/handlers/apiConfigHandlers.ts` -> `handleApiConfigOperations()` # API 配置档案
`src/core/webview/handlers/providerHandlers.ts` -> `handleProviderOperations()` # 提供者设置 / 模式 / TTS 等会话级开关
`src/core/webview/handlers/modelHandlers.ts` -> `handleModelOperations()` # 模型列表刷新（Router / Ollama / LM Studio / VS Code LM）
`src/core/webview/handlers/modeHandlers.ts` -> `handleModeOperations()` # 自定义模式导入导出
`src/core/webview/handlers/codeIndexHandlers.ts` -> `handleCodeIndexOperations()` # 代码库索引（详见 §5.1）
`src/core/webview/handlers/commandHandlers.ts` -> `handleCommandOperations()` # 斜杠命令增删改查
`src/core/webview/handlers/promptHandlers.ts` -> `handlePromptOperations()` # 提示词更新 / 增强 / 导出系统提示
`src/core/webview/handlers/searchHandlers.ts` -> `handleSearchOperations()` # 文件搜索 / 自定义工具刷新
`src/core/webview/handlers/mcpHandlers.ts` -> `handleMcpOperations()` # MCP 服务器管理
`src/core/webview/handlers/checkpointHandlers.ts` -> `handleCheckpointOperations()` # 检查点恢复与 diff
`src/core/webview/handlers/worktreeHandlers.ts` -> `handleWorktreeOperations()` # Git 工作树
`src/core/webview/handlers/miscHandlers.ts` -> `handleMiscOperations()` # 杂项（打开文件 / 设置导入导出 / Codex 登录等）

**Delegates（委托模式）:**

`src/core/webview/delegates/ProviderStateDelegate.ts` -> `ProviderStateDelegate` # 状态读取与 `postStateToWebview()`
`src/core/webview/delegates/ProviderProfileDelegate.ts` -> `ProviderProfileDelegate` # 提供者配置档案与 API Handler 重建
`src/core/webview/delegates/TaskHistoryDelegate.ts` -> `TaskHistoryDelegate` # 任务历史
`src/core/webview/delegates/TaskStackDelegate.ts` -> `TaskStackDelegate` # 任务栈（`clineStack` / 当前任务）
`src/core/webview/delegates/WebviewLifecycleDelegate.ts` -> `WebviewLifecycleDelegate` # Webview 生命周期：`resolveWebviewView()` / 可见性变化 / dispose / `postMessageToWebview()`；在此调用 `updateCodeIndexStatusSubscription()` 并注册 `onDidChangeActiveTextEditor`
`src/core/webview/delegates/BackgroundTaskDelegate.ts` -> `BackgroundTaskDelegate` # 多 Agent 后台任务：把任务留驻在 `backgroundTasks`，用 Proxy 生成 silent provider 支撑后台继续执行
`src/core/webview/delegates/PendingEditDelegate.ts` -> `PendingEditDelegate` # 待处理编辑
`src/core/webview/delegates/McpDelegate.ts` -> `McpDelegate` # MCP 委托
`src/core/webview/delegates/StaticDelegate.ts` -> `StaticDelegate` # 静态入口（`static getInstance()`）
`src/core/webview/delegates/DisposeDelegate.ts` -> `DisposeDelegate` # 资源释放

**Worktree（工作树）:**

`src/core/webview/worktree/index.ts` -> 工作树管理汇总导出
`src/core/webview/worktree/handlers.ts` -> `handleListWorktrees()` / `handleCreateWorktree()` / `handleDeleteWorktree()` / `handleSwitchWorktree()` / `handleGetAvailableBranches()` / `handleGetWorktreeDefaults()` / `handleGetWorktreeIncludeStatus()` / `handleCheckBranchWorktreeInclude()`

**其他:**

`src/core/webview/webviewHtml.ts` -> `generateWebviewHtml()` # 生成 Webview HTML
`src/core/webview/delegation.ts` -> `delegateParentAndOpenChild()` # 任务委托
`src/core/webview/diagnosticsHandler.ts` -> `diagnosticsHandler()` # 诊断处理
`src/core/webview/generateSystemPrompt.ts` -> `generateSystemPrompt()` # 生成系统提示
`src/core/webview/checkpointRestoreHandler.ts` -> `checkpointRestoreHandler()` # 检查点恢复
`src/core/webview/aggregateTaskCosts.ts` -> `aggregateTaskCosts()` # 聚合任务成本
`src/core/webview/messageEnhancer.ts` -> `messageEnhancer()` # 消息增强
`src/core/webview/skillsMessageHandler.ts` -> 技能消息处理（`handleRequestSkills` / `handleCreateSkill` / `handleDeleteSkill` / `handleMoveSkill` / `handleUpdateSkillModes` / `handleOpenSkillFile`）
`src/core/webview/getNonce.ts` -> `getNonce()` # 获取随机数
`src/core/webview/getUri.ts` -> `getUri()` # 获取 URI

#### 2.2 任务系统

`src/core/task/Task.ts` -> `Task` # 核心任务类（约 4900 行，`extends EventEmitter`），管理 AI 交互循环
`src/core/task/Task.ts` -> `Task.create()` / `start()` / `pause()` / `resume()` / `abort()` # 任务生命周期
`src/core/task/Task.ts` -> `restoreDeletedFile()` / `restoreFileToOriginal()` / `getDeletedFiles()` # 文件恢复
`src/core/task/mergeConsecutiveApiMessages.ts` -> `mergeConsecutiveApiMessages()` # 合并连续 API 消息
`src/core/task/build-tools.ts` -> `buildTools()` # 构建工具列表
`src/core/task/validateToolResultIds.ts` -> `validateToolResultIds()` # 验证工具结果 ID
`src/core/task/AskIgnoredError.ts` -> `AskIgnoredError` # 忽略的提问错误

#### 2.3 工具系统

`src/core/tools/BaseTool.ts` -> `BaseTool<TName>` # 工具抽象基类，含 `execute()` 与 `handlePartial()`（部分流式消息）

> 约定：每个工具文件同时导出类与一个单例实例（如 `deleteFileTool`），由 `src/core/task/build-tools.ts` 汇总。

**原生工具实现:**

`src/core/tools/ReadFileTool.ts` -> `ReadFileTool` # 读取文件
`src/core/tools/WriteToFileTool.ts` -> `WriteToFileTool` # 写入文件
`src/core/tools/EditFileTool.ts` -> `EditFileTool` # 编辑文件
`src/core/tools/EditTool.ts` -> `EditTool` # 编辑 (diff 模式)
`src/core/tools/SearchFilesTool.ts` -> `SearchFilesTool` # 搜索文件
`src/core/tools/SearchAndReplaceTool.ts` -> `SearchAndReplaceTool` # 搜索替换
`src/core/tools/SearchReplaceTool.ts` -> `SearchReplaceTool` # 搜索替换 (新版，对应 `search_replace` 工具)
`src/core/tools/ExecuteCommandTool.ts` -> `ExecuteCommandTool` # 执行命令
`src/core/tools/ListFilesTool.ts` -> `ListFilesTool` # 列出文件
`src/core/tools/ApplyDiffTool.ts` -> `ApplyDiffTool` # 应用 diff
`src/core/tools/ApplyPatchTool.ts` -> `ApplyPatchTool` # 应用 patch
`src/core/tools/DeleteFileTool.ts` -> `DeleteFileTool` # 删除文件（走 `DeletedFilesService`，可从工具栏恢复）
`src/core/tools/CodebaseSearchTool.ts` -> `CodebaseSearchTool` # 代码库语义搜索
`src/core/tools/NewTaskTool.ts` -> `NewTaskTool` # 新建任务
`src/core/tools/SwitchModeTool.ts` -> `SwitchModeTool` # 切换模式
`src/core/tools/SkillTool.ts` -> `SkillTool` # 技能工具
`src/core/tools/GenerateImageTool.ts` -> `GenerateImageTool` # 生成图片
`src/core/tools/UseMcpToolTool.ts` -> `UseMcpToolTool` # 使用 MCP 工具
`src/core/tools/accessMcpResourceTool.ts` -> `accessMcpResourceTool` # 访问 MCP 资源
`src/core/tools/RunSlashCommandTool.ts` -> `RunSlashCommandTool` # 运行斜杠命令
`src/core/tools/AskFollowupQuestionTool.ts` -> `AskFollowupQuestionTool` # 询问后续问题
`src/core/tools/AttemptCompletionTool.ts` -> `AttemptCompletionTool` # 尝试完成
`src/core/tools/ReadCommandOutputTool.ts` -> `ReadCommandOutputTool` # 读取命令输出
`src/core/tools/UpdateTodoListTool.ts` -> `UpdateTodoListTool` # 更新待办列表

**工具辅助:**

`src/core/tools/validateToolUse.ts` -> `validateToolUse()` # 验证工具使用
`src/core/tools/ToolRepetitionDetector.ts` -> `ToolRepetitionDetector` # 工具重复检测
`src/core/tools/helpers/toolResultFormatting.ts` -> `formatToolResult()` # 格式化工具结果
`src/core/tools/helpers/imageHelpers.ts` -> `imageHelpers` # 图片处理辅助
`src/core/tools/apply-patch/apply.ts` -> `applyPatch()` # 应用 patch
`src/core/tools/apply-patch/parser.ts` -> `parsePatch()` # 解析 patch
`src/core/tools/apply-patch/seek-sequence.ts` -> `seekSequence()` # 序列搜索

#### 2.4 提示系统

`src/core/prompts/system.ts` -> `buildSystemPrompt()` # 构建系统提示
`src/core/prompts/responses.ts` -> 响应模板
`src/core/prompts/types.ts` -> 提示类型定义

**提示章节（`src/core/prompts/sections/`）:**

`index.ts` -> 章节汇总
`system-info.ts` -> 系统信息
`tool-use.ts` -> 工具使用指南
`tool-use-guidelines.ts` -> 工具使用准则
`custom-instructions.ts` -> 自定义指令
`modes.ts` -> 模式配置
`objective.ts` -> 目标定义
`rules.ts` -> 规则
`skills.ts` -> 技能
`capabilities.ts` -> 能力
`markdown-formatting.ts` -> Markdown 格式

**工具提示:**

`src/core/prompts/tools/native-tools/index.ts` -> 原生工具提示汇总（每个工具一个文件，含 `delete_file.ts` / `search_replace.ts` / `edit_file.ts` 等）
`src/core/prompts/tools/native-tools/converters.ts` -> 工具 schema 转换
`src/core/prompts/tools/filter-tools-for-mode.ts` -> `filterToolsForMode()` # 按模式过滤工具

#### 2.5 上下文管理

`src/core/context-management/index.ts` -> `manageContext()` / `truncateContext()` # 上下文管理与截断
`src/core/context-tracking/FileContextTracker.ts` -> `FileContextTracker` # 文件上下文追踪
`src/core/context-tracking/FileContextTrackerTypes.ts` -> 追踪类型定义
`src/core/context/context-management/context-error-handling.ts` -> `handleContextError()` # 上下文错误处理

#### 2.6 上下文压缩

`src/core/condense/index.ts` -> `condenseContext()` # 压缩上下文
`src/core/condense/foldedFileContext.ts` -> `foldFileContext()` # 折叠文件上下文

#### 2.7 检查点系统

`src/core/checkpoints/index.ts` -> `createCheckpoint()` / `restoreCheckpoint()` # 创建与恢复检查点
`src/services/checkpoints/DeletedFilesService.ts` -> `DeletedFilesService` # 删除文件回收站（可恢复）
`src/services/checkpoints/FileSnapshotService.ts` -> `FileSnapshotService` # 文件快照

#### 2.8 消息管理

`src/core/message-manager/index.ts` -> `MessageManager` # 消息管理器
`src/core/message-queue/MessageQueueService.ts` -> `MessageQueueService` # 消息队列服务（EventEmitter）

#### 2.9 自动审批

`src/core/auto-approval/index.ts` -> `checkAutoApproval()` # 审批决策总入口（同文件 re-export `AutoApprovalHandler`；`AutoApprovalState` / `CheckAutoApprovalResult` 类型定义在此）
`src/core/auto-approval/AutoApprovalHandler.ts` -> `AutoApprovalHandler` # 自动审批处理器
`src/core/auto-approval/commands.ts` -> `getCommandDecision()` / `parseCommand()` # 命令审批规则（按 `&&`/`||`/`;`/`|` 拆子命令）
`src/core/auto-approval/tools.ts` -> 工具审批规则
`src/core/auto-approval/mcp.ts` -> MCP 审批规则

#### 2.10 忽略控制

`src/core/ignore/RooIgnoreController.ts` -> `RooIgnoreController` # Roo 忽略控制器（`.rooignore`）
`src/core/protect/RooProtectedController.ts` -> `RooProtectedController` # 保护控制器

#### 2.11 环境信息

`src/core/environment/getEnvironmentDetails.ts` -> `getEnvironmentDetails()` # 获取环境详情
`src/core/environment/reminder.ts` -> `reminder()` # 提醒

#### 2.12 引用处理

`src/core/mentions/index.ts` -> 引用处理
`src/core/mentions/processUserContentMentions.ts` -> `processUserContentMentions()` # 处理用户内容引用
`src/core/mentions/resolveImageMentions.ts` -> `resolveImageMentions()` # 解析图片引用

#### 2.13 Diff 统计

`src/core/diff/stats.ts` -> `getDiffStats()` # 获取 diff 统计
`src/core/diff/strategies/multi-search-replace.ts` -> 多搜索替换策略

#### 2.14 配置管理

`src/core/config/ContextProxy.ts` -> `ContextProxy` # 上下文代理（全局单例）
`src/core/config/CustomModesManager.ts` -> `CustomModesManager` # 自定义模式管理
`src/core/config/ProviderSettingsManager.ts` -> `ProviderSettingsManager` # 提供者设置管理
`src/core/config/importExport.ts` -> 导入导出

#### 2.15 Assistant 消息

`src/core/assistant-message/index.ts` -> 助手消息处理
`src/core/assistant-message/NativeToolCallParser.ts` -> `NativeToolCallParser` # 原生工具调用解析：`parseToolCall()`（完整）/ `createPartialToolUse()`（流式部分）/ `startStreamingToolCall()` 等流式状态机；两处 switch 需覆盖 `src/shared/tools.ts` 的 `NativeToolArgs`
`src/core/assistant-message/presentAssistantMessage.ts` -> `presentAssistantMessage()` # 展示助手消息
`src/core/assistant-message/types.ts` -> 助手消息类型

#### 2.16 任务持久化

`src/core/task-persistence/index.ts` -> 任务持久化
`src/core/task-persistence/TaskHistoryStore.ts` -> `TaskHistoryStore` # 任务历史存储
`src/core/task-persistence/apiMessages.ts` -> API 消息持久化
`src/core/task-persistence/taskMessages.ts` -> 任务消息持久化
`src/core/task-persistence/taskMetadata.ts` -> `taskMetadata()` # 计算任务元数据（含 `size`：任务目录磁盘字节数，递归统计并缓存 30 秒）

### 3. API 层

`src/api/index.ts` -> `buildApiHandler()` # 构建 API 处理器
`src/api/transform/stream.ts` -> `ApiStream` # API 流
`src/api/transform/image-cleaning.ts` -> `maybeRemoveImageBlocks()` # 图片清理

**API 提供商（`src/api/providers/`）:**

`anthropic.ts` / `anthropic-vertex.ts` / `openai.ts` / `openai-native.ts` / `openai-compatible.ts` / `openai-codex.ts` / `gemini.ts` / `vertex.ts` / `bedrock.ts` / `native-ollama.ts` / `lm-studio.ts` / `deepseek.ts` / `mistral.ts` / `moonshot.ts` / `minimax.ts` / `xai.ts` / `zai.ts` / `qwen-code.ts` / `fireworks.ts` / `baseten.ts` / `sambanova.ts` / `poe.ts` / `requesty.ts` / `unbound.ts` / `openrouter.ts` / `lite-llm.ts` / `vercel-ai-gateway.ts` / `vscode-lm.ts` / `fake-ai.ts` -> 各提供商实现
`base-provider.ts` / `base-openai-compatible-provider.ts` / `router-provider.ts` -> 提供商基类与路由适配
`src/api/providers/fetchers/modelCache.ts` -> `initializeModelCacheRefresh()` # 模型缓存刷新
`src/api/providers/utils/error-handler.ts` / `openai-error-handler.ts` / `timeout-config.ts` / `router-tool-preferences.ts` / `image-generation.ts` -> 提供商通用工具

**流式/格式转换（`src/api/transform/`）:**

`anthropic-filter.ts` / `bedrock-converse-format.ts` / `gemini-format.ts` / `openai-format.ts` / `responses-api-stream.ts` / `responses-api-input.ts` / `r1-format.ts` / `reasoning.ts` / `zai-format.ts` / `minimax-format.ts` / `mistral-format.ts` / `vscode-lm-format.ts` / `ai-sdk.ts` / `model-params.ts`
`src/api/transform/caching/` -> 提示缓存策略（`anthropic.ts` / `gemini.ts` / `vertex.ts` / `vercel-ai-gateway.ts`）
`src/api/transform/cache-strategy/` -> 缓存策略抽象（`base-strategy.ts` / `multi-point-strategy.ts`）

### 4. 集成层 (`src/integrations/`)

#### 4.1 编辑器

`src/integrations/editor/DiffViewProvider.ts` -> `DiffViewProvider` # Diff 视图提供者
`src/integrations/editor/DecorationController.ts` -> `DecorationController` # 装饰控制器
`src/integrations/editor/EditorUtils.ts` -> 编辑器工具

#### 4.2 终端

`src/integrations/terminal/TerminalRegistry.ts` -> `TerminalRegistry` # 终端注册表
`src/integrations/terminal/Terminal.ts` / `TerminalProcess.ts` -> 终端与进程封装
`src/integrations/terminal/ExecaTerminal.ts` / `ExecaTerminalProcess.ts` -> 基于 execa 的终端实现（`encoding: "buffer"` + 行边界缓冲，逐行判定 GBK / UTF-8）
`src/integrations/terminal/BaseTerminal.ts` / `BaseTerminalProcess.ts` / `OutputInterceptor.ts` / `ShellIntegrationManager.ts` / `mergePromise.ts` / `types.ts` -> 终端基础设施

#### 4.3 主题

`src/integrations/theme/getTheme.ts` -> `getTheme()` # 获取主题
`src/integrations/theme/default-themes/` -> 默认主题文件

#### 4.4 工作区

`src/integrations/workspace/WorkspaceTracker.ts` -> `WorkspaceTracker` # 工作区追踪

#### 4.5 诊断

`src/integrations/diagnostics/index.ts` -> 诊断管理

#### 4.6 OpenAI Codex

`src/integrations/openai-codex/oauth.ts` -> `openAiCodexOAuthManager` # Codex OAuth
`src/integrations/openai-codex/rate-limits.ts` -> 速率限制查询

#### 4.7 杂项

`src/integrations/misc/export-markdown.ts` -> `exportMarkdown()` # 导出 Markdown
`src/integrations/misc/extract-text.ts` -> `extractText()` # 提取文本
`src/integrations/misc/extract-text-from-xlsx.ts` -> 从 xlsx 提取文本
`src/integrations/misc/open-file.ts` -> `openFile()` # 打开文件
`src/integrations/misc/process-images.ts` -> `processImages()` # 处理图片
`src/integrations/misc/image-handler.ts` -> 图片处理器
`src/integrations/misc/indentation-reader.ts` -> `IndentationReader` # 缩进读取器
`src/integrations/misc/read-lines.ts` -> `readLines()` # 读取行
`src/integrations/misc/line-counter.ts` -> 行计数

### 5. 服务层 (`src/services/`)

`src/services/SettingsStore.ts` -> `SettingsStore` # 设置存储（`{globalStoragePath}/settings/`）
`src/services/mcp/McpHub.ts` -> `McpHub` # MCP 集线器（单例）
`src/services/mcp/McpServerManager.ts` -> `McpServerManager` # MCP 服务器管理
`src/services/mcp/mcpConfigValidator.ts` -> `ServerConfigSchema` / `validateServerConfig()` # MCP 配置校验（zod）
`src/services/skills/SkillsManager.ts` -> `SkillsManager` # 技能管理
`src/services/skills/skillInvocation.ts` -> `resolveSkillContentForMode()` / `buildSkillApprovalMessage()` / `buildSkillResult()` # 技能调用
`src/services/checkpoints/` -> 检查点服务（`RepoPerTaskCheckpointService` / `ShadowCheckpointService` / `FileSnapshotService` / `DeletedFilesService` / `excludes.ts`）
`src/services/command/` -> 命令服务（`built-in-commands.ts` / `commands.ts`）
`src/services/ripgrep/` -> Ripgrep 集成服务
`src/services/roo-config/` -> Roo 配置服务
`src/services/search/file-search.ts` -> 文件搜索服务

**通配符 / 排除目录（`src/services/glob/`）:**

`constants.ts` -> `DEFAULT_DIRS_TO_IGNORE` # 默认排除目录列表（@deprecated）
`ignore-config.ts` -> `ensureIgnoreConfigExists()` / `getDirsToIgnore()` / `getDirsToIgnoreCached()` / `updateDirsToIgnore()` / `buildRipgrepExcludeArgs()` # 用户可编辑的排除目录配置（`{globalStoragePath}/settings/ignore.json`，格式 `{ "DIRS_TO_IGNORE": [...] }`）
`ignore-utils.ts` -> `isPathInIgnoredDirectory()` / `initIgnoreUtilsCache()` # 同步路径检查（同步缓存 `_cachedDirsToIgnore`，供 scanner / file-watcher 使用）
`list-files.ts` -> `listFiles()` # 文件列表扫描（用异步缓存 `getDirsToIgnoreCached()`，供代码索引）

**Tree-sitter 语法分析（`src/services/tree-sitter/`）:**

`index.ts` / `languageParser.ts` / `markdownParser.ts` -> 解析入口
`queries/` -> 各语言查询文件（`typescript.ts` / `tsx.ts` / `python.ts` / `go.ts` / `rust.ts` / `java.ts` / `cpp.ts` / `c.ts` / `c-sharp.ts` / `ruby.ts` / `php.ts` / `swift.ts` / `kotlin.ts` / `scala.ts` / `lua.ts` / `elixir.ts` / `ocaml.ts` / `solidity.ts` / `zig.ts` / `css.ts` / `html.ts` / `vue.ts` / `toml.ts` / `tlaplus.ts` / `systemrdl.ts` / `embedded_template.ts` / `elisp.ts`）

#### 5.1 代码库索引子系统（`src/services/code-index/`，约 4200 行）

采用 **Manager + 状态机 + 服务工厂** 结构：

`src/services/code-index/manager.ts` -> `CodeIndexManager` # 门面与生命周期：`getInstance(context, workspacePath?)` / `getAllInstances()` / `disposeAll()`（单例按工作区路径 keyed）；对外 `initialize()` / `startIndexing()` / `stopIndexing()` / `stopWatcher()` / `searchIndex()` / `clearIndexData()` / `recoverFromError()` / `handleSettingsChange()` / `dispose()`
`src/services/code-index/manager.ts` -> `manager.state` / `isFeatureEnabled` / `isFeatureConfigured` / `isWorkspaceEnabled` / `autoEnableDefault` / `indexWorkspacePath` / `getCurrentStatus()` / `onProgressUpdate` # 状态与开关。两个 flag 由 `_configManager` 派生，后者只在 `initialize()` 中创建，读 flag 前必须先 `await initialize()`
`src/services/code-index/config-manager.ts` -> `CodeIndexConfigManager` # 读 `codebaseIndexConfig` 全局状态与密钥，派生 `isFeatureEnabled` / `isFeatureConfigured`，`loadConfiguration()` 返回 `{ requiresRestart }`
`src/services/code-index/state-manager.ts` -> `CodeIndexStateManager` # 状态机与进度事件（`IndexingState` 类型定义在此，`onProgressUpdate` 来源）
`src/services/code-index/service-factory.ts` -> `CodeIndexServiceFactory` # 按配置构造 embedder / vectorStore / scanner / fileWatcher，并提供 `validateEmbedder()`
`src/services/code-index/orchestrator.ts` -> `CodeIndexOrchestrator` # 扫描—嵌入—写库编排，维护 `state`
`src/services/code-index/search-service.ts` -> `CodeIndexSearchService` # `searchIndex(query, directoryPrefix?)`
`src/services/code-index/cache-manager.ts` -> `CacheManager` # 文件哈希缓存（`implements ICacheManager`），支撑增量索引
`src/services/code-index/interfaces/` -> `embedder.ts` / `vector-store.ts` / `file-processor.ts` / `cache.ts` / `config.ts` / `manager.ts` / `index.ts` # 各组件接口
`src/services/code-index/embedders/` -> 向量化实现：`openai.ts` / `openai-compatible.ts` / `gemini.ts` / `mistral.ts` / `bedrock.ts` / `ollama.ts` / `openrouter.ts` / `vercel-ai-gateway.ts`
`src/services/code-index/vector-store/qdrant-client.ts` -> Qdrant 客户端（约 680 行）
`src/services/code-index/processors/scanner.ts` -> 初始全量扫描
`src/services/code-index/processors/file-watcher.ts` -> 增量文件监听
`src/services/code-index/processors/parser.ts` -> 代码分块（按 Tree-sitter 结构切块）
`src/services/code-index/shared/supported-extensions.ts` / `get-relative-path.ts` / `validation-helpers.ts` -> 共享工具
`src/services/code-index/constants/index.ts` -> 分块与检索常量（`MAX_BLOCK_CHARS` / `MIN_BLOCK_CHARS` / `MAX_FILE_SIZE_BYTES` / `QDRANT_CODE_BLOCK_NAMESPACE` / 默认检索条数与最小分数）

**消息链路:**

```
CodeIndexPopover / IndexingStatusBadge (webview-ui)
   │ postMessage                        ▲ indexingStatusUpdate
   ▼                                    │ (values = manager.getCurrentStatus())
webviewMessageHandler → src/core/webview/handlers/codeIndexHandlers.ts → provider.getCurrentWorkspaceCodeIndexManager()
   → CodeIndexManager → ConfigManager / StateManager / ServiceFactory → Embedder + Qdrant + Scanner + FileWatcher
```

`codeIndexHandlers.ts` 处理的消息：`saveCodeIndexSettingsAtomic` / `requestIndexingStatus` / `requestCodeIndexSecretStatus` / `startIndexing` / `stopIndexing` / `toggleWorkspaceIndexing` / `setAutoEnableDefault` / `setIndexWorkspacePath` / `clearIndexData`。
「索引工作区路径」输入框的显示条件是 `codebaseIndexEnabled && indexingStatus.workspaceEnabled`；状态点颜色：Standby 灰 / Indexing 黄闪 / Indexed 绿 / Error 红。

### 6. 共享模块 (`src/shared/`)

`src/shared/package.ts` -> `Package` # 包信息
`src/shared/language.ts` -> `formatLanguage()` # 语言格式化
`src/shared/modes.ts` -> `getModeBySlug()` / `defaultModeSlug` # 模式获取
`src/shared/parse-command.ts` -> `parseCommand()` # 命令解析（按 `&&`/`||`/`;`/`|` 拆子命令）
`src/shared/combineApiRequests.ts` -> `combineApiRequests()` # 合并 API 请求
`src/shared/combineCommandSequences.ts` -> `combineCommandSequences()` # 合并命令序列
`src/shared/getApiMetrics.ts` -> `getApiMetrics()` # API 指标
`src/shared/api.ts` -> API 工具函数
`src/shared/embeddingModels.ts` -> `EMBEDDING_MODEL_PROFILES` # 嵌入模型配置
`src/shared/WebviewMessage.ts` -> `ClineAskResponse` # Webview 消息类型
`src/shared/globalFileNames.ts` -> `GlobalFileNames` # 全局文件名
`src/shared/tools.ts` -> `ToolUse` / `ToolParamName` / `NativeToolArgs` # 工具类型
`src/shared/ProfileValidator.ts` -> `ProfileValidator` # 配置验证
`src/shared/context-mentions.ts` / `path-mentions` 相关 -> 上下文引用语法
`src/shared/cost.ts` / `core.ts` / `experiments.ts` / `skills.ts` / `todo.ts` / `array.ts` / `checkExistApiConfig.ts` / `support-prompt.ts` / `vsCodeSelectorUtils.ts` -> 其他共享工具

### 7. 类型定义

**扩展侧 `src/types/` 现在只剩 `global-agent.d.ts`**（模块声明），业务类型已全部迁出：

`packages/types/src/index.ts` -> `@roo-code/types` 总导出
`packages/types/src/task.ts` -> 任务类型
`packages/types/src/tool.ts` / `tool-params.ts` / `cline-tool-types.ts` -> 工具类型
`packages/types/src/message.ts` -> 消息类型
`packages/types/src/mode.ts` -> 模式类型
`packages/types/src/provider-settings.ts` / `model.ts` / `organization.ts` -> 提供者与模型类型
`packages/types/src/api.ts` -> API 类型
`packages/types/src/cli.ts` / `ipc.ts` -> CLI 与 IPC 类型
`packages/types/src/mcp.ts` -> MCP 类型
`packages/types/src/skills.ts` -> 技能类型
`packages/types/src/worktree.ts` -> 工作树类型
`packages/types/src/events.ts` -> 事件类型
`packages/types/src/background-task.ts` -> `BackgroundTaskItem` # 多 Agent 后台任务类型
`packages/types/src/indexing.ts` / `codebase-index.ts` -> 代码库索引类型
`packages/types/src/checkpoint.ts` -> 检查点类型
`packages/types/src/extension-state.ts` -> `ExtensionState`（webview 状态契约）
`packages/types/src/vscode-extension-host.ts` -> `ExtensionMessage` / `WebviewMessage`（宿主与 webview 消息契约）
`packages/types/src/global-settings.ts` -> 全局设置（`GlobalState`）
`packages/types/src/embedding.ts` -> 嵌入类型
`packages/types/src/history.ts` / `followup.ts` / `todo.ts` / `terminal.ts` / `git.ts` / `image-generation.ts` / `custom-tool.ts` / `experiment.ts` / `cookie-consent.ts` / `context-management.ts` / `type-fu.ts` / `roomodes-schema.ts` / `vscode.ts` -> 各领域类型
`packages/types/src/providers/` -> 各提供商类型定义

### 8. 工具函数 (`src/utils/`)

`src/utils/config.ts` -> 配置工具
`src/utils/storage.ts` -> 存储工具
`src/utils/path.ts` -> 路径工具（含 `getWorkspacePath()`、`String.prototype.toPosix`）
`src/utils/pathUtils.ts` -> 路径实用工具
`src/utils/git.ts` -> Git 工具
`src/utils/shell.ts` -> Shell 工具
`src/utils/countTokens.ts` -> `countTokens()` # 计数 token
`src/utils/tiktoken.ts` -> TikToken 编码
`src/utils/mcp-name.ts` -> MCP 命名
`src/utils/tool-id.ts` -> 工具 ID
`src/utils/errors.ts` -> 错误处理
`src/utils/fs.ts` -> 文件系统
`src/utils/safeWriteJson.ts` -> 安全 JSON 写入
`src/utils/text-normalization.ts` -> 文本规范化
`src/utils/tag-matcher.ts` -> 标签匹配
`src/utils/json-schema.ts` -> JSON Schema 工具
`src/utils/object.ts` -> 对象工具
`src/utils/commands.ts` -> 命令工具
`src/utils/globalContext.ts` -> 全局上下文
`src/utils/single-completion-handler.ts` -> 单一完成处理器
`src/utils/autoImportSettings.ts` -> 自动导入设置
`src/utils/migrateSettings.ts` -> 设置迁移
`src/utils/networkProxy.ts` -> `initializeNetworkProxy()` # 网络代理
`src/utils/focusPanel.ts` -> 面板聚焦
`src/utils/export.ts` -> 导出
`src/utils/tts.ts` -> 文本转语音
`src/utils/outputChannelLogger.ts` -> 输出通道日志
`src/utils/vitest-verbosity.ts` -> 测试输出控制

**日志:**

`src/utils/logging/index.ts` -> 日志汇总
`src/utils/logging/CompactLogger.ts` -> `CompactLogger` # 紧凑日志记录器
`src/utils/logging/CompactTransport.ts` -> `CompactTransport` # 紧凑传输
`src/utils/logging/types.ts` -> 日志类型

**Worker:**

`src/workers/countTokens.ts` -> token 计数的 Web Worker 入口
`src/workers/types.ts` -> Worker 消息类型

### 9. Webview UI (`webview-ui/src/`)

**入口:**

`webview-ui/src/index.tsx` -> 应用入口
`webview-ui/src/App.tsx` -> 根组件
`webview-ui/src/components/ErrorBoundary.tsx` -> 错误边界

**组件 - 聊天 (`webview-ui/src/components/chat/`):**

`webview-ui/src/components/chat/ChatView.tsx` -> 聊天主视图
`webview-ui/src/components/chat/ChatTextArea.tsx` -> 输入区
`webview-ui/src/components/chat/ChatRow.tsx` / `ErrorRow.tsx` / `WarningRow.tsx` -> 消息行
`webview-ui/src/components/chat/TaskHeader.tsx` / `TaskActions.tsx` -> 任务头部与操作
`webview-ui/src/components/chat/ContextWindowProgress.tsx` -> 上下文窗口进度
`webview-ui/src/components/chat/IndexingStatusBadge.tsx` -> `IndexingStatusBadge` # 索引状态徽标（触发 `CodeIndexPopover`）
`webview-ui/src/components/chat/CodeIndexPopover.tsx` -> `CodeIndexPopover` # 代码库索引弹窗：配置表单 + 状态点 + 「开始/停止」+ 工作区开关 + 目标目录输入
`webview-ui/src/components/chat/CodebaseSearchResult.tsx` / `CodebaseSearchResultsDisplay.tsx` -> 语义检索结果展示
`webview-ui/src/components/chat/FileChangesPanel.tsx` -> 文件改动面板（含删除文件恢复入口）
`webview-ui/src/components/chat/BackgroundSessions.tsx` -> 后台会话列表（多 Agent）
`webview-ui/src/components/chat/WorktreeSelector.tsx` -> 工作树选择器
`webview-ui/src/components/chat/Markdown.tsx` / `ReasoningBlock.tsx` / `Mention.tsx` / `QueuedMessages.tsx` / `FollowUpSuggest.tsx` / `ProgressIndicator.tsx` / `TodoListDisplay.tsx` / `UpdateTodoListToolBlock.tsx` / `TodoChangeDisplay.tsx` / `CommandExecution.tsx` / `McpExecution.tsx` / `TerminalOutput.tsx` / `BatchDiffApproval.tsx` / `CheckpointRestoreDialog.tsx` / `ProfileViolationWarning.tsx` / `ShareButton.tsx` / `Announcement.tsx` / `AutoApproveDropdown.tsx` / `CommandPatternSelector.tsx` / `ApiConfigSelector.tsx` / `ModeSelector.tsx` / `ContextMenu.tsx` / `IconButton.tsx` / `LucideIconButton.tsx` / `MessageModificationConfirmationDialog.tsx` / `OpenMarkdownPreviewButton.tsx` / `SlashCommandItemSimple.tsx` -> 聊天相关组件
`webview-ui/src/components/chat/checkpoints/` -> `CheckpointMenu.tsx` / `CheckpointSaved.tsx` / `schema.ts`
`webview-ui/src/components/chat/context-management/` -> `CondensationResultRow.tsx` / `CondensationErrorRow.tsx` / `TruncationResultRow.tsx` / `InProgressRow.tsx`
`webview-ui/src/components/chat/hooks/usePromptHistory.ts` -> 提示历史
`webview-ui/src/components/chat/utils/fileChangesFromMessages.ts` -> 从消息推导文件改动

**组件 - 历史:**

`webview-ui/src/components/history/HistoryView.tsx` -> `HistoryView` # 历史视图
`webview-ui/src/components/history/HistoryPreview.tsx` -> `HistoryPreview` # 历史预览
`webview-ui/src/components/history/TaskItem.tsx` / `TaskGroupItem.tsx` / `SubtaskRow.tsx` / `SubtaskCollapsibleRow.tsx` -> 任务项与分组
`webview-ui/src/components/history/useGroupedTasks.ts` -> `useGroupedTasks()` # 分组任务
`webview-ui/src/components/history/useTaskSearch.ts` -> `useTaskSearch()` # 搜索任务
`webview-ui/src/components/history/BatchDeleteTaskDialog.tsx` / `DeleteTaskDialog.tsx` / `DeleteButton.tsx` / `ExportButton.tsx` / `CopyButton.tsx` / `TaskItemFooter.tsx` -> 任务操作

**组件 - 设置:**

`webview-ui/src/components/settings/SettingsView.tsx` -> `SettingsView` # 设置视图
`webview-ui/src/components/settings/ApiOptions.tsx` -> `ApiOptions` # API 选项
`webview-ui/src/components/settings/ModelPicker.tsx` -> `ModelPicker` # 模型选择器
`webview-ui/src/components/settings/ApiConfigManager.tsx` -> API 配置档案管理
`webview-ui/src/components/settings/AutoApproveSettings.tsx` / `AutoApproveToggle.tsx` -> 自动审批设置（含 Execute 开关）
`webview-ui/src/components/settings/CheckpointSettings.tsx` / `ContextManagementSettings.tsx` / `TerminalSettings.tsx` / `UISettings.tsx` / `ExperimentalSettings.tsx` / `NotificationSettings.tsx` / `LanguageSettings.tsx` / `PromptsSettings.tsx` / `SkillsSettings.tsx` / `SlashCommandsSettings.tsx` / `CustomToolsSettings.tsx` / `ImageGenerationSettings.tsx` -> 分项设置页
`webview-ui/src/components/settings/SettingsSearch.tsx` / `SettingsSearchInput.tsx` / `SettingsSearchResults.tsx` / `useSettingsSearch.ts` -> 设置搜索
`webview-ui/src/components/settings/providers/` -> 各提供商的设置表单（`Anthropic.tsx` / `OpenAI.tsx` / `Gemini.tsx` / `Bedrock.tsx` / `Ollama.tsx` / `OpenRouter.tsx` / `Vertex.tsx` / `DeepSeek.tsx` / ... 共 30 个）

**组件 - 模式 / MCP / 工作树 / 欢迎 / 通用:**

`webview-ui/src/components/modes/ModesView.tsx` -> `ModesView` # 模式视图
`webview-ui/src/components/mcp/McpView.tsx` -> `McpView` # MCP 视图
`webview-ui/src/components/worktrees/WorktreesView.tsx` -> `WorktreesView` # 工作树视图
`webview-ui/src/components/welcome/WelcomeViewProvider.tsx` -> `WelcomeViewProvider` # 欢迎视图
`webview-ui/src/components/common/` -> 通用组件（`MarkdownBlock.tsx` / `CodeBlock.tsx` / `CodeAccordion.tsx` / `DiffView.tsx` / `ImageViewer.tsx` / `MermaidBlock.tsx` / `Modal.tsx` / `Tab.tsx` / `ToolUseBlock.tsx` / `Thumbnails.tsx` / `ZoomControls.tsx` 等）
`webview-ui/src/components/ui/` -> 基础 UI 组件（shadcn/radix 风格：`button.tsx` / `dialog.tsx` / `popover.tsx` / `select.tsx` / `tooltip.tsx` / `collapsible.tsx` / `command.tsx` 等）
`webview-ui/src/components/ui/hooks/` -> `useSelectedModel.ts` / `useRouterModels.ts` / `useOllamaModels.ts` / `useLmStudioModels.ts` / `useOpenRouterKeyInfo.ts` / `useRequestyKeyInfo.ts` / `useClipboard.ts` 等

**上下文 / Hooks / 国际化:**

`webview-ui/src/context/ExtensionStateContext.tsx` -> `ExtensionStateContext` # 扩展状态上下文（对应 `ExtensionState`）
`webview-ui/src/hooks/useAutoApprovalState.ts` / `useAutoApprovalToggles.ts` / `useEscapeKey.ts` / `useScrollLifecycle.ts` / `useTooManyTools.ts` -> 自定义 Hooks
`webview-ui/src/i18n/TranslationContext.tsx` / `setup.ts` -> 翻译上下文与初始化

**工具 / OAuth / 构建插件:**

`webview-ui/src/utils/format.ts` / `formatPathTooltip.ts` / `formatPrice.ts` / `costFormatting.ts` -> 格式化工具
`webview-ui/src/utils/markdown.ts` / `highlight.ts` / `highlightDiff.ts` / `highlighter.ts` / `sourceMapUtils.ts` -> 渲染工具
`webview-ui/src/utils/model-utils.ts` -> 模型工具
`webview-ui/src/utils/context-mentions.ts` / `path-mentions.ts` / `removeLeadingNonAlphanumeric.ts` -> 引用语法
`webview-ui/src/utils/mcp.ts` / `vscode.ts` / `validate.ts` / `clipboard.ts` / `useDebounceEffect.ts` / `imageUtils.ts` / `batchConsecutive.ts` / `command-parser.ts` / `docLinks.ts` / `getLanguageFromPath.ts` / `parseUnifiedDiff.ts` / `textMateToHljs.ts` -> 其他工具
`webview-ui/src/lib/utils.ts` -> 通用工具函数（`cn()` 等）
`webview-ui/src/oauth/urls.ts` -> OAuth URL 处理
`webview-ui/src/vite-plugins/sourcemapPlugin.ts` -> 源码映射插件

### 10. 共享包 (`packages/`)

#### 10.0 构建与配置包

`packages/build/src/esbuild.ts` / `git.ts` / `index.ts` / `types.ts` -> 共享 esbuild / git 构建工具
`packages/config-eslint/` -> ESLint 配置
`packages/config-typescript/` -> TypeScript 配置

#### 10.1 Types 包

见 §7 类型定义（根导出 `packages/types/src/index.ts`）。

#### 10.2 Core 包

`packages/core/src/index.ts` -> 核心导出
`packages/core/src/custom-tools/` -> 自定义工具（`custom-tool-registry.ts` / `esbuild-runner.ts` / `format-native.ts` / `serialize.ts`）
`packages/core/src/debug-log/` -> 调试日志
`packages/core/src/message-utils/` -> 消息工具（`consolidateApiRequests.ts` / `consolidateCommands.ts` / `consolidateTokenUsage.ts` / `safeJsonParse.ts`）
`packages/core/src/task-history/` -> 任务历史
`packages/core/src/worktree/` -> 工作树
`packages/core/src/browser.ts` / `cli.ts` -> 不同运行环境的入口

#### 10.3 VSCode Shim 包

`packages/vscode-shim/src/index.ts` -> Shim 导出
`packages/vscode-shim/src/api/` -> VS Code API Mock
`packages/vscode-shim/src/classes/` -> VS Code 类 Mock
`packages/vscode-shim/src/context/ExtensionContext.ts` -> 扩展上下文 Mock
`packages/vscode-shim/src/storage/` -> 存储 Mock
`packages/vscode-shim/src/interfaces/` / `types.ts` / `vscode.ts` -> 其余 Mock 结构

#### 10.4 IPC 包

`packages/ipc/src/index.ts` -> IPC 导出
`packages/ipc/src/ipc-client.ts` -> IPC 客户端
`packages/ipc/src/ipc-server.ts` -> IPC 服务端

### 11. CLI 应用 (`apps/cli/`)

`apps/cli/src/index.ts` -> CLI 入口
`apps/cli/src/commands/cli/run.ts` -> `run()` # 运行命令
`apps/cli/src/commands/cli/list.ts` -> `list()` # 列表命令
`apps/cli/src/commands/cli/cancellation.ts` -> `cancellation()` # 取消命令
`apps/cli/src/commands/cli/upgrade.ts` -> 升级命令
`apps/cli/src/commands/cli/stdin-stream.ts` -> stdin 流处理

**Agent 子运行时（`apps/cli/src/agent/`，CLI 内驱动一次任务）:**

`apps/cli/src/agent/index.ts` -> 汇总导出（`extension-host` / `json-event-emitter`）
`apps/cli/src/agent/extension-host.ts` / `extension-client.ts` -> 与扩展宿主通信（配合 `packages/ipc`）
`apps/cli/src/agent/agent-state.ts` / `state-store.ts` -> 运行时状态
`apps/cli/src/agent/message-processor.ts` / `ask-dispatcher.ts` -> 消息与提问分发
`apps/cli/src/agent/events.ts` / `json-event-emitter.ts` -> 事件与 JSON 事件流
`apps/cli/src/agent/output-manager.ts` / `prompt-manager.ts` -> 输出与交互提示

**UI 与 SDK:**

`apps/cli/src/ui/App.tsx` -> CLI UI 应用
`apps/cli/src/ui/components/` / `apps/cli/src/ui/hooks/`（`useInputHistory.ts` / `useMessageHandlers.ts` / `usePickerHandlers.ts` / `useTaskSubmit.ts` / `useTerminalSize.ts` / `useToast.ts`）/ `apps/cli/src/ui/stores/uiStateStore.ts` / `apps/cli/src/ui/utils/` -> Ink 风格终端界面
`apps/cli/src/lib/sdk/client.ts` -> SDK 客户端
`apps/cli/src/lib/sdk/index.ts` -> SDK 导出
`apps/cli/src/lib/storage/` / `packages/core/src/task-history/` -> CLI 侧存储

### 12. 扩展 API (`src/extension/api.ts`)

`src/extension/api.ts` -> `API` # 扩展对外 API 接口（`RooCodeAPI`），供 CLI / 其他扩展调用

---

## 核心数据流

```
用户输入 → ClineProvider(门面) → webviewMessageHandler → handlers/* → Task
        → 工具执行 (src/core/tools/) → API 调用 (src/api/) → MessageManager
        → ContextManagement → 响应返回 → ClineProvider → Webview UI
```

- **多 Agent 后台并行**：`BackgroundTaskDelegate` 把任务留驻在 `backgroundTasks`，用 Proxy 生成 silent provider 屏蔽回推，使后台任务继续执行且不污染当前 webview 状态。
- **代码库索引**：`src/core/webview/handlers/codeIndexHandlers.ts` 是唯一入口，状态经 `manager.getCurrentStatus()` 回推，进度由 `ClineProviderBase.updateCodeIndexStatusSubscription()` 订阅转发（链路图见 §5.1）。

---

## 设计模式

1. **委托模式 (Delegate Pattern)**: [`ClineProviderBase`](src/core/webview/ClineProviderBase.ts) 持状态与生命周期，[`ClineProvider`](src/core/webview/ClineProvider.ts) 作为薄门面把职责转发给 `src/core/webview/delegates/*`（10 个 delegate）
2. **策略 + 注册表模式 (Handlers)**: [`webviewMessageHandler`](src/core/webview/webviewMessageHandler.ts) 只做 `message.type` 分组路由，具体逻辑落在 `src/core/webview/handlers/*` 的 13 个域处理器
3. **观察者模式 (Observer Pattern)**: [`Task`](src/core/task/Task.ts)、[`ClineProviderBase`](src/core/webview/ClineProviderBase.ts)、[`MessageQueueService`](src/core/message-queue/MessageQueueService.ts) 基于 EventEmitter
4. **策略模式 (Strategy Pattern)**: 工具系统通过 [`BaseTool`](src/core/tools/BaseTool.ts) 抽象；[`CodeIndexServiceFactory`](src/services/code-index/service-factory.ts) 按配置装配 embedder / vector-store
5. **状态机 (State Machine)**: [`CodeIndexStateManager`](src/services/code-index/state-manager.ts) 管理 `Standby|Indexing|Indexed|Error|Stopping`
6. **单例模式**: [`ContextProxy`](src/core/config/ContextProxy.ts)、[`McpHub`](src/services/mcp/McpHub.ts)、[`SettingsStore`](src/services/SettingsStore.ts)、[`CodeIndexManager`](src/services/code-index/manager.ts)（按工作区路径 keyed 的 Map）
7. **容器/门面模式**: [`CodeIndexManager`](src/services/code-index/manager.ts) 对编排器、检索、缓存、配置做统一门面

## 技术栈

- **语言**: TypeScript 5.8.3
- **运行时**: Node.js 20.19.2（`engines.node`）
- **包管理**: pnpm 10.8.1（`packageManager`）
- **构建**: Turbo 2.5.6 + Esbuild 0.25（扩展）/ Vite 6.3.6（webview）
- **测试**: Vitest（扩展与 webview 各自 `vitest.config.ts`）
- **Webview UI**: React 18.3 + Vite + Tailwind CSS 4 + Radix UI + lucide-react
- **LLM SDK**: Anthropic SDK, OpenAI SDK, Google AI SDK（`@ai-sdk/*`）
- **打包发布**: `@vscode/vsce` 3.3.2（`pnpm vsix`）
