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

### [2026-09-11] 原生工具调用解析器漏加工具分支导致 "missing nativeArgs" 错误

- symptom/intent: AI 调用 `delete_file` 工具时始终失败，返回 "Invalid tool call for 'delete_file': missing nativeArgs"，其他工具（read_file、edit_file 等）均正常。
- root cause/logic: 原生工具调用解析器（NativeToolCallParser）内部有两处按工具名 switch 构造类型化参数（nativeArgs）的逻辑：一处用于完整调用解析，一处用于流式部分解析。`delete_file` 在类型映射（NativeToolArgs）、工具 schema、工具组中均已注册，但这两处 switch 都缺少对应分支，落入 default 后 nativeArgs 保持 undefined，完整解析触发 fail-fast 抛错返回 null，最终在消息呈现层被判定为"已知工具但缺少 nativeArgs"而短路报错。
- defense/risk: 新增核心工具时必须同步修改解析器的两处 switch（完整解析 + 流式部分解析），并补充 parseToolCall / processStreamingChunk / finalizeStreamingToolCall 三层回归测试。排查此类"某工具单独失败"问题时，优先检查解析器 switch 是否覆盖该工具，而非工具实现本身。

---

### [2026-09-18] 终端工具中文输出乱码：cmd 内建命令恒输出 GBK，而 execa 默认按 UTF-8 解码

- symptom/intent: 模型调用终端工具执行含中文的命令时，回传的中文变成 `���`（U+FFFD）或 `Ŀ¼`、`ϵͳ` 这类拉丁/希腊字母乱码，而数字、英文等 ASCII 内容显示完全正常。
- root cause/logic: 三层叠加。① **execa 默认 `encoding: "utf8"`**（`execa/lib/arguments/options.js`），`subprocess.iterable()` 在交付前已把字节按 UTF-8 解码成字符串，`typeof chunk === "string"` 恒真——因此任何写在 iterable 之后的"按字节缓冲 + 回退解码"代码都是**死代码**，看起来已修实则从未执行。② **cmd.exe 内建命令（echo/dir 等）写管道时恒用系统 ANSI/OEM 码页（中文 Windows = cp936/GBK），`chcp 65001` 与 `chcp 936` 都改不动它**（实测 `echo 你好` 恒输出 `c4 e3 ba c3`），且 65001 码页下 cmd 另有已知的输出损坏 bug；而 Python 等外部程序按自身编码输出 UTF-8（本仓库已注入 `PYTHONUTF8=1`）。同一条流里 GBK 与 UTF-8 混用，任何单一固定解码器都必然出错——`c4 e3 ba c3` 被纯 UTF-8 解码正好得到 `���`，与现象完全吻合。③ GBK 中文字节有时**恰好是合法 UTF-8**（「目录」`c4 bf c2 bc`→`Ŀ¼`、「系统」`cf b5 cd b3`→`ϵͳ`），单纯"UTF-8 失败才回退 GBK"会被这类歧义击穿。
- defense/risk: ① 给 execa 显式传 **`encoding: "buffer"`**（属 execa `BINARY_ENCODINGS`），让 `iterable()` 交出原始 `Uint8Array`，把解码权收回自己手里；**不要**给命令加 `chcp 65001` 前缀（无效且有副作用），改为保留 `PYTHONUTF8`/`PYTHONIOENCODING`/`LANG`/`LC_ALL` 从源头统一外部程序输出编码。② 在 `decodeLine()` 中**按行（`\n` / 0x0A）边界**缓冲解码，避免多字节字符被 chunk 切断：先试 UTF-8（`fatal: true`），失败→GBK；若 UTF-8 成功但结果含 `\u0100-\u02ff`（拉丁扩展）、`\u0370-\u03ff`（希腊）、`\u0400-\u04ff`（西里尔）、`\ufffd` 或 PUA 的乱码特征**且不含任何 ASCII 字母**，则回退 GBK（ASCII 字母保护可避免误伤 `alpha=α beta=β` 这类真实希腊字母文本；已知局限：纯西里尔文整行会被误判）。③ 该路径仅在 `terminalShellIntegrationDisabled` 为 true 时启用（默认为 true，见 `ExecuteCommandTool.ts` 的 terminalKind 判定）；若走 VSCode 伪终端则由 VSCode 自行解码，属 `terminal.integrated.encoding` 配置问题，此时改回默认即可应用本修复。④ 改完必须用 **`node esbuild.mjs --production`** 重新打包才生效——漏掉 `--production` 会产出未压缩 dev 版，体积从约 14.8 MB 翻到约 31.8 MB；同时确认 `ExecaTerminalProcess.spec.ts` 仍通过（其 mock 的 `iterable()` 产出字符串，走 string 分支）。

