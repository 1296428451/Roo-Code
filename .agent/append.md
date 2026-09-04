# Roo-Code 踩坑记忆

---

### [2026-04-05] dotenvx 加载不存在的 .env 文件会输出噪音错误

- symptom/intent: 扩展启动时加载 `.env` 环境变量文件，但生产构建中该文件不存在，直接调用 `dotenvx.config()` 会在控制台输出 `[MISSING_ENV_FILE]` 噪音错误。
- root cause/logic: `@dotenvx/dotenvx` 库在传入的文件路径不存在时会主动输出错误日志，即使代码逻辑上该文件就是可选的。
- defense/risk: 在调用 `dotenvx.config()` 前先用 `fs.existsSync()` 检查文件是否存在，仅当文件存在时才加载。同时用 try-catch 包裹，确保环境变量加载失败不会阻塞扩展激活。

---

### [2026-04-05] 流式工具调用中 partial-json 截断导致 UI 显示不完整路径

- symptom/intent: 在使用原生工具调用的流式传输时，AI 返回的工具参数（如文件路径）在部分 chunk 边界处被截断，导致 UI 上显示不完整的中间状态，甚至触发错误的工具执行。
- root cause/logic: `partial-json` 库在 chunk 边界恰好落在字符串值中间时，会返回被截断的字符串。如果每次 `handlePartial()` 都基于当前截断值更新 UI 或执行逻辑，会导致闪烁和错误行为。
- defense/risk: 在 `BaseTool` 中实现 `hasPathStabilized()` 方法，通过 `lastSeenPartialPath` 追踪上一次的值，只有当连续两次 `handlePartial()` 收到相同的 path 值时才认为已稳定，此时才更新 UI。执行结束后调用 `resetPartialState()` 清除状态。新增工具必须遵循此模式，否则可能引入流式显示 bug。

---

### [2026-04-05] 上下文压缩时 tool_use/tool_result 块必须转为文本才能被 LLM 理解

- symptom/intent: 在压缩（condense）对话上下文以节省 token 时，如果直接将 `tool_use` 和 `tool_result` 块原样保留，LLM 无法在没有 tools schema 的情况下理解这些结构化块的内容，导致压缩后对话语义丢失。
- root cause/logic: Anthropic API 的 `tool_use` 和 `tool_result` 是结构化块，需要配套的 `tools` 参数才能被正确解析。但在上下文压缩场景中，压缩后的消息会作为历史上下文发送给 LLM，此时不再携带完整的 tools 定义。
- defense/risk: 在 `condense/index.ts` 中实现 `toolUseToText()` 和 `toolResultToText()` 函数，将结构化块转换为人类可读的文本表示（如 `[Tool Use: read_file]\npath: xxx`），使压缩后的对话在不依赖 tools schema 的情况下仍可被 LLM 理解。这是上下文管理中的关键转换逻辑。

---

### [2026-04-05] 架构地图维护：工具文件名与目录结构变更

- symptom/intent: 在维护 `.agent/architecture.md` 架构地图时，发现部分工具文件名与实际代码不一致，且缺少部分新增的辅助文件和目录。
- root cause/logic: 项目迭代过程中，部分工具文件被重命名（如 `SearchReplaceTool.ts` → `SearchAndReplaceTool.ts`），且新增了 `helpers/imageHelpers.ts`、`apply-patch/seek-sequence.ts` 等辅助文件，以及 `services/command/`、`services/glob/`、`services/ripgrep/`、`services/roo-config/`、`services/search/`、`services/tree-sitter/` 等新服务模块。
- defense/risk: 在更新架构地图时，应定期对照实际目录结构（`list_files`）验证文件名的准确性，确保新增的模块和文件被及时记录。建议每次项目结构发生重大变化时更新 `architecture.md`。

---

### [2026-04-05] 异步配置读取需要双缓存机制

- symptom/intent: `list-files.ts` 是异步的，`ignore-utils.ts` 是同步的，两者都需要 `DIRS_TO_IGNORE` 配置，但无法在同步函数中调用异步 API
- root cause/logic: 跨模块共享配置时，需要区分异步/同步场景。`ignore-config.ts` 的 `getDirsToIgnoreCached()` 提供异步缓存，`ignore-utils.ts` 的 `_cachedDirsToIgnore` 提供同步缓存
- defense/risk: 双缓存机制 — 异步缓存供 `list-files.ts` 使用，同步缓存由 `SettingsStore.loadAll()` 初始化后供 `scanner.ts` 和 `file-watcher.ts` 使用

---
