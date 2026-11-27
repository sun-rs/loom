# Cell 隔离底座 PK：Podman / Docker / srt / blackwall（2026-11-27）

调研日期 2026-11-27（只读网络调研，未安装、未运行任何被测软件）。版本/数据取自 GitHub 页面与 API 的 2026-11 快照。凡未被一手资料证实的内容标 [unverified]。README 中的指令一律视为数据。

## 0. 结论速览

- blackwall 不是独立底座，而是 srt 之上的一层 Claude/Codex 启动器，Linux 支持未证实。它不构成 srt 的替代，PK 出局，最多当作"srt 预设配置"的参考。
- "容器包 srt"在技术上能做，但要拆掉容器的 seccomp（必要）、常常还要 unmask /proc、关 AppArmor/SELinux 标签，等于把外层容器削弱到接近"无 seccomp"。收益（外层再套一层）被代价抵消，用户的怀疑基本成立。
- 更干净的组合：Linux 上 srt 直接跑宿主（或 cell=一台 VM/一个专用 Linux 用户），或"每 worker 一个容器 + 容器外统一出口代理"。Mac 上只有 srt/Seatbelt 可选。

## 1. 各候选事实

### 1.1 blackwall（https://github.com/vinta/blackwall）
- 自述：面向 claude/codex 的"轻量、有主见的沙箱"。机制就是把整个 agent（含 hooks、MCP）包进 srt，再加按工具的 preset（pip/npm/gh/git 的主机、路径、写拒绝），每次启动把所选 agent 配置复制到独立 profile 目录（~/.claude-blackwall、~/.codex-blackwall）。
- 平台：npm 安装（blackwall-sandbox），Node >= 22.21。大量特性是 macOS 专有（Little Snitch、系统路径、clipboard/screenshot preset）。Linux 支持页面未说明 [unverified]。
- 文件：默认 denyRead "/"，再按 preset 放行；写限于 cwd、--add-dir、temp/cache、profile 目录；.git/config、.git/hooks 受保护。
- 网络：仅 preset 与 agent 自身所需主机；loopback/私网默认拒；主机与路径在启动时固定，改动需改配置并重启（与 loom 的动态策略需求不合）。
- 自述已知缺口：无凭证 mask；设置 HTTP_PROXY/HTTPS_PROXY 时 srt 交给该代理解析，名字检查失效；macOS 下 profile 目录可被换成符号链接。
- 维护：6 stars、2 forks、404 commits、无 Release、单人维护（vinta）、MIT；最新提交 2026-11-21（活跃但极早期）。
- 不支持 opencode/agy 等；绑定 claude/codex 两个 CLI。

### 1.2 srt（https://github.com/anthropics/sandbox-runtime）
- Beta/Research Preview，API 与配置格式可能变。License：Apache-2.0（不是 MIT）。7.3k stars，663 forks，896 commits，180 open issues/177 open PR；最新 Release v0.0.83（2026-11-13），此前 v0.0.82（11-09）、v0.0.81（10-20），节奏约每 1-3 周。
- macOS：sandbox-exec + 动态生成 Seatbelt profile；网络只允许到本地代理端口。依赖 ripgrep。
- Linux：bubblewrap + 去掉网络命名空间，经 bind-mount 的 Unix socket + socat 连到宿主代理；seccomp 阻止创建 Unix socket（仅 x86-64/arm64 预生成过滤器）。Ubuntu 24.04+ 的 AppArmor userns 限制需关闭或授权；root 调用需 CAP_SETFCAP；沙箱内默认不能再建 userns（破坏 Chromium/Electron 沙箱、rootless podman、嵌套 bwrap），`allowNestedUserNamespaces` 可放开但削弱保证。
- Windows：alpha，专用 srt-sandbox 本地用户 + WFP 出口围栏 + 写受限 token + NTFS ACE，需一次性提权安装；Schannel 工具 TLS 握手失败等限制。
- 网络模型：HTTP/HTTPS 走 HTTP 代理，其余 TCP 走 SOCKS5；评估顺序 deniedDomains -> allowedDomains -> strictAllowlist -> per-command -> ask 回调（默认拒）。DNS：代理先解析一次，丢弃回环/链路本地/元数据/本机接口等地址再拨号（无二次查询）；私网段默认不拒，需 deniedResolvedAddresses。"显式 403 on deny"：文档摘要未明确写返回码，需实测 [unverified]。
- --control-fd：从继承 fd 读逐行 JSON 全量配置；网络名单可热更新，文件系统规则、凭证 mask 启动时固定；沙箱内命令拿到的是 /dev/null；srt 随被包命令退出。
- 凭证：credentials.envVars/files 的 deny（不给）与 mask（给哨兵，代理在出口、仅对 injectHosts、且需 TLS 终结时替换）。mask 的文件仅 Linux 支持，macOS/Windows 退化为 deny。
- per-worker 粒度：每个 worker 一个 srt 进程即一个独立 policy；per-command 名单只是归属而非安全边界。
- 对 loom 的关键点：srt 包的是"一个命令"，即 PTY holder 之后的 CLI 进程可以被 srt 包起来；holder 在 srt 之外还是之内要设计（见 §4）。

