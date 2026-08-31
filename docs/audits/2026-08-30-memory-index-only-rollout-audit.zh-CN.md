# Memory 收紧方案：启动 index-only 落地与核验

日期：2026-08-30。范围：落实[已批准的收缩](./2026-08-30-memory-policy-retraction-audit.zh-CN.md)，不扩建记忆引擎，不修改 Raft UI 母版，不启用付费模型或自治维护。用户在线服务未重启、未部署；测试只使用临时状态与假 Provider。

## 1. 本轮结论

普通启动已不再枚举、读取或哈希全部 notes。索引完整读取、Agent owner、源文件校验及原始 Raft 提示词保留。新旧 Runtime revision 与真实子进程启动已核验；隔离浏览器完成频道和私聊的发送/回复、刷新及 Memory 查看。它们不是当前真实模型记忆质量或全部 Raft 生命周期收口的证明。

本轮只有三个生产文件变更：

- `packages/protocol/src/agent-memory.ts`：旧 v1 / 新 v2 收据严格联合；v2 显式 `coverage=index_only`，只能记录一个 `MEMORY.md`，禁止全树 `snapshotDigest` 字段。
- `packages/agent-host/src/agent-memory-materialization.ts`：启动只观察索引；保留显式 Human inspect/read；校验 prepared 路径必须对应同一个 Agent，保留私有根及索引文件校验；按需读取检查目标父目录，拒绝祖先符号链接。
- `packages/agent-host/src/agent-memory-activation.ts`：更新索引校验的证据注释，原始读取、BOM/UTF-8 和内容竞态验证逻辑不变。

不新增依赖、缓存、数据库、分类器、observer、模型调用、记忆写作策略、UI 行为或第二条执行路径。此前撤回的 RAH 记忆筛选与项目标签规则没有重新加入。

## 2. 收据与兼容规则

| 场景              | 当前行为                                                                                                      | 不作何种承诺                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 新 Run            | v2 `coverage=index_only`；索引 bytes/digest/mtime、完整 policy ref、Agent/Room/Activation/Run/Host 和可选来源 | 不证明 notes 已检查、模型已读或可恢复备份    |
| 同一 v2 Run 重试  | 索引内容、身份、完整策略引用和来源必须一致；返回原不可变收据                                                  | notes 的变化不属于本次索引证据覆盖范围       |
| 读取旧 v1         | 继续解析原全量 manifest/snapshotDigest，原文件不改写                                                          | 不将历史观察冒充当前状态                     |
| 重新物化旧 v1 Run | 明确拒绝，要求新 RunAttempt；不自动降级或重写旧记录                                                           | 不以索引局部检查声称全树重新验证             |
| Human 显式检查    | 沿用有界目录/文件检查与逐文件摘要                                                                             | 上限仍为 4,096 notes；并非大型目录管理已优化 |
| Human 读取文件    | 仅检查所选路径、祖先与内容，保留 UTF-8/1 MiB/变化检测                                                         | 同 UID/full-access 下不是 OS sandbox         |

旧 Run 的取消/终止恢复仍由既有生命周期与 terminal proof 处理，不依靠这份收据读取旧笔记。下一次正常工作使用新 RunAttempt；没有为兼容而新增补偿 Run 或第二套队列。

兼容方向是新代码读取旧 v1，不承诺旧二进制能读新 v2。下述已验证回退是当前 Host 下的 RuntimeProfile/prompt revision 回退，不是整套 Host 程序降级。记忆正文格式未改；未提供删除或转换收据的自动降级脚本。

变化属于 **RAH 收据及寻址适配**，不宣称 v2 来自 Raft 源码。Raft 记忆文件和形成规则未变。源索引仍要读取和计算摘要，不能把“零 notes I/O”扩大成“零启动 I/O”或固定 token 成本。

## 3. TDD 与运行验证

先运行新合同，得到 7 项预期失败：旧 schema 无 index-only、启动仍遍历 notes、旧收据可被当新检查重放、完整 policy ref 未比较，以及子进程仍得到全树收据。首轮另有一个测试 import 路径错误，修正后才将 `red-confirmed.log` 作为有效红灯证据。

实现后关键反例：

