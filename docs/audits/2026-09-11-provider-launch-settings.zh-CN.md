# 管理页 Provider 启动参数

用户明确要求将 Guide 与 CLI 启动配置放在管理页，支持显示、编辑及恢复默认。本批按 Provider 分组，启动配置折叠展示。

## 来源与范围

Raft 1.0.18 的 `buildClaudeArgs`（提取 main.js 739264 行）按 Agent runtime configuration 组装模型、effort、mode、会话和通信参数；Multica `server/pkg/agent/claude.go` 的 `buildClaudeArgs` 同样由 adapter 组装。两者用于确认受管参数边界。本次新增全局附加参数编辑是用户明确提出的本地能力，不宣称 Raft 已有完全相同页面。

复用 `RuntimeGuideSettings` 作为唯一 daemon 设置 owner，保留原有 revision、原子文件写入和已认证 Human facade。`enabled` 与 `additionalArgs` 可独立更新；每家参数保存、刷新和重启后仍存在，空数组恢复默认。旧设置文件缺少参数时默认空数组，不改变既有 Guide。

四家内置 Driver 共享启动基础参数定义，页面展示相同基础参数，动态模型/会话/端口/prompt 仍由对应 Driver 追加。附加参数按 argv 数组传递，每行一个参数，不执行 shell。通信、模型、配置覆盖及自动记忆策略保留为受管项；非法受管参数在保存时拒绝。未知 CLI 参数可能被 CLI 自身拒绝，不能把通过长度/受管项校验描述为所有安装版本都支持。

每次 Activation 准备时从设置 owner 取不可变字符串快照，不热改已有进程；新 Run 和恢复失败后同 Run 的重试使用同一份启动快照。Agent 配置/角色/私有记忆 owner 不变。自定义 Runtime 不宣称支持这四家内置参数入口。

## 界面与验证

Provider 图标、Guide 复选框保持同列对齐；不支持 Guide 的标题行变灰，但其启动配置仍可编辑。复用已有 `.btn` 样式。配置展开包含基础命令、附加参数、保存、取消修改、恢复默认；不增加 Runtime 独立导航。

- 设置测试先失败（旧协议拒绝 additionalArgs），实现后通过，覆盖独立保存、重启、revision 冲突、受管参数拒绝和重置。
- Claude/Codex fixture 实际子进程记录 argv，验证附加参数与包含空格的值原样到达，恢复/回退时仍存在。四家公共组装测试验证 Provider 范围隔离；Kimi/OpenCode 现有会话与协议测试继续通过。
- Activation composition 测试验证每次 Run 重新读取设置快照。
- 桌面 1440×900 和 390×844 浏览器 fixture 通过编辑/保存/重置、Guide、禁用态与复选框对齐测试；新增折叠入口后的紧凑行上界明确更新为 100px，展开状态不受行高上界约束。
- 未运行付费模型；不宣称任意附加参数兼容所有 Provider 版本。

完整检查、冻结构建和正式重启在交付后另记。

## 正式交付

`npm run check` 退出 0：后端 1535 通过、17 跳过，Web 395 通过，登记表/协议/策略检查通过。期间 UI 规格门禁因并行工作一度报告未登记按钮变体，后续通过；未改动该工作来绕过门禁。最新规格脚本另复跑通过。最终类型检查、全仓格式检查与 diff 检查通过。

冻结 1437 个源码文件摘要在 `/tmp/rah-launch-source-manifest-final.json`，部署前核对无漂移。正式 Web build `d41dd5bdd7808af603b5442c17d0d32ea25b0a7fc79c3a67486722104c91072c`，闲置确认、备份验证和温和重启完成：PID 10822 → 20104，备份 `/Users/sun/.rah/backups/pre-restart-4433e5cb-c9dc-4922-9497-917f083448b5`。

正式 Chrome 通过真实 Human API 保存 Claude 的 `--verbose`、刷新、核对持久文件、恢复默认，以及 Guide 原偏好恢复；最终还原所有测试修改的配置值。1440×900 与 390×844 截图已人工查看，无横向溢出。截图位于 `/Users/sun/Code/reviews/rah_os/2026-09-11-provider-launch/`。未启动付费模型、未 commit/push；CLI 收到参数的证明来自子进程 fixture，不冒称任意用户参数真实模型验收。