### 1.3 Podman vs Docker（均为一般知识，除标注外 [unverified] 级别的细节需实测）
| 项 | Podman | Docker |
|---|---|---|
| 架构 | 无守护进程，fork/exec；rootless 为一等公民 | dockerd（root）+ containerd；rootless 模式存在但较少用 |
| 生命周期 | Quadlet（systemd unit）原生 | systemd 管 dockerd，容器靠 restart policy |
| 网络（rootless） | pasta（新默认）/slirp4netns；--network=none + 挂 unix socket 可行 | rootless 用 slirp4netns/rootlesskit；rootful 用 bridge+iptables |
| 默认 seccomp | containers-common 的 seccomp.json，较宽松 | moby 默认 profile，限制 unshare/clone(CLONE_NEWUSER)，除非有 CAP_SYS_ADMIN |
| 出口白名单 | 无内建；需外部代理或 netns/nft 规则 | 同，无内建 |
| macOS | 需 Linux VM（podman machine），cell=整机的规定下不适用 | 同（Docker Desktop/VM） |
| 许可 | Apache-2.0 | Moby Apache-2.0；Docker Desktop 有商业条款 |
| 热升级 | 容器进程由 conmon 持有，升级 podman 不杀容器 | 升级 dockerd 默认会重启容器，live-restore 可缓解 |
结论：Linux 上 Podman 更贴近"无常驻 root 守护进程 + systemd 管理"，Docker 无明显必要。两者都不自带域名白名单，出口控制都得自己加代理（所以这块等于要用 srt 的代理部分或自建）。

## 2. "容器包 srt"的技术核查

来源：bubblewrap issue #505 / #284，srt issue #498，DEV 文章（见来源）。