- 创建 4,100 份笔记，拦截启动链的目录枚举与内容流；启动与同 Run 重试均成功，目录枚举为 0、笔记内容打开为 0。笔记修改不再使索引收据失效。
- 索引变化、BOM/原文保持、非法 UTF-8、读取间变化、owner 路径串用、不安全根、Room/Activation/Host 漂移和完整 policy ref 变化均有检查。
- v1 收据可读、原字节不变；旧 Run 重验明确拒绝，新 Run 成功生成 v2。
- 启动不遍历无关 symlink；Human 选中 symlink 或包含 symlink 祖先的路径时明确拒绝。
- 显式 Human inspect 仍能列出真实 notes，不把后台记录缩小误做网页文件缺失。

运行证据：

- `local-workbench-bootstrap.test.ts` 使用临时 Registry，通过实际 `prepareLocalWorkbench` 导入旧/新 prompt，证明产生新 active revision、旧 manifest 原样保留；新 revision 不命中旧 ProviderSessionStore key，显式回退仍可选旧 revision。
- `agent-memory-runtime-continuity.test.ts` 经 `createConfiguredRuntime` 启动真实 Node 子进程，子进程计算收到的完整 Worker prompt 摘要，与当前生成器一致；跨 Room、Runtime/Profile、Registry 重建和 fallback 路径仍读同一 Agent 文件，不同 Agent 不共享默认路径。
- remote composition 真实子进程门禁继续通过；本轮未做远程机器、真实 CLI 模型或真实模型语义比较。

## 4. 真实浏览器范围

使用既有 `scripts/run-multi-agent-web-fixture.mjs`，独立临时目录与端口 `4188`，没有连接用户正式 Room、Agent 或凭据。通过 browser 技能操作 In-app Browser，而非 DOM 假实现。

已完成：

1. 1440×1000 频道发送普通消息，看到 Fake Alice canonical 回复，没有 Task 标识。
2. Agent → 工作区 → `MEMORY.md`，看到完整 122-byte seed、角色、Key Knowledge 与 Active Context。
3. Agent → 聊天 → 给 Alice 发消息，建立新 DM，发送并收到 Fake Alice 回复；刷新后 DM 与消息恢复。
4. 后台两份收据属于不同 Room/Run，同一 Agent owner 和索引摘要，均为 v2/index-only，均不含 snapshotDigest。
5. 390×844 使用成员列表 → Alice → 工作区，检查同一索引可读及布局。

Fake 回复清楚标为演示 Agent。测试没有让真实模型生成 notes，不能把 seed 或 echo 回复称为跨对话知识召回；也没有完成 Raft 官方页面的双边视觉复核。本轮未改变 UI/CSS。

## 5. 空闲维护与停止扩展

按批准的收紧方案，本轮继续保持自治 wake 未启用。Raft 的现有进程 notice / idle restartSnapshot / 普通 startAgent 是下一次适配评审基线。RAH 当前 Runtime start 与 Worker 权限依赖 Room-scoped Activation，不能直接伪造 Room 来启动维护，也不能把上游 managed-runner 权限机械替换成我们的 Worker 权限。

因此没有落地新维护上下文、五分钟执行上限、后台 observer 或额外调度服务。全局单 Agent lane、Human stop、terminal proof 与凭据释放继续保留。最小 cleaner 配置闭环、真实模型形成/纠错/跨 Room 召回和自治整理仍为未完成项；未来完整引入成熟体系需另行整体评估。

## 6. 可复现证据与门禁

日志根目录：`/tmp/rah-memory-index-only.sfe5Ww/`。

- `red-confirmed.log`：有效红灯，11 项中 4 通过、7 失败。
- `green.log`：上述 11 项全部通过。
- `runtime.log`：4 项 Registry/本地/远程实际子进程测试通过。
- `targeted-final.log`：20 项 protocol/materialization/coordinator 测试通过。
- `check.log`、`check-final.log`：保留两次全量失败记录；均为已有断言仍要求旧错误文案 `memory snapshot`，对应错误现在明确为 `memory index or identity`。只更新精确错误断言，未取消拒绝检查。
- 最终仓库门禁记录在 `check-verified.log`；格式检查另记 `format.log`。
- `browser-receipts.json`：两个浏览器触发的 Run 的去凭据收据摘要。
- `browser-memory-desktop.png`、`browser-memory-mobile.png`：当前测试页面截图。

最终 `npm run check` 通过：根工程/Web 类型检查通过，后端 **638 项中 636 通过、0 失败、2 项付费 gate 跳过**，Web **25/25 通过**。`npm run format:check` 与 `git diff --check` 均通过。浏览器控制台无 error，移动端 documentWidth 与 viewport 同为 390；已检查桌面/移动截图。临时浏览器标签和测试 daemon 已关闭，视口已恢复；未动用户在线服务、配置或记忆文件。未提交或推送代码。