## 后续修订：覆盖编辑取代附加参数

用户进一步要求可以删除或修改默认参数，并把默认与修改合并为单一编辑区。本次 `overrideArgs` 保存完整可编辑 argv，null 表示恢复默认；旧 additionalArgs 仅保留读取/迁移兼容。覆盖保存与恢复默认都会清空该 Provider 的旧 additions，Guide 单独更新不影响覆盖。

同一编辑区在“编辑 / 与默认对比”之间切换；差异用红色删除、绿色新增及 −/+ 符号表达。恢复默认先更新草稿，保存才持久化。普通选项可删改，例如 OpenCode 的 --pure；通信/托管模式所需参数保留，动态模型、会话与自动记忆策略仍由执行 owner 管理。因此这是受管启动参数的完整覆盖，不是任意 shell 命令或任意通信协议替换，也不声称 Raft 有同样配置页面。

新测试先验证旧代码无法覆盖，再覆盖持久化、重启读取、Guide 独立、重置不复活旧 additions、返回视图不可修改内部状态。共享组装测试确认 OpenCode 的 --pure 删除后不会重新追加；Claude 子进程 fixture 验证完整覆盖 argv 中包含空格的新增值原样到达，必需 --verbose 保留。编辑器测试覆盖引号、文字形式的 shell 字符与重复行 diff。本机 Claude 可执行文件实际含错误文案 `When using --print, --output-format=stream-json requires --verbose`，因此 --verbose 按协议前提保留，并补充禁止删除的失败测试；没有为了展示覆盖能力而允许无效启动。桌面/窄屏交互测试覆盖删除默认、红色差异、保存和重置；不以 UI 的变化代替 argv 验证。

覆盖版交付验证：`npm run check` 退出 0，后端 1537 通过 / 17 跳过，Web 397 通过；之后 Claude verbose 前提修正的 8 项受影响测试重新通过，最终 typecheck、format:check、diff 检查通过。Web build 为 `e12f662f514f21fdb4517db7c90d05fb2380ddcdd997f4a859f39469d5fc00a5`。正式服务闲置检查、备份校验和温和重启完成，PID 20104 → 30260，备份 `/Users/sun/.rah/backups/pre-restart-b0c4dcb6-46cf-4eb2-ae6f-69134f1e313b`。

正式 Chrome 在 1440×900、390×844 验证受管参数缺失被拒绝、OpenCode --pure 删除并保存、刷新读取覆盖、差异展示、恢复默认保存、Guide 独立开关及原偏好恢复。截图已人工检查，排除了过渡动画未结束的中间截图；证据目录为 `/Users/sun/Code/reviews/rah_os/2026-09-11-provider-override/`。所有测试设置已还原，未启动付费 Provider、未 commit/push。Claude UI 试点独立审查另见[审查结果](2026-09-11-ui-component-spec-independent-review.zh-CN.md)。

## 对比按钮简化

按用户要求删除“编辑”按钮，“与默认对比”以 aria-pressed 表达开关，再次点击回到编辑。保存后“取消修改”仍能执行的现象在 fixture 未复现，已添加保存成功后保存/取消均禁用的断言，并验证对比开关来回切换。此项不改变启动协议或设置存储。

本轮全仓 check 被另一项正在施工的 UI 规格门禁阻塞（新 ratchet 尚未在 HEAD 提交、匹配规则证据缺失），全仓 format 同样包含该施工文件的告警；没有修改其文件或提交基线来绕过。相较上轮已验收源码，生产路径仅本次编辑器组件变化，其余差异为试点规格/测试/门禁。单独执行相关浏览器、类型、Web 单元测试和生产构建；具体正式验收结果接续记录。

