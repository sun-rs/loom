# 2026-08-31 补强后独立源码复审：A / E / F

## 范围与结论口径

本报告由此前官方冻结源码审计员独立复审本地实现，范围仅为 A 发布资产隔离、E Agent 动态引用、F Agent 工作区文件树。没有参与产品实现、操作浏览器、运行真实 Provider、安装 CLI、读取登录凭据、重启正式 daemon 或提交代码。新增内容仅为本报告和两个独立回归测试。其他审计员负责 B/C/D，真实浏览器和正式部署状态由主审给出，不能用本报告替代。

设计基线为 [补强方案](../product/2026-08-31-parity-reinforcement-plan.zh-CN.md)，官方行为证据为 [冻结源码合同](./2026-08-31-third-party-official-contract.zh-CN.md)。Kernel 仍是 Room/消息/ACL 的唯一 owner；AgentHost 仍是受限只读文件 owner。没有因追求 Raft UI 相似而复制中央服务器或扩大 Human 私聊权限。

**复审结果：本轮发现的 P1 导航反例与资源完整性反例已修并转绿；最后的 A 打包/安装/runner 接线 P2 也已闭环。15项独立检查与7项既有范围检查合计22项全部通过。** 没有发现可证实的 P0 权限退化。F 的复制错误隔离和失败刷新保留旧树已静态复核；仍不能代替浏览器/受控 Promise 的最终验收。本报告不将源码接线完成等同于真实安装、SEA签名发布或正式服务升级。

## 已确认成立的实现

| 范围 | 独立确认                                                                                   | 证据与限制                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | 普通与可信代理产品 Vite 构建输出分开，真实配置分别为 `dist/false` 与 `dist-workbench/true` | 测试动态加载真实 `vite.config.ts`，不是只验证独立 helper 的常量。未运行构建或改正式服务                                                                                                                                  |
| A    | 新启动的 source runner 只服务一次捕获后的 digest 目录                                      | `run-local-workbench.mjs` 与 `run-lan-workbench.mjs` 在启动前调用 `snapshotWorkbenchAssets`，hash 的 bytes 与写入的 bytes 相同；隔离测试证明后续源文件修改不改变旧目录，已存在快照被修改会拒绝复用                       |
| A    | 安装计划、runner、SEA 打包现已使用冻结输入                                                 | source installer 先 snapshot 再写 plan，runner 将 `RAH_WEB_STATIC_DIRECTORY` 作为 pinned source；SEA 在构建二进制前 snapshot 后始终复制该目录。真实 runner 入口在外部副作用被 mock 后执行，pinned/default 两种分支均通过 |
| E    | 消息 context 的 Room ACL 没有因短号解析放宽                                                | `global-discovery.ts` 先验证指定 Room membership，再按该 Room 查唯一前缀；完整 ID 命中其他 Room 拒绝；最终再次检查真实 Room membership                                                                                   |
| E    | 已有 Thread 的根消息和回复都能从短引用恢复 exact root                                      | 独立临时 DB 通过公开 Kernel 命令建立根消息/Thread/回复；根消息创建 Thread 前无 root，创建后根和回复均返回同一个真实 `rootMessageId`。这是本轮复审发现后主审修正的分支                                                    |
| E    | 多条引用共享 latest-intent，旧条目卸载不会取消新条目的请求                                 | `App` 持有共享 `createLatestRequest`；条目持有自己的 ticket 并只取消自己。helper 级实测验证 A→B、A 卸载、导航 epoch 改变和全局取消；React/browser 竞态仍由主审补证                                                       |
| E    | 当前 Workspace 过滤与大小写匹配已接上                                                      | `App` 传当前 Workspace 可见 Rooms；parser 不再将大小写不同的同名目录当唯一目标。未知和歧义保留文字，没有输出任意 URL                                                                                                     |
| F    | 正常成功刷新保留递归 Directory 与选择，隐藏开关重置选择/展开                               | root key 为 Agent+hidden，不含 revision；revision 只重新触发 root/已展开 child 读取。外层 AgentWorkspaceBrowser 按 Agent ID remount，不能误报跨 Agent 状态复用                                                           |
| F    | root/child/read 成功与失败均检查自己的 AbortSignal                                         | 刷新、文件切换、隐藏切换、后退和卸载使旧请求失效；比官方冻结版本的文件读竞态保护更强，应保留                                                                                                                             |
| F    | 选中粉20%+右2px粉、hover黑5%、256/160/600/8px 已在组件/CSS接线                             | 拖动使用 pointer capture，处理 up/cancel；另有键盘步进。compact 根据 container 宽度切 tree/preview，关闭预览回树。实际几何/触摸/溢出不是源码测试的证明范围                                                               |
| F    | 文件读取仍经原 AgentHost owner，未发现本轮扩权或越界退化                                   | application-service 在 I/O 前后复核管理权限/owner；AgentHost 拒绝路径越界、symlink/hardlink/special file，有限读取并核对最终 inode/dev。既有隔离安全测试通过                                                             |