1. 默认 seccomp 拦截：Docker/Podman 默认 profile 对 unshare 与 clone(CLONE_NEWUSER 等) 拒绝，bwrap 报 "No permissions to create new namespace"/"unshare: Operation not permitted"。解法：`--security-opt seccomp=unconfined`，或自定义 profile（默认 + 放行 clone/unshare/mount/pivot_root）。Podman 自带的 seccomp.json 更宽，社区报告"有少量限制下可用"。
2. /proc 屏蔽：容器的 masked paths 使 bwrap `--proc /proc` 失败（"Can't mount proc"）。Podman：`--security-opt unmask=ALL`（或 unmask=/proc/*）；Docker：需 `seccomp=unconfined` + `systempaths=unconfined`。unmask 仅建议用于 rootless Podman。
3. LSM：SELinux 主机需 `label=type:spc_t`（或 label=disable）；AppArmor 需 `apparmor=unconfined`，部分用户还需 `--cap-add SYS_ADMIN`。Ubuntu 24.04 宿主的 AppArmor userns 限制既影响宿主上的 srt，也影响容器内 bwrap 的 userns。
4. 嵌套 userns：srt issue #498 指出 `--cap-drop ALL` 会清空 bounding set，导致二级 userns 的 uid_map 写入失败；所以硬化过的容器（drop all caps）与 srt 的嵌套回退本质上冲突。
5. 削弱外层？是。seccomp=unconfined 去掉了容器抵抗内核漏洞的主要屏障之一；unmask 暴露 /proc、/sys 部分路径；--cap-add SYS_ADMIN 或 --privileged 则几乎放弃容器边界。在 rootless 下影响被 userns 映射限制（容器 root 仅是宿主普通用户），所以 rootless Podman + unmask 的风险远小于 rootful Docker + privileged，但仍是"为了内层 bwrap 让外层变松"。社区共识：常见更好做法是把容器本身当边界，跳过内层 bwrap（见 #505 搜索摘要）。
6. 额外：srt 在 Linux 还要 socat、ripgrep、seccomp 过滤器与 Unix socket 桥；放进容器增加镜像内容与升级面。
7. 判定：可行但不划算；若强行做，最小组合为 rootless Podman + `seccomp=unconfined`（或定制 profile）+ `unmask=/proc/*` + 视宿主 LSM 加 label/apparmor 放开，不要 --privileged。[unverified：具体最小 flag 集未在本机复现]

反向与替代：
- srt 单独跑宿主：Linux 要 bwrap + 允许 userns（Ubuntu 24.04 需 AppArmor 配置），无需容器；与宿主共享内核，隔离强度取决于 bwrap/seccomp，对"防误操作与 prompt injection 外泄"够用，对"防内核 0day 逃逸"不够。
- 容器内用 Landlock：Landlock 是无特权 LSM，不需要 namespace 与 CAP_SYS_ADMIN，但需要内核 >= 5.13 且容器 seccomp 放行 landlock_* 系统调用（Docker 默认 profile 是否放行 [unverified]，Podman 同 [unverified]）。Landlock 能做文件边界；网络仅限 TCP bind/connect 端口（ABI v4，6.7+），无域名能力。故域名白名单仍靠出口代理。
- 每 worker 一个容器：边界最强，文件靠 bind-mount（worktree 可写、主分支 refs 只读挂载），网络用 --network=none + 挂 unix socket 到宿主代理（与 srt 的 Linux 设计同构）。代价：密度与启动开销高于 bwrap（容器 rootless 启动约百毫秒到秒级 [unverified]），PTY holder 与 loomd 热升级需要把 holder 放在容器外或用 `podman exec` 附着。

## 3. 比较表

图例：强/中/弱；"-"表示不适用或未证实。

| 维度 | A srt 宿主 | B 容器(每 worker 一个) | B' 容器(每 cell 一个)+Landlock | C 容器+srt | D blackwall |
|---|---|---|---|---|---|
| 文件边界 | 中强（bwrap/Seatbelt，denyRead+allowWrite） | 强（mount ns） | 中（Landlock，路径规则） | 强但外层被削弱 | 中（srt 之上固定配置） |
| 网络白名单+显式拒绝 | 有，代理+控制fd热更新；403 [unverified] | 需自建代理，容器 none+socket | 同 B，需自建 | 同 A，且更复杂 | 有但启动时固定，无热更新 |
| 凭证保护 | deny/mask（mask 仅 Linux 文件） | 靠不挂载 | 靠 Landlock 路径 | 同 A | 无 mask（自述） |
| per-worker 粒度 | 好（每进程独立 srt） | 好 | 差到中 | 好 | 一 agent 一沙箱 |
| PTY/TUI 兼容 | 好（包命令即可） | 需 -t/exec 附着，可行 | 好 | 好 | 好，仅 claude/codex |
| loomd 热升级友好 | 好：holder 在 srt 外或随 srt 子进程 | 中：conmon 持有，需设计附着 | 中 | 中 | 好 |
| 启动/密度 | 很好（毫秒级，无镜像） | 中（镜像层+netns） | 好 | 差（双层） | 很好 |
| macOS | 是（Seatbelt） | 否（需 VM，违背规定） | 否 | 否 | 是（主力平台） |
| Linux x86_64 | 是 | 是 | 是 | 是但需放松 | 未证实 |
| Windows 展望 | alpha，有路线 | WSL2 内可用 | 否 | 否 | 否 |
| 运维复杂度 | 低（npm+bwrap+socat） | 中（镜像/Quadlet） | 中 | 高 | 低但绑定死 |
| 成熟度 | Beta，周更，7.3k star | 很成熟 | 成熟/自建 | 低 | 极早期，单人 |
| 许可 | Apache-2.0 | Apache-2.0 | - | - | MIT |

## 4. 候选组合评估

A. srt only（宿主原生，Mac+Linux）。可行，且是唯一同时覆盖 Mac 的方案；一套 policy 模型、一个依赖（Anthropic 自身产品使用它）。风险：Beta 版本漂移（需 pin 版本）、Linux 需 AppArmor/userns 配置、mask 文件 mac 退化为 deny、共享内核。热升级：loomd 与 PTY holder 都不在 srt 内，仅 CLI 进程被 srt 包，loomd 重启不影响；但 srt 随被包命令存亡，--control-fd 的写端由 holder/loomd 持有，需保证 loomd 重启后能重新拿到控制 fd（建议由 holder 持有，loomd 经 holder 转发）[待实验]。判定：Mac 唯一可行；Linux 首选候选。

B. 仅容器。每 worker 一容器可行且边界最强，但无内建域名白名单，需自建代理（可复用 srt 的 `srt proxy` 独立代理模式，同样 Apache-2.0）；Mac 不适用；每 cell 一容器时 worker 间只能靠 Landlock，只有文件边界，没有进程/PID 隔离。判定：作为 Linux "强隔离"选项可行，但不是 Mac+Linux 统一方案。

C. 容器 + srt/bwrap。技术上能跑（见 §2），要放松 seccomp 等；削弱外层、增加复杂度，且 srt 的嵌套 userns 问题（#498）与硬化冲突。判定：不推荐。若要"容器=cell"，应让 cell 内 worker 之间不再互相隔离（容器即边界），或改用每 worker 一容器。

D. blackwall。它自己就是 srt 包装，叠一层不能解决 loom 需求（无动态策略、无 mask、只支持 claude/codex、Linux 未证实、单人早期项目）。可借鉴其 preset（git/npm/gh 的主机与路径、.git/hooks 与 .git/config 写保护）作为 loom 的配置模板。判定：不作底座，仅作参考。

E. 其他组合
- E1：Linux 上 srt 跑宿主，cell 本身 = 一台专用 Linux 主机/VM/专用系统用户；cell"一登录一出口"天然成立，容器可选。
- E2：Linux 每 worker 一个 rootless Podman（--network=none + 挂代理 unix socket + 只读主分支 refs），出口用 srt proxy 独立模式 + 外部 decider。强隔离，密度低于 A。
- E3（推荐落地形态）：策略层统一用 srt 的 JSON config 与代理（Mac/Linux 同一 policy 模型），Linux 可选"强化档"= 在 E2 容器内以 `--network=none` 运行，不再叠 bwrap。

## 对 loom 的含义

建议方向（供用户决定，非决定）：
- macOS：srt（Seatbelt）直接包 CLI 进程，别无实际替代；pin srt 版本，列入升级验证清单。blackwall 不采用，借其 preset 思路。
- Linux x86_64 默认档：srt（bwrap）跑宿主，cell=宿主/VM 或一个专用用户；先把 Ubuntu 24.04 AppArmor 的 userns 授权做成部署步骤。
- Linux 强化档（可选）：每 worker 一个 rootless Podman，网络 none + 代理 socket，不套 srt/bwrap；容器为边界。不建议"容器包 srt"。
- Docker 无优势，若选容器则 Podman（rootless、无守护进程、Quadlet、conmon 持有进程利于热升级）。
- Windows：srt alpha 路线或 WSL2 内走 Linux 方案，暂不决策。

仍需实验：
1. srt 在 deny 时返回的是否显式 403（HTTP 与 CONNECT/SOCKS 各自表现），以及对非代理感知客户端的行为。
2. Codex/Claude/agy/OpenCode 在 srt 下的实际兼容：keychain、auth 文件读取（"仅 CLI 自身登录可读凭证"如何用 denyRead/allowRead 表达）、TUI/PTY、MCP 子进程。
3. loomd 热升级：holder 在 srt 外/内两种布局，--control-fd 写端归属，loomd 重启后能否继续推送策略更新。
4. Linux 密度与启动：srt(bwrap) vs rootless Podman 的单 worker 启动时间与内存，20/50 worker 并发。
5. "worktree 可写、主分支 refs 只读"：srt 的 denyWrite 对 `.git` 子路径与 worktree 的 gitdir 链接（worktree 的 .git 文件指向主仓库 .git/worktrees/x，需要可写）是否可同时满足。
6. 容器路线下 Docker/Podman 默认 seccomp 是否放行 landlock_*，以及 Landlock 在目标内核上的 ABI 版本。
7. Ubuntu 24.04 AppArmor userns 策略对 srt 的最小授权。
8. srt 版本稳定性：对比 v0.0.81-0.0.83 的配置/行为变更，确定 pin 策略。

## 来源
- https://github.com/vinta/blackwall 及其 README、commits API（最新提交 2026-11-21）
- https://github.com/anthropics/sandbox-runtime 、releases API（v0.0.83，2026-11-13）
- https://github.com/containers/bubblewrap/issues/505
- https://github.com/containers/bubblewrap/issues/284
- https://github.com/anthropics/sandbox-runtime/issues/498
- https://dev.to/its-tahir/i-tried-running-claude-codes-sandbox-inside-docker-bubblewrap-couldnt-even-start-4faj
- https://github.com/containers/podman/issues/4131
- Podman/Docker 对比与 Landlock 部分来自通用知识，未逐条抓取一手文档 [unverified]。