对比开关交付：类型检查、397 项 Web 测试、本次文件格式/diff 检查、桌面与窄屏 fixture 通过。正式备份 `/Users/sun/.rah/backups/pre-restart-29ed0f79-8d2e-4bba-a351-21837dbf768e` 校验后温和重启 PID 30260 → 36422，build `2b73e106c9eed63fb316d29c2d8f155b9aa77f6c72f0fd8d227e7f0153994a0b`。正式 Chrome 验证保存后取消禁用、编辑按钮不存在、对比第二次点击回编辑、持久化与恢复默认，桌面/窄屏截图已查看。证据位于 `/Users/sun/Code/reviews/rah_os/2026-09-11-launch-toggle/`。测试设置已恢复；全仓门禁阻塞仍保留，不宣称全仓通过，未 commit/push。

## Provider 折叠分组

顶部统一说明已移除。每组默认仅显示图标、名称与右侧箭头；展开后依次显示忙时投递开关、四行参数编辑器及操作栏。默认对比移至保存/取消/恢复默认同栏。折叠不卸载编辑器，未保存草稿继续保留；不支持 Guide 的行保留禁用方形复选框，CLI 编辑独立可用。

测试先确认旧页面仍有顶部说明而失败，实现后验证默认折叠、鼠标/Enter 展开、草稿保留、保存后禁用、对比切换、四行上限与桌面操作栏同排。截图发现共享 checkbox 类遗漏后另补失败测试（appearance auto → none），恢复共享样式后通过。类型检查和 397 项 Web 单元测试通过，本次文件格式/diff 检查及正式构建通过；全仓 check/format 仍因独立 UI 规格基线施工未通过，没有替该项提交或调整预算。

最终 build `e67dc8efee2966bfedb932ab5ef5f8effc65af3736e73ff0bebd9aaa1cf6e039`，备份 `/Users/sun/.rah/backups/pre-restart-dabcc42c-ae75-4a24-a9ef-fa870dc9738c` 校验后温和重启至 PID 39323。正式 Chrome 桌面/390×844 的保存、刷新、恢复、对比开关测试通过，截图已查看，测试设置还原。证据目录 `/Users/sun/Code/reviews/rah_os/2026-09-11-provider-collapse/`。未 commit/push 或使用付费模型。

## 管理页面精简

所有 Provider 标题恢复相同白底与原图标颜色；Guide 不可用状态仅作用于内部开关行。移除管理页纯说明的“当前成员权限”和 Agent 计数区，以及无内容需要分隔的底线。只移除呈现与无用入参，认证/授权与 Agent 配置 owner 不变。

配置作用域核实：`daemon-application.ts` 在 `stateDirectory/runtime-guide.json` 实例化唯一设置 owner；同一 daemon 的访问入口共享配置，不同计算机独立 daemon 尚无配置自动同步。本次没有将远程计算机扩展实现为隐含承诺。

旧样式先由浏览器断言确认失败（grayscale(1)），修改后白底一致、图标无灰度、两个说明区不存在及既有编辑/保存/恢复通过。类型检查、397 项 Web 单元测试、本次文件格式、diff 检查与正式构建通过。全仓 check/format 仍受独立 UI 规格基线未提交/摘要变化等施工状态阻塞，未替该项调整门禁。

最终 build `2314be8d0912198eeb297d42200f754204708e7f7588df0a662048029d04daf4`，备份 `/Users/sun/.rah/backups/pre-restart-49d4eeeb-7bfd-4a19-a7bc-4af681238e1f` 校验后温和重启至 PID 41654。正式 Chrome 桌面/390×844 验证通过，截图已查看，测试设置还原。证据 `/Users/sun/Code/reviews/rah_os/2026-09-11-management-clean/`。未 commit/push。

## 保存反馈与真实记忆参数展示

用户贴出的 `managed argument required: app-server` 属于被拒绝的保存，不能称已保存。页面现对 Codex/Kimi/OpenCode 首个必需子命令作中文预检，说明这里只填写参数、不包含 executable；缺失时保存禁用。删除取消按钮，保存仅对与已保存 argv 存在实际差异且语法有效的草稿可用。编辑与 diff 共用 100px 固定容器，两态实测宽高一致，不因文本少而缩小。