## 初轮独立反例与修复状态

### P1：DM 和消息后缀被截断，会产生错误导航

官方 `RefText-DkZjWJTy.js` SHA-256 `8edbfa8dd09d7546cdf0988b5c02fbb71a29a44cac1606a476c2f59f0a13bc4e` 的 `M` `[213,851)`，以及 `index-BoAC7nSE.js` 的共享语法约 UTF-16 `302621`，允许 DM peer `C0=[\w.-]+`；官方消息短号为 6–8 hex。官方实际 DM 目录是否齐备仍未获得实页证明，不能把语法支持扩大成所有 DM 双边通过。

复审时本地 regex 的 DM 分支不含点号，且 suffix 是可选匹配：

- 可见目录只有 `Bob` 时，`dm:@Bob.Smith` 被渲染成指向 Bob 的 `dm:@Bob`，余下 `.Smith` 是纯文本。这不只是“未知引用没解析”，而是误指另一个人。
- 即使目录有 `Bob.Smith`，`dm:@Bob.Smith:1234abcd` 仍错误链接 Bob。
- `#design:abcdef`、`#design:x` 或超过本地上限的 suffix 可被截成可点击的频道/消息前缀。本地可以保留至少8字符的安全选择，但必须保留完整未知引用为文字，不能默默丢掉限定目标。

上述三条已写独立测试，先取得真实失败，主审修正后全部转绿。parser 现在完整消费 DM handle 与 suffix 后校验，未知/无效不会降级为短前缀链接。`peerHandle` 可与显示名不同；App 从当前 Workspace Agent catalog 按 direct participant ID 提供已知 handle。独立测试覆盖 `Architect` 显示名与 `coder.bot` handle 不同且大小写不同的情况。没有 canonical handle 的其他 DM 仍可能使用 display-name fallback，不能宣称所有 Human DM handle 都已接线。

修复中一度将点号也加入 Channel 名称，导致 `See #design.` 失去链接；独立新增反例后已收回为官方 Channel 无点号语法，同时保留 DM 点号，现已转绿。测试没有强迫 Kernel 放宽短号下限，也没有为了通过而赋予未授权目录可见性。

### P1：Thread root / 跨引用 / Workspace 的初始遗漏已修正

初始 `message.context` 只在目标消息自身带 `threadId` 时提供 root，引用根消息本身会遗漏已有 Thread。独立 DB 反例原先返回 exact message 但 root 为 undefined；主审增加以 rootMessageId 查已有 Thread 后，同一反例转绿。

初始每条引用分别持有 request gate，A 与 B 不会互相作废，先点击 A 后点 B 可被 A 晚返回覆盖；现在由 App 共享一次导航意图，条目仅取消自有 ticket。App 也补了当前 Workspace 目录过滤。这些修复与官方 stable target + epoch fence 的行为合同一致，不要求相同 HTTP 路径。

18:01后的最终复核中，`latest-request` 新增 `owns()` 只判断 action generation，供 Activity finally 清理自己的 pending；`current()` 仍同时要求 generation、未 abort、外部导航条件成立。独立测试在原22项中补入断言：epoch失效后 `current=false` 但同 action 可 `owns=true`，新 action / cancel 后旧 `owns=false`。已复读两个调用点都只在 finally 使用 owns，导航与错误仍检查 current，没有放宽过期导航权限。

### P2：资产 hash 不能替代资源完整性与统一发布接线

