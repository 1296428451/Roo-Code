# Roo-Code 项目架构地图

> 最后更新: 2026-04-05
> 项目: [Roo-Code](https://github.com/RooVetCode/Roo-Code) - VS Code AI 编程助手扩展

---

## 项目概述

Roo-Code 是一个基于 VS Code 的 AI 编程助手扩展，支持多种 LLM 提供商（Anthropic、OpenAI、Gemini 等），提供代码生成、编辑、调试等功能。项目采用 monorepo 架构，使用 pnpm workspace 管理。

---

## 核心目录结构

```
Roo-Code/
├── src/                          # VS Code 扩展主项目 (apps/vscode)
│   ├── extension.ts              # 扩展入口点
│   ├── activate/                 # 激活逻辑
│   ├── api/                      # API 处理器
│   ├── core/                     # 核心业务逻辑
│   ├── extension/                # 扩展 API
│   ├── i18n/                     # 国际化
│   ├── integrations/             # VS Code 集成
│   ├── services/                 # 服务层
│   ├── shared/                   # 共享模块
│   ├── types/                    # 类型定义
│   ├── utils/                    # 工具函数
│   └── workers/                  # Web Workers
├── webview-ui/                   # Webview UI (React)
├── packages/                     # 共享包
│   ├── config-eslint/            # ESLint 配置
│   ├── config-typescript/        # TypeScript 配置
│   ├── core/                     # 核心逻辑包
│   ├── types/                    # 类型定义包
│   ├── vscode-shim/              # VS Code API Mock
│   └── ipc/                      # IPC 通信
├── apps/                         # 应用
│   ├── cli/                      # CLI 工具
│   ├── docs/                     # 文档站
│   ├── vscode-e2e/               # E2E 测试
│   └── vscode-nightly/           # 夜间构建
└── locales/                      # 翻译文件
```

---

## 核心模块

### 1. 扩展入口与激活

`src/extension.ts` -> `activateExtension()` # 扩展激活入口
`src/activate/index.ts` -> `activate()` # 激活逻辑汇总
`src/activate/registerCommands.ts` -> `registerCommands()` # 注册命令
`src/activate/registerCodeActions.ts` -> `registerCodeActions()` # 注册代码操作
`src/activate/handleTask.ts` -> `handleTask()` # 任务处理
`src/activate/handleUri.ts` -> `handleUri()` # URI 处理

### 2. 核心业务逻辑 (`src/core/`)

#### 2.1 Webview 管理

`src/core/webview/ClineProvider.ts` -> `ClineProvider` # Webview 视图提供者，核心状态管理
`src/core/webview/webviewMessageHandler.ts` -> `webviewMessageHandler()` # Webview 消息处理
`src/core/webview/webviewHtml.ts` -> `generateWebviewHtml()` # 生成 Webview HTML
`src/core/webview/delegation.ts` -> `delegateParentAndOpenChild()` # 任务委托
`src/core/webview/diagnosticsHandler.ts` -> `diagnosticsHandler()` # 诊断处理
`src/core/webview/generateSystemPrompt.ts` -> `generateSystemPrompt()` # 生成系统提示
`src/core/webview/checkpointRestoreHandler.ts` -> `checkpointRestoreHandler()` # 检查点恢复
`src/core/webview/aggregateTaskCosts.ts` -> `aggregateTaskCosts()` # 聚合任务成本
`src/core/webview/messageEnhancer.ts` -> `messageEnhancer()` # 消息增强
`src/core/webview/skillsMessageHandler.ts` -> `skillsMessageHandler()` # 技能消息处理
`src/core/webview/getNonce.ts` -> `getNonce()` # 获取随机数
`src/core/webview/getUri.ts` -> `getUri()` # 获取 URI

**Delegates (委托模式):**
`src/core/webview/delegates/ProviderStateDelegate.ts` -> `ProviderStateDelegate` # 提供者状态管理
`src/core/webview/delegates/ProviderProfileDelegate.ts` -> `ProviderProfileDelegate` # 提供者配置管理
`src/core/webview/delegates/TaskHistoryDelegate.ts` -> `TaskHistoryDelegate` # 任务历史管理
`src/core/webview/delegates/TaskStackDelegate.ts` -> `TaskStackDelegate` # 任务栈管理
`src/core/webview/delegates/WebviewLifecycleDelegate.ts` -> `WebviewLifecycleDelegate` # Webview 生命周期
`src/core/webview/delegates/DisposeDelegate.ts` -> `DisposeDelegate` # 资源释放
`src/core/webview/delegates/PendingEditDelegate.ts` -> `PendingEditDelegate` # 待处理编辑
`src/core/webview/delegates/McpDelegate.ts` -> `McpDelegate` # MCP 委托
`src/core/webview/delegates/StaticDelegate.ts` -> `StaticDelegate` # 静态委托

**Handlers:**
`src/core/webview/handlers/apiConfigHandlers.ts` -> API 配置处理器

#### 2.2 任务系统

`src/core/task/Task.ts` -> `Task` # 核心任务类 (4701行)，管理 AI 交互循环
`src/core/task/Task.ts` -> `Task.create()` # 创建任务
`src/core/task/Task.ts` -> `task.start()` # 启动任务
`src/core/task/Task.ts` -> `task.pause()` # 暂停任务
`src/core/task/Task.ts` -> `task.resume()` # 恢复任务
`src/core/task/Task.ts` -> `task.abort()` # 中止任务
`src/core/task/mergeConsecutiveApiMessages.ts` -> `mergeConsecutiveApiMessages()` # 合并连续 API 消息
`src/core/task/build-tools.ts` -> `buildTools()` # 构建工具列表
`src/core/task/validateToolResultIds.ts` -> `validateToolResultIds()` # 验证工具结果 ID
`src/core/task/AskIgnoredError.ts` -> `AskIgnoredError` # 忽略的提问错误

#### 2.3 工具系统

`src/core/tools/BaseTool.ts` -> `BaseTool<TName>` # 工具抽象基类
`src/core/tools/BaseTool.ts` -> `BaseTool.execute()` # 执行工具
`src/core/tools/BaseTool.ts` -> `BaseTool.handlePartial()` # 处理部分流式消息

**原生工具实现:**
`src/core/tools/ReadFileTool.ts` -> `ReadFileTool` # 读取文件
`src/core/tools/WriteToFileTool.ts` -> `WriteToFileTool` # 写入文件
`src/core/tools/EditFileTool.ts` -> `EditFileTool` # 编辑文件
`src/core/tools/EditTool.ts` -> `EditTool` # 编辑 (diff模式)
`src/core/tools/SearchFilesTool.ts` -> `SearchFilesTool` # 搜索文件
`src/core/tools/SearchAndReplaceTool.ts` -> `SearchAndReplaceTool` # 搜索替换
`src/core/tools/ExecuteCommandTool.ts` -> `ExecuteCommandTool` # 执行命令
`src/core/tools/ListFilesTool.ts` -> `ListFilesTool` # 列出文件
`src/core/tools/ApplyDiffTool.ts` -> `ApplyDiffTool` # 应用 diff
`src/core/tools/ApplyPatchTool.ts` -> `ApplyPatchTool` # 应用 patch
`src/core/tools/CodebaseSearchTool.ts` -> `CodebaseSearchTool` # 代码库搜索
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

**提示章节:**
`src/core/prompts/sections/index.ts` -> 章节汇总
`src/core/prompts/sections/system-info.ts` -> 系统信息
`src/core/prompts/sections/tool-use.ts` -> 工具使用指南
`src/core/prompts/sections/tool-use-guidelines.ts` -> 工具使用准则
`src/core/prompts/sections/custom-instructions.ts` -> 自定义指令
`src/core/prompts/sections/modes.ts` -> 模式配置
`src/core/prompts/sections/objective.ts` -> 目标定义
`src/core/prompts/sections/rules.ts` -> 规则
`src/core/prompts/sections/skills.ts` -> 技能
`src/core/prompts/sections/capabilities.ts` -> 能力
`src/core/prompts/sections/markdown-formatting.ts` -> Markdown 格式

**工具提示:**
`src/core/prompts/tools/native-tools/index.ts` -> 原生工具提示汇总
`src/core/prompts/tools/filter-tools-for-mode.ts` -> `filterToolsForMode()` # 按模式过滤工具

#### 2.5 上下文管理

`src/core/context-management/index.ts` -> `manageContext()` # 上下文管理
`src/core/context-management/index.ts` -> `truncateContext()` # 截断上下文
`src/core/context-tracking/FileContextTracker.ts` -> `FileContextTracker` # 文件上下文追踪
`src/core/context-tracking/FileContextTrackerTypes.ts` -> 追踪类型定义
`src/core/context/context-management/context-error-handling.ts` -> `handleContextError()` # 上下文错误处理

#### 2.6 上下文压缩

`src/core/condense/index.ts` -> `condenseContext()` # 压缩上下文
`src/core/condense/foldedFileContext.ts` -> `foldFileContext()` # 折叠文件上下文

#### 2.7 检查点系统

`src/core/checkpoints/index.ts` -> `createCheckpoint()` # 创建检查点
`src/core/checkpoints/index.ts` -> `restoreCheckpoint()` # 恢复检查点

#### 2.8 消息管理

`src/core/message-manager/index.ts` -> `MessageManager` # 消息管理器
`src/core/message-queue/MessageQueueService.ts` -> `MessageQueueService` # 消息队列服务

#### 2.9 自动审批

`src/core/auto-approval/AutoApprovalHandler.ts` -> `AutoApprovalHandler` # 自动审批处理器
`src/core/auto-approval/commands.ts` -> 命令审批规则
`src/core/auto-approval/tools.ts` -> 工具审批规则
`src/core/auto-approval/mcp.ts` -> MCP 审批规则

#### 2.10 忽略控制

`src/core/ignore/RooIgnoreController.ts` -> `RooIgnoreController` # Roo 忽略控制器 (.roomodes)
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

`src/core/config/ContextProxy.ts` -> `ContextProxy` # 上下文代理
`src/core/config/CustomModesManager.ts` -> `CustomModesManager` # 自定义模式管理
`src/core/config/ProviderSettingsManager.ts` -> `ProviderSettingsManager` # 提供者设置管理
`src/core/config/importExport.ts` -> 导入导出

#### 2.15 Assistant 消息

`src/core/assistant-message/index.ts` -> 助手消息处理
`src/core/assistant-message/NativeToolCallParser.ts` -> `NativeToolCallParser` # 原生工具调用解析
`src/core/assistant-message/presentAssistantMessage.ts` -> `presentAssistantMessage()` # 展示助手消息
`src/core/assistant-message/types.ts` -> 助手消息类型

#### 2.16 任务持久化

`src/core/task-persistence/index.ts` -> 任务持久化
`src/core/task-persistence/TaskHistoryStore.ts` -> `TaskHistoryStore` # 任务历史存储
`src/core/task-persistence/apiMessages.ts` -> API 消息持久化
`src/core/task-persistence/taskMessages.ts` -> 任务消息持久化
`src/core/task-persistence/taskMetadata.ts` -> `taskMetadata()` # 计算任务元数据（含 size）
  - `size` 含义：任务目录在磁盘上占用的总字节数（递归计算所有文件）
  - 使用 `get-folder-size.loose()` 模式，不可读文件会被跳过（catch 错误继续）
  - 计算结果通过 `NodeCache` 缓存 30 秒（`stdTTL: 30`）
  - `strict` 模式在当前代码库中**从未被使用**，无用户可配置选项
  - 前端显示：通过 `prettyBytes()` 格式化为 `B/KB/MB/GB`（[`TaskHeader.tsx:410-418`](src/core/task-persistence/taskMetadata.ts:82)）

#### 2.17 Webview 工作树

`src/core/webview/worktree/index.ts` -> 工作树管理
`src/core/webview/worktree/handlers.ts` -> 工作树处理器

### 3. API 层

`src/api/index.ts` -> `buildApiHandler()` # 构建 API 处理器
`src/api/transform/stream.ts` -> `ApiStream` # API 流
`src/api/transform/image-cleaning.ts` -> `maybeRemoveImageBlocks()` # 图片清理

**API 提供商:**
`src/api/providers/anthropic.ts` -> Anthropic 提供商
`src/api/providers/openai.ts` -> OpenAI 提供商
`src/api/providers/openai-codex.ts` -> OpenAI Codex 提供商
`src/api/providers/gemini.ts` -> Gemini 提供商
`src/api/providers/vertex.ts` -> Vertex 提供商
`src/api/providers/bedrock.ts` -> Bedrock 提供商
`src/api/providers/ollama.ts` -> Ollama 提供商
`src/api/providers/vscode-llm.ts` -> VS Code LLM 提供商
`src/api/providers/fetchers/modelCache.ts` -> `initializeModelCacheRefresh()` # 模型缓存刷新

### 4. 集成层 (`src/integrations/`)

#### 4.1 编辑器

`src/integrations/editor/DiffViewProvider.ts` -> `DiffViewProvider` # Diff 视图提供者
`src/integrations/editor/compare.ts` -> 比较工具

#### 4.2 终端

`src/integrations/terminal/TerminalRegistry.ts` -> `TerminalRegistry` # 终端注册表
`src/integrations/terminal/terminalTask.ts` -> `TerminalTask` # 终端任务

#### 4.3 主题

`src/integrations/theme/getTheme.ts` -> `getTheme()` # 获取主题
`src/integrations/theme/default-themes/` -> 默认主题文件

#### 4.4 工作区

`src/integrations/workspace/WorkspaceTracker.ts` -> `WorkspaceTracker` # 工作区追踪

#### 4.5 诊断

`src/integrations/diagnostics/index.ts` -> 诊断管理

#### 4.6 杂项

`src/integrations/misc/export-markdown.ts` -> `exportMarkdown()` # 导出 Markdown
`src/integrations/misc/extract-text.ts` -> `extractText()` # 提取文本
`src/integrations/misc/open-file.ts` -> `openFile()` # 打开文件
`src/integrations/misc/process-images.ts` -> `processImages()` # 处理图片
`src/integrations/misc/image-handler.ts` -> 图片处理器
`src/integrations/misc/indentation-reader.ts` -> `IndentationReader` # 缩进读取器
`src/integrations/misc/read-lines.ts` -> `readLines()` # 读取行

### 5. 服务层 (`src/services/`)

`src/services/SettingsStore.ts` -> `SettingsStore` # 设置存储
`src/services/mcp/McpHub.ts` -> `McpHub` # MCP 集线器
`src/services/mcp/McpServerManager.ts` -> `McpServerManager` # MCP 服务器管理
`src/services/code-index/manager.ts` -> `CodeIndexManager` # 代码索引管理
`src/services/skills/SkillsManager.ts` -> `SkillsManager` # 技能管理
`src/services/checkpoints/` -> 检查点服务
`src/services/command/` -> 命令服务
`src/services/glob/` -> 通配符匹配服务
  - `src/services/glob/constants.ts` -> `DEFAULT_DIRS_TO_IGNORE` # 默认排除目录列表（已标记 @deprecated）
  - `src/services/glob/ignore-config.ts` -> `ignore.json` 配置管理 # 用户可编辑的排除目录配置
    - 配置文件位置：`{globalStoragePath}/settings/ignore.json`
    - 配置格式：`{ "DIRS_TO_IGNORE": ["node_modules", ".git", ...] }`
    - `ensureIgnoreConfigExists()` -> 首次启动时若文件不存在则创建默认配置
    - `getDirsToIgnore()` -> 读取并解析配置文件
    - `getDirsToIgnoreCached()` -> 带缓存的异步读取（缓存于 `list-files.ts`）
    - `updateDirsToIgnore()` -> 更新配置文件并清除缓存
    - `buildRipgrepExcludeArgs()` -> 将目录列表转换为 ripgrep 排除参数
  - `src/services/glob/ignore-utils.ts` -> `isPathInIgnoredDirectory()` # 同步路径检查（用于 scanner.ts / file-watcher.ts）
    - 使用同步缓存 `_cachedDirsToIgnore`，由 `SettingsStore.loadAll()` 初始化
    - `initIgnoreUtilsCache()` -> 从 `ignore.json` 读取值填充同步缓存
  - `src/services/glob/list-files.ts` -> `listFiles()` # 文件列表扫描（用于代码索引）
    - 通过 `getDirsToIgnoreCached()` 获取排除目录列表
    - 将 `dirsToIgnore` 参数传递给所有内部函数（`listFilesWithRipgrep`、`listFilteredDirectories`、`getFirstLevelDirectories` 等）
  - 双缓存机制：
    - 异步缓存：`ignore-config.ts` 中的 `getDirsToIgnoreCached()`，供 `list-files.ts` 使用
    - 同步缓存：`ignore-utils.ts` 中的 `_cachedDirsToIgnore`，由 `SettingsStore.loadAll()` 初始化，供 `scanner.ts` 和 `file-watcher.ts` 使用
`src/services/ripgrep/` -> Ripgrep 集成服务
`src/services/roo-config/` -> Roo 配置服务
`src/services/search/` -> 搜索服务
`src/services/tree-sitter/` -> Tree-sitter 语法分析服务

### 6. 共享模块 (`src/shared/`)

`src/shared/package.ts` -> `Package` # 包信息
`src/shared/language.ts` -> `formatLanguage()` # 语言格式化
`src/shared/modes.ts` -> `getModeBySlug()` # 模式获取
`src/shared/parse-command.ts` -> `parseCommand()` # 命令解析
`src/shared/combineApiRequests.ts` -> `combineApiRequests()` # 合并 API 请求
`src/shared/combineCommandSequences.ts` -> `combineCommandSequences()` # 合并命令序列
`src/shared/getApiMetrics.ts` -> `getApiMetrics()` # API 指标
`src/shared/api.ts` -> API 工具函数
`src/shared/embeddingModels.ts` -> `EMBEDDING_MODEL_PROFILES` # 嵌入模型配置
`src/shared/WebviewMessage.ts` -> `ClineAskResponse` # Webview 消息类型
`src/shared/globalFileNames.ts` -> `GlobalFileNames` # 全局文件名
`src/shared/tools.ts` -> `ToolUse`, `ToolParamName` # 工具类型
`src/shared/ProfileValidator.ts` -> `ProfileValidator` # 配置验证

### 7. 类型定义 (`src/types/`)

`src/types/index.ts` -> 类型导出
`src/types/ClineProvider.ts` -> 提供者类型
`src/types/Task.ts` -> 任务类型
`src/types/Tool.ts` -> 工具类型
`src/types/Message.ts` -> 消息类型
`src/types/Mode.ts` -> 模式类型
`src/types/ProviderSettings.ts` -> 提供者设置类型

### 8. 工具函数 (`src/utils/`)

`src/utils/config.ts` -> 配置工具
`src/utils/storage.ts` -> 存储工具
`src/utils/path.ts` -> 路径工具 (含 String.prototype.toPosix)
`src/utils/pathUtils.ts` -> 路径实用工具
`src/utils/git.ts` -> Git 工具
`src/utils/shell.ts` -> Shell 工具
`src/utils/countTokens.ts` -> `countTokens()` # 计数 token
`src/utils/tiktoken.ts` -> TikToken 编码
`src/utils/mcp-name.ts` -> MCP 命名
`src/utils/tool-id.ts` -> 工具 ID
`src/utils/errors.ts` -> 错误处理
`src/utils/fs.ts` -> 文件系统
`src/utils/text-normalization.ts` -> 文本规范化
`src/utils/single-completion-handler.ts` -> 单一完成处理器
`src/utils/autoImportSettings.ts` -> 自动导入设置
`src/utils/migrateSettings.ts` -> 设置迁移
`src/utils/networkProxy.ts` -> `initializeNetworkProxy()` # 网络代理
`src/utils/focusPanel.ts` -> 面板聚焦
`src/utils/export.ts` -> 导出
`src/utils/tts.ts` -> 文本转语音
`src/utils/outputChannelLogger.ts` -> 输出通道日志

**日志:**
`src/utils/logging/index.ts` -> 日志汇总
`src/utils/logging/CompactLogger.ts` -> `CompactLogger` # 紧凑日志记录器
`src/utils/logging/CompactTransport.ts` -> `CompactTransport` # 紧凑传输
`src/utils/logging/types.ts` -> 日志类型

### 9. Webview UI (`webview-ui/src/`)

**入口:**
`webview-ui/src/index.tsx` -> 应用入口
`webview-ui/src/App.tsx` -> 根组件

**组件 - 聊天:**
`webview-ui/src/components/chat/` -> 聊天组件

**组件 - 历史:**
`webview-ui/src/components/history/HistoryView.tsx` -> `HistoryView` # 历史视图
`webview-ui/src/components/history/HistoryPreview.tsx` -> `HistoryPreview` # 历史预览
`webview-ui/src/components/history/TaskItem.tsx` -> `TaskItem` # 任务项
`webview-ui/src/components/history/useGroupedTasks.ts` -> `useGroupedTasks()` # 分组任务
`webview-ui/src/components/history/useTaskSearch.ts` -> `useTaskSearch()` # 搜索任务

**组件 - 设置:**
`webview-ui/src/components/settings/SettingsView.tsx` -> `SettingsView` # 设置视图
`webview-ui/src/components/settings/ApiOptions.tsx` -> `ApiOptions` # API 选项
`webview-ui/src/components/settings/ModelPicker.tsx` -> `ModelPicker` # 模型选择器

**组件 - 模式:**
`webview-ui/src/components/modes/ModesView.tsx` -> `ModesView` # 模式视图

**组件 - MCP:**
`webview-ui/src/components/mcp/McpView.tsx` -> `McpView` # MCP 视图

**组件 - 工作树:**
`webview-ui/src/components/worktrees/WorktreesView.tsx` -> `WorktreesView` # 工作树视图

**组件 - 欢迎:**
`webview-ui/src/components/welcome/WelcomeViewProvider.tsx` -> `WelcomeViewProvider` # 欢迎视图

**组件 - 通用:**
`webview-ui/src/components/common/` -> 通用组件
`webview-ui/src/components/ui/` -> UI 组件

**上下文:**
`webview-ui/src/context/ExtensionStateContext.tsx` -> `ExtensionStateContext` # 扩展状态上下文

**Hooks:**
`webview-ui/src/hooks/useAutoApprovalState.ts` -> `useAutoApprovalState()` # 自动审批状态
`webview-ui/src/hooks/useEscapeKey.ts` -> `useEscapeKey()` # 退出键处理

**国际化:**
`webview-ui/src/i18n/TranslationContext.tsx` -> `TranslationContext` # 翻译上下文

**工具:**
`webview-ui/src/utils/format.ts` -> 格式化工具
`webview-ui/src/utils/markdown.ts` -> Markdown 工具
`webview-ui/src/utils/model-utils.ts` -> 模型工具
`webview-ui/src/lib/utils.ts` -> 通用工具函数

**OAuth:**
`webview-ui/src/oauth/urls.ts` -> OAuth URL 处理

### 10. 共享包 (`packages/`)

#### 10.0 配置包

`packages/config-eslint/` -> ESLint 配置
`packages/config-typescript/` -> TypeScript 配置

#### 10.1 Types 包

`packages/types/src/index.ts` -> 类型导出
`packages/types/src/task.ts` -> 任务类型
`packages/types/src/tool.ts` -> 工具类型
`packages/types/src/message.ts` -> 消息类型
`packages/types/src/mode.ts` -> 模式类型
`packages/types/src/provider-settings.ts` -> 提供者设置
`packages/types/src/api.ts` -> API 类型
`packages/types/src/cli.ts` -> CLI 类型
`packages/types/src/mcp.ts` -> MCP 类型
`packages/types/src/skills.ts` -> 技能类型
`packages/types/src/worktree.ts` -> 工作树类型
`packages/types/src/events.ts` -> 事件类型

**提供商类型:**
`packages/types/src/providers/` -> 各提供商类型定义

#### 10.2 Core 包

`packages/core/src/index.ts` -> 核心导出
`packages/core/src/custom-tools/` -> 自定义工具
`packages/core/src/debug-log/` -> 调试日志
`packages/core/src/message-utils/` -> 消息工具
`packages/core/src/task-history/` -> 任务历史
`packages/core/src/worktree/` -> 工作树

#### 10.3 VSCode Shim 包

`packages/vscode-shim/src/index.ts` -> Shim 导出
`packages/vscode-shim/src/api/` -> VS Code API Mock
`packages/vscode-shim/src/classes/` -> VS Code 类 Mock
`packages/vscode-shim/src/context/ExtensionContext.ts` -> 扩展上下文 Mock
`packages/vscode-shim/src/storage/` -> 存储 Mock

#### 10.4 IPC 包

`packages/ipc/src/index.ts` -> IPC 导出
`packages/ipc/src/ipc-client.ts` -> IPC 客户端
`packages/ipc/src/ipc-server.ts` -> IPC 服务端

### 11. CLI 应用 (`apps/cli/`)

`apps/cli/src/index.ts` -> CLI 入口
`apps/cli/src/commands/cli/run.ts` -> `run()` # 运行命令
`apps/cli/src/commands/cli/list.ts` -> `list()` # 列表命令
`apps/cli/src/commands/cli/cancellation.ts` -> `cancellation()` # 取消命令

**UI:**
`apps/cli/src/ui/App.tsx` -> CLI UI 应用
`apps/cli/src/ui/components/` -> UI 组件

**SDK:**
`apps/cli/src/lib/sdk/client.ts` -> SDK 客户端
`apps/cli/src/lib/sdk/index.ts` -> SDK 导出

### 12. 扩展 API (`src/extension/api.ts`)

`src/extension/api.ts` -> `API` # 扩展 API 接口

---

## 核心数据流

```
用户输入 → ClineProvider → webviewMessageHandler → Task
                                        ↓
                                  工具执行 (Tools)
                                        ↓
                                  API 调用 (ApiHandler)
                                        ↓
                                  消息管理 (MessageManager)
                                        ↓
                                  上下文管理 (ContextManagement)
                                        ↓
                                  响应返回 → ClineProvider → Webview UI
```

## 设计模式

1. **委托模式 (Delegate Pattern)**: [`ClineProvider`](src/core/webview/ClineProvider.ts) 使用多个 Delegate 处理不同职责
2. **观察者模式 (Observer Pattern)**: [`Task`](src/core/task/Task.ts) 和 [`ClineProvider`](src/core/webview/ClineProvider.ts) 基于 EventEmitter
3. **策略模式 (Strategy Pattern)**: 工具系统通过 [`BaseTool`](src/core/tools/BaseTool.ts) 抽象实现不同工具策略
4. **单例模式**: [`McpHub`](src/services/mcp/McpHub.ts), [`SettingsStore`](src/services/SettingsStore.ts)

## 技术栈

- **语言**: TypeScript 5.8.3
- **运行时**: Node.js 20.19.2
- **包管理**: pnpm 10.8.1
- **构建**: Turbo + Esbuild
- **测试**: Vitest
- **Webview UI**: React + Vite
- **LLM SDK**: Anthropic SDK, OpenAI SDK, Google AI SDK

---