此前 UI 只显示 providerLaunchDefaults，遗漏 Driver 追加的记忆配置，属于展示不完整。现由 agent-host 的 providerLaunchPolicy 单点输出只读 args/environment，daemon 投影 managedLaunch，两个 Driver 同样消费该来源：Codex 三条 -c false 和 thread config 保持原语义；Claude 环境变量保持进程级，不写用户配置。页面明确显示“关闭 CLI 自动记忆 · 系统附加（只读）”，不是将环境变量伪装成 Claude CLI 参数。动态模型/会话仍按 Agent 配置附加，页面参数框不宣称是最终完整 shell 命令。

10 项执行器/设置测试通过，包含实际假 CLI 子进程收到记忆 flags/env 和 Codex thread 配置的既有断言；397 项 Web 测试、类型、全仓格式与 diff 检查通过。浏览器测试先复现 diff 58px 与编辑框 100px 的差异，修复后等宽等高，保存成功禁用、取消按钮不存在通过。全仓 check 仍受独立 sq-btn 基线门禁阻塞，未宣称通过。

正式 build `786b2a5dfc8d51bc456e65f0c5367ca18f74bc21b0eb36685fbd3b9afa2638b7`，备份 `/Users/sun/.rah/backups/pre-restart-1b54bff6-d5b0-47f1-adca-ebad9e4f48f8` 校验后温和重启至 PID 43971。正式 Chrome 验证 Codex 错误首参提示及禁用、两家记忆配置实显、等尺寸切换、保存与恢复，桌面/390×844 通过，截图已查看。证据 `/Users/sun/Code/reviews/rah_os/2026-09-11-launch-feedback/`，测试设置已恢复。无付费 CLI 测试，无 commit/push。

## Claude 必需参数预检

继续修复 Claude 删除 --verbose 后仍可提交的问题。此前首参预检显式跳过 Claude，后端正确拒绝但前端保存仍可点击。现在 agent-host 的 providerLaunchRequiredArgs 同时供后端覆盖验证及 daemon requiredArgs 投影使用，编辑器按该清单检查必需开关与值，不再维护遗漏 Claude 的客户端分支。无效草稿在发送请求前显示中文原因并禁用保存；恢复到已存内容也禁用。

11 项相关测试、398 项 Web 测试、类型、格式、diff 与正式构建通过；全仓 check 的独立 UI 规格基线阻塞仍存在。正式 build `2afc3493a91aea149c90aac83a9992f4566a26cd36ca957b057cde26ef9d5566`，备份 `/Users/sun/.rah/backups/pre-restart-9f97d4c8-bad9-4ee3-9ba3-82ecf8c90b2f` 校验后温和重启至 PID 45766。正式 Chrome 复现删除 --verbose，验证错误可见且保存 disabled，再恢复原值验证无变更 disabled；既有保存/刷新/对比/记忆展示与窄屏检查通过，测试设置已还原。截图 `/Users/sun/Code/reviews/rah_os/2026-09-11-required-args/claude-required-verbose.png` 已查看。无 commit/push。

## 恢复固定配置＋附加参数

用户决定停止全量覆盖编辑。现上方灰底灰字只读框列出基础参数、系统 -c 参数和环境变量，Claude 环境变量排在顶部以便直接看见；下方只编辑 additionalArgs。移除对比功能，保留保存与清空附加参数，清空为草稿动作，保存后生效。未变更或成功保存后按钮禁用。旧 override 文件保留兼容读取，提取附加部分供编辑；如果存在旧覆盖，明确提示保存后采用固定基础配置，不静默将它伪装为已迁移。

复用既有 daemon additionalArgs 写路径与受管参数验证，不改变执行器、CLI 自动记忆开关和 Guide 的语义。12 项相关测试、399 项 Web 测试、类型、格式和 diff 检查通过；正式构建完成，全仓 check 仍受独立 sq-btn 基线门禁阻塞。正式 Chrome 验证固定项/环境变量/-c 可见、附加参数保存刷新、清空保存、保存后禁用、桌面/390×844，截图已查看，测试偏好已还原。

最终 build `46b7940c45c718a467635b9f1c473067eaafa5c5f59d2c1710a548f0c6b0efbd`，备份 `/Users/sun/.rah/backups/pre-restart-84cb05c1-5851-4d84-b504-9cd788bf191c` 校验后温和重启至 PID 48493。证据 `/Users/sun/Code/reviews/rah_os/2026-09-11-fixed-additions/`。无 commit/push。