初轮 helper 仅检查 `index.html` 存在。临时目录的 index 明确引用不存在的 `/assets/missing.js`，仍成功返回 frozen release。独立测试先红，现已转绿：helper 校验 HTML 资源、CSS url，并在有 `.vite/manifest.json` 时验证所有 entry 的 file/css/assets 和 imports/dynamicImports 依赖。独立测试依次制造缺 lazy key、缺 JS、缺 CSS，均被拒绝，完整包成功。修复中绝对 URL 的 query/hash 曾误入 filename；新增反例先红后绿。

实际 Vite 与 snapshot 共同引用 `apps/web/build-output.ts`，真实 Vite 配置启用 manifest。17:09 复审留下的路径接线问题在17:17复读时已关闭：

- `build-local-core-product.mjs` 在 SEA/bundle 工作前获得 `const webBuildPath = await snapshotWorkbenchAssets(rootDirectory)`，随后校验和 `copyRegularTree` 始终使用这一个目录，不再在长时间构建结束后读取 mutable build。
- source installer 在构造 LaunchAgent plan 时 snapshot，并把该返回值作为 `staticDirectory`；LaunchAgent owner 原样保存为 `RAH_WEB_STATIC_DIRECTORY`。已有 packaged product 仍沿 `inspectLocalCoreProduct` 验证后使用其 product Web 路径，不被改为 source 路径。
- loopback 与 LAN runner 都把环境指定目录传给 snapshot 的 pinnedDirectory，随后只服务返回的 frozen directory。隔离 fixture 在原 build 已变化后仍从第一份 pinned release 返回第一份 release；新增真实 runner 入口测试验证传参顺序与最终 daemon 配置，不只查找源代码字符串。
- doctor 只读地选择显式绝对 `RAH_WEB_STATIC_DIRECTORY`，缺省才用共享 `webBuildOutput(true)`；不创建快照。没有显式 pinned 环境时，它检查当前产品 build 而非自动发现运行中进程的 release，因此 doctor 通过仍不是正式页面版本证据。

“冻结”应准确理解为 runner 不随之后构建换目录，不是防同一 OS 用户修改文件的安全边界；普通构建隔离也不会自动升级已运行的旧进程。manifest 是可选输入，旧的无 manifest 包只验证 HTML/CSS，不能宣称其 lazy JS 依赖都已闭合。snapshot 在采集 bytes 的阶段没有跨进程 build 锁；本轮验证的是冻结后的稳定性、已声明资源闭合和真实调用接线，不冒称已验证任意并发构建调度。

### P2：复制错误和文件读取错误不应共享状态

初轮第二次复制会清掉旧1500ms timer，但失败时仍保留旧成功提示；clipboard error 还与 read error 共用，复制失败会隐藏成功的文件预览。现已静态确认复制开始复位成功提示、清自有 copyError，成功1500ms归零，失败仅显示 header 的 copyError，不再改文件 read error。generation 和卸载清理仍保留。此修正避免了误清真实读取错误而留下无请求 loading，但复制时序/浏览器权限异常仍须主审实际验证。

### P2：刷新失败后重试会损失更深层展开

初轮 Directory 有 listing 时刷新失败仍 `if(error) return alert`，会卸载子 Directory；当前节点 expanded 尚在，更深层 expanded 被销毁。现已静态确认改为仅首次无 listing 失败时独占错误，有旧目录时保留 children 并附加“刷新失败，保留上次目录”重试提示。正常成功和旧目录失败重试均不再因 error 替换树。此项没有伪称已由源码字符串测试验证全部 React 时序。

## 不得过度宣称的差异与剩余证据

- 官方文件树有持久 width/hidden 偏好和 Markdown raw/preview 切换；本地本轮仍以内存 width/hidden 和文本 `<pre>` 为主，不能从尺寸/粉边已修推导完整文件树1:1。RAH 增强的 ARIA tree/方向键和路径防护应保留，并注明不是官方同一实现。
- 本地引用长度及 ID 字符集与官方6–8hex不同可以是明确产品选择；不可用“至少8字符的局部实现”宣称所有官方历史 shortid 已迁移。
- 本轮 E 没有证明任意 Task 文本都能变成 Task 目标。计划所说 Room/Task 目录不能只凭频道/消息 parser 已存在就打勾。
- 既有 `workspace-tree-contract.test.ts` 主要检查源码片段和 CSS，不是 root/child/read 受控 Promise、clipboard 失败/恢复、pointer cancel 或390px真实操作的证据。
- 无官方在线 Computer / 非空文件样本时，文件树最多标“官方源码合同 + 本地隔离/浏览器通过”，不能标双边现场通过。本人未操作浏览器，也未确认正式4173资产或登录页面已经切换。

