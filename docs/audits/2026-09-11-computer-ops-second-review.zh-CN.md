# Computer 运维差异第二次核验

本次仅源码审查，没有修改产品、运行付费 CLI、重启或提交。核验范围是崩溃保护、日志轮转、启动 cleanup 和升级授权；不把旧报告的缺失声明当作事实。

上游证据：Raft Computer 1.0.18，`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。以下上游行号均指该文件。离线客户端源码不能证明中央服务器的鉴权策略。

## 1. 崩溃保护：存在层级差异，不能说 Raft 有而 RAH 全无

Raft `health.ts` **25633**：`recordCrash` 按 serverId 记录；25656 `isDegraded` 判断窗口；25768 的窗口为 60 秒；774944–774960 在 runner 退出时累计并在三次后停自动重启。这保护的是被 service 管理的 **per-server runner**。780890–780919 的 launchd plist 仍为 KeepAlive，没有相同的三次熔断逻辑。因此“Raft 的 launchd 自身有三次保护而 RAH 没有”不成立。

RAH `packages/agent-host/src/resident-runner-policy.ts:103` 已有同样 3 次 / 60 秒默认值，307–322 按退出更新状态；`resident-runner-supervisor.ts:94` 起也有持久恢复处理。但仓库对 `ResidentRunnerSupervisor` 的实例化检索仅发现测试，不能把这个独立库当作正式本地 Core 已接通的保护。`packages/daemon/src/macos-local-core-launch-agent.ts:771` 的正式 Core plist 为 KeepAlive，777 为 10 秒 throttle：节流不等于熔断。

裁决：**正式承载路径尚缺与 runner 层对应的可验收熔断接线；不是算法完全缺失，也不是 launchd 配置的直接逐字差异。** P1。先画明 launchd → supervisor → Core 的实际承载链，复用已有 resident policy，明确保护哪一层。测试需覆盖 60 秒内三次异常退出不再 spawn、正常退出不计入、手工恢复、宿主重启后仍保留窗口。不要给 launchd 新塞一套独立计数器，也不要用 Agent CLI 崩溃冒充 Core 崩溃。

## 2. 日志轮转：明确缺口，但 Raft 也不是持续按大小轮转

Raft 54581–54620：按 UTC 日期检查日志 mtime，跨日 rename，清理超过 14 天的 dated logs；775092 在打开 runner 日志 fd **之前**轮转，774801/56218 为 service 启动路径调用。它不是日志大小阈值，不是长期进程定时轮转保证。

RAH `macos-local-core-launch-agent.ts:785` 起固定输出 `core.stdout.log` / `core.stderr.log`；`macos-computer-launch-agent.ts` 也写固定日志路径。对 daemon / agent-host / scripts 的 rotate、rotation 检索没有对应轮转 owner。不能用有界诊断内存缓存或 HTTP tail 冒充磁盘文件保留策略。

裁决：**日志文件轮转缺口成立**，P1/P2，优先做启动前按日、14 天保留的源证据移植。owner 放 Computer 启动/日志管理层，不放 Kernel。必须考虑 launchd 已打开日志 fd 的时序：不能在子进程启动后简单 rename 就宣称后续写入新文件。先选能在 fd 打开前管理日志的启动边界；持续运行大小控制若另外增加，标为本地增强。测试覆盖同日不动、跨日重命名、14 天边界、非目标文件保留、symlink 拒绝、写入句柄确实指向当前文件。

## 3. cleanup 五类：不是五种用户工作区删除

Raft 54542 `runFullCleanup` 组合：

| 类别         | 上游实现                                                           | RAH 当前对应与裁决                                                                                                           |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 死 PID 文件  | 54352–54377，只删除进程已死的 service/attached runner pidfile      | 本地采用多种 socket/receipt 身份，不应按文件名数量要求复制；须按实际路径清单补核                                             |
| 孤儿子进程   | 54415–54440，限定 supervisor 的子进程、slock- 前缀、不在 known PID | `agent-host.ts:270` 起已有 durable runtime 恢复；不是 Computer 任意孤儿扫描，不能互相代替                                    |
| 断电半成品   | 54457 起，缺 attachment 的 server 子树移入 quarantine              | `computer-upgrade-startup-recovery.ts:62` 已有升级启动恢复，但并非同种 attachment 子树；本地没有远程 server 子树时不应制造它 |
| 临时升级文件 | 54485 起，upgrade-staging / snapshot 超 24 小时清除                | 未找到对应统一启动清理；应先列本地真实临时文件 owner 与活动事务引用，再补已过期孤立文件                                      |
| 失效锁       | 54521 起，proper-lockfile 超时锁重新取得再释放                     | 本地不能凭时间删除活跃 singleton/锁；应按现有锁 owner 的存活与身份规则恢复                                                   |

Raft 775002 的启动恢复会在父 CLI 持有 mutation lock 时 **跳过锁清理**。这也是移植不能忽略的条件。RAH `resident-runner-artifact-collector.ts:70–126` 已有保留活跃实例、终态证据、年龄、私有目录和 symlink 防护；不能宣称没有清理能力，也不能把这一个 collector 说成已覆盖全部五类。

裁决：**缺少一份正式启动路径的同类别清理覆盖与调用证据；局部能力已有**。P1 先做只读清单和故障夹具，按本地存在的资源逐类闭环。无需复制不存在的 server attachment 文件结构。清理必须保护 Room SQLite、私有 MEMORY、用户 cwd 和仍被升级事务引用的 artifact；不引入基于进程名字的广域杀进程。

## 4. `consented: true`：单行缺陷判断不成立

上游 781737–781752 `runKUpgradeCoordinator` 本身就调用 `upgradeTo(..., { consented: true, provenance, operation })`。RAH `k-carrier-computer-upgrade.ts:160` 是相同 coordinator 边界；`packages/k-carrier/src/upgrade/drive.ts:101–106` 的 consent 语义是跳过 notify-only / confirm 等待，不是证明最外层用户授权。

RAH 当前还有 receipt 匹配和版本校验（同文件 134–153）、owner-private state（133）、Computer session 认证/能力检查（`computer-application-service.ts:280` 起 claimOperation），以及 coordinator request store。它们不能单独证明 Human 升级请求已授权，但也不能因 consent 为常量就判越权。对 `ComputerOperationStore.request` 的调用检索目前只找到测试生产者，未确认从网页 Human 写请求直到 operation 入账的正式入口。

裁决：**“consented:true 绕过授权”证据不足，且与 Raft 同行代码一致；不应为此改为 false。** 应把 Human/本地 operator 入口 → 已认证操作记录 → 单次 coordinator assignment → consented 作为完整授权链核验。如果当前发行路径根本没有公开的升级生产入口，则记入口/发行接线待完成，不把不存在的远程 attack path 宣称已复现。P1 验证未认证、Agent、伪造目标版本/operationId 被拒绝；合法明确请求只应用一次，重放同 receipt 不重复升级。不同的自动更新策略另行判定，不能直接归咎于 coordinator 的布尔值。

## 建议分批

1. 先核 formal 启动链与资源清单，补 runner 熔断接线的失败测试；此批不改 Agent 投递 owner。
2. 日志轮转可独立并行，但启动脚本的最终接线须由一个 owner 合并，避免和第 1 批相互覆盖。
3. cleanup 按真实资源逐类补齐，不能批量“清理旧目录”。
4. 升级先追明生产入口授权链；未证明缺陷前不改 `consented`。

本报告为源码核验，不等于运行、断电、登录重启或线上 Raft 双边验收通过。

## 日志轮转最小闭环设计补核

以下仅设计，尚未实施或验收。日志并行施工可以独立于提示词；但不应在本轮全量检查时更改启动脚本。

### 真实句柄关系

1. **当前正式 workbench**：`scripts/restart-local-workbench.mjs:163–168` spawn `run-local-workbench.mjs` 且 `stdio: "inherit"`。子进程继承调用者的 fd，不一定指向产品日志目录，可能是终端或工具临时日志。`scripts/run-local-workbench.mjs:35` 在当前进程启动 Core，43–46 仅写启动信息，没有一个可轮转的产品 logger。不能在这个子进程中 rename 任意 `core.stdout.log` 就宣称正式 workbench 已覆盖。
2. **可安装的 local Core launchd 路径**：`macos-local-core-launch-agent.ts:785–788` 把 stdout/stderr 交给 launchd 路径。launchd 在执行程序前已经打开这些文件。程序内 rename 不改变 fd 指向；继续写入的是归档 inode。
3. **可安装的 Computer**：`macos-computer-launch-agent.ts:125–127` 配置 `computer.stdout.log` / `computer.stderr.log`，接收的是 supervisor 本身输出。`node-k-carrier-computer-supervisor-process.ts:151` 创建受控 launcher；`node-k-carrier-supervised-service-launcher.ts:84` 对真正 service 的 fd1/fd2 使用 **ignore**，fd3 配置、fd4 生命周期 pipe。另一条 slot launcher（`node-k-carrier-slot-service-launcher.ts:84`）也 ignore stdout/stderr。因此当前不能说 Computer service 的原始日志已进入 plist 日志。此处需要同时补“接收”和“轮转”，避免只修空文件。

### 可独立实施范围

**共享 owner**：新增仅管理 owner-private 日志文件的 `agent-host` 日志模块，由 Node 启动边界调用；不创建 Kernel 表、不修改业务通知或 Agent 状态。采用 Raft 的 UTC 日期、跨日 rename、14 天 dated-file retention，是结构移植。与上游的本地差别明确记录为：拒绝符号链接/非普通文件、同日归档碰撞处理、防止多 writer 同时管理同一 active 文件。

**A. operator 启停日志（先做）**：为 workbench 的受控首次启动与 restart 统一一个“取得启动互斥 → 确认旧写进程已退出 → rotate → open append → spawn 传入 fd → 父关闭自己的 fd 引用”的启动 helper。沿用当前 successor PID，不加常驻 wrapper，不破坏 restart 的进程身份校验。必须连首次启动入口一起收口；只修改 restart 就只能声明 restart 路径覆盖。交互终端输出可以保留为启动状态信息；daemon 原始 stdout/stderr进入明确产品文件。不能轮转继承来的任意终端/临时日志。

对已有 launchd 日志，最小安全支持是**显式 operator 停止/bootout 完成后、bootstrap 前轮转**。自动 KeepAlive 重启或跨日常驻情况下无法保证 writer 已关闭，先明确不覆盖，不从正在启动的子进程做 rename。如果目标要求自动路径也全部有界，应进入 B，不把 A 宣称完成该范围。

**B. 已安装 Computer service 日志（独立批次）**：可以复用已有 `NodeKCarrierSupervisedServiceLauncher` 父 supervisor；它已经拥有子进程生命周期，能在前一 service 真正退出之后、下一次 spawn 前准备日志 fd。最小办法是把原来的 `ignore` 改为经过检查且轮转后的 stdout/stderr fd，保持 fd3/fd4 不变；不要增加无界 pipe 缓冲，不要把 lifecycle pipe 当日志。service 与 supervisor 必须用不同的 active 文件名，避免 launchd 与父 launcher 两个 writer 管同一个文件。

此办法与 Raft runner “启动前轮转”一致，涵盖 service 重启/升级 spawn；**不涵盖一个 service 连续运行多天不停机时的每日轮转，也不涵盖 supervisor 自身 stdout/stderr自动重启轮转**。后两者若需实现，需要受控 logger/pipe sink 并由唯一 writer 关闭重开；这属于更大批次，不要为了追求持续轮转把所有 process.stdout 全局猴子补丁或 copytruncate 引进来。

未发现可直接复用的通用磁盘 rotating logger。`process-supervisor.mjs:303–304` 是 Agent Runtime 诊断转发，不是 Computer service logger，不能拿来当已有日志 owner。bootstrap 之前发生的 supervisor 错误仍依赖 launchd 日志，明确交由 A 的停机维护范围。

### 必要测试与验收

- 临时目录 + 注入 UTC 时钟：同日保留、跨日归档、14 天边界、非目标文件不删；路径碰撞、symlink、权限拒绝保持原日志可读。
- 真实廉价 Node 子进程：写 marker A → 等待关闭 → rotate/open → 新子进程写 marker B；断言 A 只在归档、B 只在 active，且没有写入已删除 inode。不是只断言 rename 被调用。
- active writer / 启动互斥存在时拒绝轮转；同时两个启动请求只能一个取得日志所有权；spawn 失败、异常退出、父进程关闭均释放 fd。
- workbench：受控首次启动、显式 restart 均用同一 helper，旧进程 drain 顺序与备份不变；页面/Room 历史仍能恢复。无需付费模型。
- Computer：验证 fd1/fd2 真正写入两份日志，fd3 配置和 fd4 EOF 终止机制不变；stable/experiment 切换后新 writer 写 active；一轮 service 的失败日志不会被丢弃。
- launchd 支持只在真实 operator bootout/bootstrap gate 通过后宣布；普通模拟 spawn 测试不能证明 launchd 文件句柄释放。

推荐先实施 A 的 workbench 单一路径闭环，再实施 B 的 service 日志接收与启动轮转。launchd 自动重启的 supervisor 日志、长时间不重启的持续轮转作为显式剩余范围；这比在所有入口重复调用 `rename()` 更接近 Raft 的真实设计边界。
