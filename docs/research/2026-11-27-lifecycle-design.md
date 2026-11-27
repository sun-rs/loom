# loom 启动与恢复流程设计（草案，2026-11-27，Super）

起因：用户指出 `loom up` 应负责 Super 而不是全部项目，Super 自身由什么管理也未定，要先设计整个流程，再做 RESUME-1。

## 现状（a55fd9cc）
- `loom up --project DIR`：启动该项目的 loomd，建该项目的 Herdr 空间。只有项目层。
- Super：用户手动开的终端；`loom super --terminal ADDR` 只把它摆进 "Loom" 空间和全局 Status。loom 不记录 Super 用什么 CLI、哪个原生会话，Super 掉线无人知晓，也无法恢复。
- loomd 不是开机自启（用户 2026-11-20 决定暂不做 LaunchAgent）。
- 原生会话能否续接：Claude `--resume`（必须经 CCP）、Codex thread resume；agy、OpenCode 待核实。

## 分层与职责
| 层 | 是什么 | 由谁拉起 | 负责什么 |
| --- | --- | --- | --- |
| L0 机器 | Mac / Linux 主机 | 开机 | 无 |
| L1 全局 | `loom up`（不带 --project） | 用户 | 只负责 Super：全局登记表、"Loom" Herdr 空间、全局 Status、启动或续接 Super |
| L2 Super | 一个 CLI 会话（用户配置的 CLI/模型/effort；Claude 必须经 CCP） | L1 | 决定哪些项目要起、怎么恢复；对每个项目执行 L3 |
| L3 项目 | 每项目一个 loomd + Herdr 空间 | Super（`loom project up DIR`，即今天的 `loom up --project`） | 投递、换班、门禁、worker 生命周期 |
| L4 角色 | Leader、Auditor、worker | 项目 loomd | 干活 |

原则：每层只拉起下一层，不跨层。`loom up` 不碰任何项目；项目的恢复由 Super 判断后逐个执行，因为是否恢复、先后顺序、要不要换班，都属于判断。

## 全局登记表（L1 持有，新增）
`~/.loom/global.json`（路径待定）：
- Super：CLI、模型、effort、启动入口（Claude 为 CCP 入口）、原生会话标识、hc 地址、最后在线时间、交接单路径。
- 项目清单：目录、当前 release、最后在线时间、上次关闭方式（正常 / 异常）。
只记元数据，不存凭据。

## 流程
### 1. 正常启动
用户 `loom up` → L1 建 Loom 空间与全局 Status → 按登记表启动 Super（无记录时按用户配置新开）→ Super 读登记表和自己的交接单 → 用户告诉 Super 要做什么。

### 2. 电脑重启或 Super 掉线后恢复
用户 `loom up` → L1 发现 Super 记录存在 → 续接原 Super 会话（原生 resume；不能续接就新开，并以 Super 交接单开局）→ Super 运行 `loom recover --all-projects`，只读，列出每个项目"应在而不在"的会话 → Super 逐项目决定：`loom project up DIR` → `loom resume` Auditor → Leader → worker（错峰：每恢复一个高级角色，另一个已在线的负责核对首轮）。

### 3. 单个角色中断（电脑没重启）
项目 loomd 发现角色进程消失 → 通知 Super（不自动拉起；与"不做保活"一致）→ Super `loom resume <addr>`。

### 4. Super 交接单
Super 平时就维护一份交接单（在途项目、待决事项、最近裁决），保证原生会话无法续接时，新 Super 也能接上。

## 续接规则（参照 Orca，2026-11-27 调研：2026-11-27-orca-bot-session-continuity.md）
Orca 没有永远活着的 bot 会话：连续性靠外置状态 + 每次新对话注入带上限的"实况块"；原生续接只在"重启后接回被打断的回合"和"用户重新打开聊天"两处用，且默认关闭、只"提供续接"由用户决定。loom 照此：
1. **默认新开，提供续接**：`loom up` 发现上一个 Super 未正常结束且有原生会话 id 时，列出两个选项——"续接原会话（显示会话大小、上次活动时间）"与"新开并播种"，由用户选；可设 `super.resumeOnUp: true` 改为默认续接（默认 false）。正常结束的 Super 一律新开。
2. **新开时的播种**：注入一块"实况"（硬上限：12 行 / 1500 字），声明是数据不是指令；内容由全局登记表与各项目 `loom status` 生成：在途项目、待决事项、未恢复的会话、最近裁决指针。另读 Super 交接单（上限 60 行）。
3. **续接前验证**：CLI、模型、账号目录、启动入口（Claude 必须 CCP）与记录一致；会话 id 归属该 Super；等待就绪 120 秒，超时即放弃并改为新开，告诉用户原因。
4. **项目角色同理**：`loom recover` 只列出"可续接 / 需新开"，Super 逐个决定；被重启打断的在途 worker 一次性汇报给 Super（续接 / 交接单新开 / 标记丢失三选一），不自动重新排队。
5. **上下文增长**：压缩交给 CLI 自身；loom 只记录与展示。长会话的成本问题靠"默认新开 + 播种"规避，而不是硬性轮换阈值。

## 安全约束（贯穿各层）
- Claude 一律经 CCP 入口（用户 2026-11-27 裁决；CCP-ROUTE-1）。
- 恢复不改变网络出口与账号目录；恢复前核对 CLI、模型、账号目录与原记录一致，不一致就拒绝。
- `loom recover` 只读；`loom resume` 仅 Super 可执行。

## 用户决定（2026-11-27）
1. Super 由 `loom up` 一次性命令管理：不常驻、不自动拉起；Super 掉线时由用户再运行 `loom up` 续接（选项 A）。
2. 续接方式："可以用旧的，也可以拉新的，参考 orca bot 的逻辑维护，需要研究"——两种都支持，选择规则参照 Orca 的做法，规则见下文“续接规则”。
3. 项目层开机自启：未决，沿用暂不做。

## 原待决选项（存档）
1. Super 由什么管理：A `loom up` 是一次性命令，Super 掉线时由用户再运行 `loom up` 续接（不常驻，符合"不做保活"）；B 一个全局常驻进程看护 Super 并自动续接；C 交给 launchd 开机自启。
2. Super 掉线后的续接方式：优先续接原会话（上下文最全，但长会话贵）还是总是新开并读交接单（便宜，但丢细节）。
3. 项目层要不要也做成开机自启（之前定的是暂不做 LaunchAgent）。