## 可重复检查与最终结果

新增独立测试直接执行 exported owner，不用源码字符串证明行为：

```bash
node --test apps/web/test/parity-reinforcement-independent.test.ts packages/kernel/test/diagnostic-thread-context-independent.test.ts
```

初轮结果：9项，5通过/4失败。失败为 DM短前缀、完整点号DM、suffix降级、缺失asset。补入 canonical handle、频道句末点号、manifest lazy 依赖、URL query/hash 后为13项；新增后两处正常输入回归同样取得先红后绿。最后补入两个真实 runner 入口，各覆盖 pinned/default 分支，**独立检查最终15项全部通过**。runner 测试在子进程中用模块 mock 替换 snapshot 与 daemon，执行真实入口直到启动边界即中断，没有读写产品资产或启动 daemon。Thread 测试使用真实 Kernel 公共命令和临时 DB；shared gate 是 helper 级测试，不冒称跨整个页面的浏览器验收。

另实际执行：

```bash
node --test packages/agent-host/test/agent-workspace-browser.test.ts apps/web/test/workspace-tree-contract.test.ts apps/web/test/workbench-build-isolation.test.ts apps/web/test/diagnostic-references.test.ts
```

结果7项全部通过；其中 build-isolation 已新增 source 改变后 pinned release 不变的断言。初轮7项绿曾与独立4项红同时成立，说明原测试分母不足，不是两份报告互相矛盾。17:17将以上两组一起实际重跑，**22项全部通过**。测试使用临时文件/DB并在 finally 精确清理，没有调用 Provider。未运行完整 `npm run check`、真实 installer、SEA打包签名或正式部署门禁，不能借此报告声称它们已通过。

最终格式化后再次运行相同22项，并补入上述 owns/current 区别断言，仍为 **22/22通过**；下方字节身份已更新到18:01后的最终源码。

本报告的有限放行结论为：E 已修复本轮可复现错误导航，F 已修复已指出的状态污染/刷新结构问题，A 普通构建隔离及打包/安装/runner 冻结接线已闭环；保留上列显式产品差异与未执行浏览器/正式发布条件。不得将15个独立检查或合计22项测试作为全站覆盖率或完整发布门禁分母。

## 旧4173只恢复前端资产的风险评估（仅建议，未部署）

主审提出在没有 backend 重启授权时，只恢复旧进程所服务的 trusted 前端：先备份、保留旧 hashed chunks、最后发布 index。本审计没有执行恢复、安装或重启。只读 `ps` 确认 PID64735 仍是09:22启动的 `node scripts/run-local-workbench.mjs`；其 mutable `apps/web/dist` 来源由主审提供。该方案可作为临时、可回滚的前端入口恢复，但不能等同于新 backend 或本轮新 snapshot runner 上线。

显著风险与门槛：