---
### [2026-09-18] 代码库索引点【开始】无反应：delegate 重构删掉了 CodeIndexManager 的注册

- symptom/intent: 代码库索引弹窗（聊天输入框旁数据库图标 / IndexingStatusBadge）里点【开始】毫无反应，状态点与文案都不变，没有任何尝试连接 Qdrant 的迹象；同时"索引工作区路径"（自定义目标目录）输入框始终不出现。
- root cause/logic: 提交 a6fc0eedb（ClineProvider 拆分 delegate）把 getCurrentWorkspaceCodeIndexManager() 从 CodeIndexManager.getInstance(this.context) 改成 return this.codeIndexManager，却同时删掉了唯一给它赋值的 updateCodeIndexStatusSubscription() 方法体（连同 resolveWebviewView 里的调用点和 onDidChangeActiveTextEditor 监听），只在 ClineProviderBase 里留了一个签名不同的空壳 updateCodeIndexStatusSubscription(subscription)，全仓库无人调用。于是 provider.codeIndexManager 恒为 undefined：startIndexing / requestIndexingStatus 等一律走"没有打开工作区"分支，只回一条不带 workspaceEnabled 的 Error 状态；前端因 systemStatus===Error 仍显示【开始】按钮，再点还是同一条状态，看起来就是"没反应"。路径输入框的显示条件是 codebaseIndexConfig && indexingStatus.workspaceEnabled，workspaceEnabled 缺失使其恒为 false，故永不出现。另外 CodeIndexManager.isFeatureEnabled/isFeatureConfigured 由 configManager 派生，而 configManager 只在 initialize() 里创建——原代码先判断这两个 flag 再 initialize()，首次点击必然静默 return。
- defense/risk: ① 不要用字段缓存跨工作区单例，直接 CodeIndexManager.getInstance(this.context) 动态解析（实例按工作区文件夹路径 keyed，多根切换才正确）；② 恢复 onProgressUpdate -> indexingStatusUpdate 的进度订阅，这是 workspaceEnabled / autoEnableDefault / indexWorkspacePath 传达到前端的唯一通道，遗漏它会让整个弹窗"能点但没状态"；③ startIndexing / toggleWorkspaceIndexing 必须先 await manager.initialize() 再读 isFeatureEnabled / isFeatureConfigured；④ 所有分支结束都要 postMessageToWebview({type:"indexingStatusUpdate"})，避免再次出现零反馈；⑤ 改完必须 node esbuild.mjs --production 重打包（src/dist/extension.js 约 14.8MB），否则不生效。
- 涉及文件: src/core/webview/ClineProviderBase.ts、src/core/webview/delegates/WebviewLifecycleDelegate.ts、src/core/webview/handlers/codeIndexHandlers.ts
- 排查手法: 先 grep 目标 UI 文案定位组件，再顺着 postMessage type 找 extension 侧 handler，最后用 grep -o "codeIndexManager[^,;)]*" src/dist/extension.js 确认字段是否真的被赋值过；git show <commit> | grep -B45 -A25 "this.codeIndexManager = " 能直接看到重构删掉了哪段。

---