1. **后续构建仍会再次覆盖旧入口。** 新普通 Vite build 合法写 `apps/web/dist`，而旧 PID 仍服务它。直到获授权切换 snapshot runner，普通 build / clean 必须避开此活目录，验证构建应使用显式临时 outDir 或 `dist-workbench`。仅本次 index-last 发布没有消除这条覆盖链。
2. **当前正文传输必须先核实。** 本轮采样 HEAD `/`、`/sw.js` 返回200，分别为 `no-store` / `no-cache`；但 Node GET 三个静态路径各2.5秒超时，另一次 GET 等待10秒未完成；curl GET `/` 也在3秒后以0 bytes、http_code000超时。没有读取或打印 cookie/token。该证据不证明根因，却足以否定仅凭HEAD/health宣布恢复成功；回填文件未必解决旧进程的流式发送问题。
3. **新旧前后端兼容不能由 trusted flag 推导。** 优先使用已知与旧 backend 兼容的 trusted 产物；若使用当前新前端，新API、summary/Computer字段与错误降级仍须在旧 backend 上只读核验。不得执行付费 Agent 或发送业务消息来做恢复冒烟。
4. **保持活目录连续存在。** 备份应在服务根之外，勿先移走整个 dist 造成请求空窗。新内容先在独立目录校验资源闭合；新增 hashed files 完整写入后再发布，已有同名hash文件必须字节一致。index 应由同目录临时文件原子 rename 最后替换，不要直接 truncate/copy 正在服务的 index；回滚优先恢复原 index，保留新旧 chunks。
5. **缓存和缺资源的200假象。** gateway 源码对不存在的静态文件回落 index，故必须验证真实 GET 的 MIME、正文/hash及 lazy chunks，而不只是200。当前工作区 SW 源码导航 network-first、script/style cache-first；若缺 chunk 时缓存了错误HTML，之后补文件也不必然自愈。活进程 SW 正文此次未能读完，因此不宣称已确认它与当前源码一致。恢复时不要顺手清所有浏览器数据或变更 SW/cache版本强行接管；保留旧chunk供已打开页面延迟加载。

最低可陈述的成功条件是：新入口完整GET正确HTML与资产、真实新页无PAT表单并进入工作台、控制台无模块加载错误、现有登录/Room只读数据可用；同时明确旧进程/PID和 backend 未升级。若正文GET仍不能完成，应暂停“恢复成功”结论并报告阻塞，不能以未经授权的重启代替诊断。

## 复审字节身份

2026-08-31 18:01 +08:00：最终格式化后重新计算以下全部字节身份，并重跑22项。工作树存在其他人的修改，不以 commit 或“干净工作树”代替身份。后续修复会改变这些 SHA，需对应复核，不能把本报告自动外推给新的构建。

| 文件                                                  | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/build-output.ts`                            | `9373a666e0a398b4868f6d1f4fb5f9cce53f3bbf01f9e93c8484209e2c6edc4e` |
| `apps/web/vite.config.ts`                             | `1447bc0a989409be9e34f79597c5748bf3475409fc3a6b69742f9dabc32dede7` |
| `scripts/workbench-web-assets.mjs`                    | `e87cf0109949e0f3a0927d44c95305c290633328a71b9eedd39a54be6e44f4f1` |
| `apps/web/src/diagnostic-references.ts`               | `62e2a046b01af4d87eb78d2bfc48456514fbde16c30b6ad098b49f3e5d13a7f9` |
| `apps/web/src/components/diagnostic-references.tsx`   | `815dd96be6f74f6bd1338875e73fa3fc36c4f1bad9e43ad7b770f699d006616a` |
| `apps/web/src/latest-request.ts`                      | `d047c8bce27dfa3c1c45ebecb00b38cad698a66ca4a6fb6f9424be4e13288fdb` |
| `packages/kernel/src/global-discovery.ts`             | `6359be3cb6d49a9f20e8265070affcaa73ec2258e9247879ed565a0254189069` |
| `apps/web/src/components/agent-workspace-browser.tsx` | `5677f2975d8cae36478f5651c3159d267776d0dd02f6d074de220354dde66dac` |
| `apps/web/src/agent-workspace.css`                    | `519257479235f099eeeb8d6db4592db0166e13f1341f4145b4b349d7c7bb537d` |
| `scripts/build-local-core-product.mjs`                | `e843a68667e6a17abe36b02a69d3afc8e5884b3e2cea0ee1e2fb3b3497f52cfa` |
| `scripts/install-macos-local-core.mjs`                | `59192b1b919e172126a4858b94877e1c611476e6b807c040e874b5500cff379a` |
| `scripts/run-local-workbench.mjs`                     | `49119177e5b05256d90c5886a74350be853153a8dfa1347c3c3d099f16543beb` |
| `scripts/run-lan-workbench.mjs`                       | `28462bc698507a3b3a0bf7d9150171b2d45dcd7667879d480f6dee5793451a9b` |
| `scripts/doctor-local-core.mjs`                       | `1fed152be2cb0a6789283ff895c8d2152307e29497bb468ca17660a240f8ae5f` |
