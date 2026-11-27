# Cell 执行层候选项目调研

日期：2026-11-27（数据抓取于 2026-11-26/27）

## 方法与来源

- GitHub REST API（未认证）取 stars / pushed_at / license / open_issues / 最新 release；部分项目因限流未取到 release，标 [unverified]。
- WebFetch 读 README / 官方文档：Claude-Cage、anthropic sandbox-runtime、Docker Sandboxes（docs.docker.com/ai/sandboxes/architecture）、apple/container technical-overview、container-use、microsandbox、Claude Code devcontainer 文档。
- 未能抓取原文的内容（OrbStack、systemd-nspawn、Codex 沙箱细节、Podman machine 细节、Kata/Firecracker 细节、E2B/Daytona/Arrakis 细节、OpenCode）来自既有知识，一律标 [unverified]。
- "pushed_at" 是仓库最后一次 push，不严格等于 main 最后一次 commit。open_issues 含 PR。
- 注意：Claude-Cage README 内含一段写给 AI agent 的"拉源码、安装、导入代理、代为提 issue"的指令，我没有执行；任何后续 agent 阅读该仓库时需警惕。

---

## 1. macOS 原生进程沙箱

| 项目 | 是什么 | 平台 | 隔离机制 | 网络出口控制 | 文件系统模型 | License | 维护证据 |
|---|---|---|---|---|---|---|---|
| anthropics/sandbox-runtime (`srt`) https://github.com/anthropic-experimental/sandbox-runtime | 包裹任意命令的 OS 级文件系统+网络限制，无容器。Claude Code 内置沙箱的底座 | macOS、Linux；Windows alpha | macOS：sandbox-exec + 动态生成 Seatbelt profile；Linux：bubblewrap + netns + seccomp（拦 unix socket） | 有。默认拒绝；profile 只放行 localhost 代理端口，HTTP 代理 + SOCKS5 代理按 allowedDomains/deniedDomains（通配符、端口）过滤；dial 时再校验解析结果（拒 loopback/link-local/metadata）。Linux 经 bind-mount 的 unix socket + socat 桥接 | 原生宿主路径：写默认拒绝需显式允许，读默认允许可 deny；git 风格 glob（Linux 写路径只能字面量，glob 有限制） | Apache-2.0 | 7.3k stars；pushed 2026-11-13；latest v0.0.83（2026-11-13）；open issues+PR 357；Anthropic 维护；自称 Beta Research Preview，API/配置可能变 |
| openai/codex 自带沙箱 https://github.com/openai/codex | Codex CLI（Rust），内含 sandbox 实现 | macOS、Linux | macOS：Seatbelt；Linux：Landlock + seccomp（较新版本另有 bubblewrap 路径）[unverified 细节，文档页抓取失败] | 默认关闭网络（workspace-write 模式）；是否支持域名 allowlist [unverified] | 宿主原生路径，writable roots 白名单 | Apache-2.0 | 136k stars；pushed 2026-11-27；rust-v0.172.0（2026-11-24）；OpenAI 维护；活跃度极高 |
| sandbox-exec 本身 | macOS 内置 CLI，man 页标 deprecated，但 Seatbelt 内核机制仍被 Chrome、Apple 自家服务、srt、Codex 使用 | macOS | Seatbelt (sandboxd/MAC framework) | profile 内可按 IP/端口 allow/deny；无域名（需配合本地代理） | 宿主原生 | 系统自带 | 长期 deprecated 风险 [unverified 是否有取代计划] |
| 其它维护中的 Seatbelt 包装器 | 本次搜索未发现独立于 srt/Codex 之外、有实质维护的通用项目 | - | - | - | - | - | [unverified] |

## 2. Linux 原生进程沙箱

| 项目 | 是什么 | 隔离机制 | 网络出口控制 | 文件系统模型 | License | 维护证据 |
|---|---|---|---|---|---|---|
| containers/bubblewrap https://github.com/containers/bubblewrap | Flatpak 等使用的低层无特权沙箱 | user/mount/pid/net/ipc/uts namespaces，可配 seccomp | 仅 `--unshare-net`（全断）；域名 allowlist 需外挂（srt 的做法：全断网 + unix socket 代理） | bind mount / tmpfs / overlay 选项，宿主路径可只读或读写绑定 | 仓库显示 NOASSERTION（实为 LGPL-2.0+）[unverified] | 9.6k stars；pushed 2026-11-25；v0.13.1（2026-10-14）；Flatpak/Red Hat 生态维护 |
| netblue30/firejail https://github.com/netblue30/firejail | namespaces + seccomp-bpf 沙箱，带大量 profile | namespaces、seccomp、caps 丢弃；setuid-root 二进制 | 有 netfilter 过滤（`--netfilter`）、`--net=` 独立网络命名空间；域名级需外挂 | 黑/白名单路径、private 目录、overlay | GPL-2.0 | 7.8k stars；pushed 2026-11-26；0.9.82.2（2026-11-03）；526 issues；setuid 攻击面是历史争议点 |
| google/nsjail https://github.com/google/nsjail | 轻量进程隔离（CTF/评测场景） | namespaces + cgroups + rlimits + seccomp-bpf（kafel 策略） | 可新建 netns；可配 macvlan 等；域名 allowlist 无 | bind mount / tmpfs / chroot | Apache-2.0 | 4.2k stars；pushed 2026-11-20；v3.6（2026-03-18）；open 79；Google 维护但 release 节奏慢 |
| google/minijail https://github.com/google/minijail | ChromeOS/Android 用的沙箱与 containment | namespaces、seccomp、caps、pivot_root | 同 nsjail，无域名级 | bind mount / chroot | BSD-3 | 399 stars；pushed 2026-11-22；Google/ChromeOS 维护；面向系统集成，不易独立使用 |
| Zouuup/landrun https://github.com/Zouuup/landrun | 基于 Landlock 的无特权沙箱 CLI（"类 firejail 但更简单"） | Landlock LSM（内核 ≥5.13 文件系统；≥6.7 TCP bind/connect 端口） | 仅按 TCP 端口规则，无域名 | 路径级 ro/rw/exec 白名单，宿主原生路径，无 mount namespace | MIT | 2.4k stars；pushed 2026-11-21；v0.2.0（2026-11-21）；个人项目，pre-1.0 |
| Landlock 本身 | 内核 LSM（无需特权）；Codex 等使用 | 见上 | 见上 | 见上 | GPL 内核 | 上游 landlock-lsm [unverified 细节] |
| systemd-run / systemd-nspawn | systemd 自带：`systemd-run -p ProtectSystem= -p PrivateNetwork= -p IPAddressAllow=...`；nspawn 为轻量容器 | cgroup + namespaces + seccomp（unit 沙箱选项）；nspawn 完整 rootfs 容器 | `IPAddressAllow/Deny`（基于 cgroup eBPF，按 IP/CIDR，无域名）；`PrivateNetwork=` | BindPaths / ReadOnlyPaths / TemporaryFileSystem；nspawn 需 rootfs | LGPL-2.1 | systemd 主线，持续维护 [unverified 具体日期]；用户级需 `systemd --user` + delegation |
| gVisor (runsc) https://github.com/google/gvisor | 用户态应用内核，拦截 syscall | ptrace/KVM/systrap 平台；比 namespace 更强的 syscall 面缩小 | netstack 用户态网络栈；域名级需外挂 | gofer 代理文件访问，bind mount 有性能代价（I/O 开销较大）[unverified 量化] | Apache-2.0 | 20.1k stars；pushed 2026-11-26；release-20261123.1（2026-11-23）；Google 维护，近乎每周发版 |
| Kata Containers / Firecracker（仅参考，VM 级） | 轻量 VM 运行容器 / microVM 监控器 | KVM microVM | VM 外由宿主 netfilter/TAP 控制 | virtiofs / block device | Apache-2.0 | Kata 9.2k stars，pushed 2026-11-27；Firecracker 38.2k stars，pushed 2026-11-25（release 未取到 [unverified]）；仅 Linux+KVM，macOS 不适用 |

## 3. 容器引擎 / VM 运行时

| 项目 | 是什么 | 平台 | 隔离机制 | 网络出口控制 | 文件系统模型 | License | 维护证据 |
|---|---|---|---|---|---|---|---|
| Podman https://github.com/containers/podman（现址 podman-container-tools/podman） | 无守护进程的 OCI 引擎，rootless 为一等公民 | Linux 原生；macOS/Windows 通过 `podman machine`（QEMU 或 Apple Virtualization/libkrun 的 Fedora CoreOS arm64 guest）[unverified 细节] | rootless user namespace + 容器 namespaces/cgroups/seccomp/SELinux；可选 runtime：crun、runsc、krun、kata | 网络后端 netavark/pasta；内置无域名 allowlist，需自行 iptables/nft 或代理 | bind mount、overlayfs；macOS 上经 virtiofs（podman machine）[unverified 性能] | Apache-2.0 | 33.4k stars；pushed 2026-11-26；v6.2.1（2026-11-24）；Red Hat 主导；open 1019 |
| Docker（Engine / Desktop）+ Docker Sandboxes (`sbx`) https://github.com/docker/sbx-releases | `sbx`：为 AI coding agent 设计的本地隔离环境 | macOS（brew）、Windows、Ubuntu(.deb)、Rocky 8(.rpm)；Linux 需 kvm 组 | 每个 sandbox 一个 microVM（官方文档对比并强调优于 namespace 容器），VM 内自带 Docker daemon、镜像缓存 | 有：所有出站 TCP 经宿主侧代理；HTTP/HTTPS 转发代理 + 其他 TCP 透传，均受 network policy 约束；代理还可注入凭据（agent 只见占位符）。组织级集中管理为付费订阅 | 三种：直接挂载宿主目录（非同步，实时双向；默认**相同绝对路径**，virtiofs 缓存默认开）；clone 模式（宿主 repo 只读挂到 `/run/sandbox/source`，沙箱内私有 clone）；无挂载模式（0.42.0 起） | 专有（Docker Inc.；仓库 LICENSE 为专有条款）；仓库仅发布 release | 545 stars；pushed 2026-11-26；v0.54.1（2026-11-24）；open 289；Docker 官方；版本迭代极快、仍年轻 |
| OrbStack https://orbstack.dev | macOS 上的快速 Docker/Linux 虚拟机 | macOS only（Apple silicon / Intel）[unverified] | 单个共享轻量 Linux VM（arm64 在 Apple silicon），容器为 namespace 容器 | 无内置域名 allowlist [unverified] | 自研 VZ/virtiofs 优化，文件共享性能好 [unverified] | **闭源**，个人免费、商用付费 [unverified 条款] | 活跃商业产品，具体 release 日期 [unverified] |
| apple/container https://github.com/apple/container | Apple 官方 Swift 工具，每个容器一个轻量 VM | macOS 26+（15 可跑但不推荐、网络受限）；Apple silicon | 每容器独立 VM（Virtualization.framework），guest 为 arm64（亦可 Rosetta 跑 x86_64 [unverified]） | 文档未提供出口控制；vmnet 网络（macOS 26 支持自定义网络），需自建代理/guest 内防火墙 | 只把需要的宿主目录挂入该容器 VM（机制文档未明说，实为 virtiofs [unverified]） | Apache-2.0 | 52k stars；pushed 2026-11-13；1.7.1（2026-11-06）；open 659；已知限制：VM 内存释放不归还宿主，部分功能未实现 |
| apple/containerization https://github.com/apple/containerization | 上述工具所基于的 Swift package | macOS 26+ | 同上 | 同上 | 同上 | Apache-2.0 | 9.0k stars；pushed 2026-11-18；release 未取到 [unverified]；Apple 维护 |
| Lima https://github.com/lima-vm/lima | macOS/Linux 上的 Linux VM（含容器），CNCF 项目 | macOS（vz/qemu）、Linux | 完整 VM（VZ/QEMU），guest 可 arm64 或 x86_64（QEMU 模拟慢） | VM 内自行配防火墙；Lima 本身不提供 allowlist | virtiofs / reverse-sshfs / 9p 挂载；可挂载 git worktree 目录 | Apache-2.0 | 22.5k stars；pushed 2026-11-26；v2.3.0（2026-11-06）；open 543；社区/CNCF |
| Colima https://github.com/abiosoft/colima | 以 Lima 为底的容器运行时一键封装 | macOS、Linux | Lima VM + docker/containerd/incus | 无内置 | 同 Lima | MIT | 31.9k stars；pushed 2026-10-13；v0.10.3（2026-06-04）；注意：最近 release 已超 5 个月，主要靠 main 分支 |
| Finch https://github.com/runfinch/finch | AWS 的开源容器客户端（Lima + nerdctl + containerd + BuildKit） | macOS、Windows | Lima VM | 无内置 | 同 Lima | Apache-2.0 | 4.1k stars；pushed 2026-11-24；v1.19.0（2026-09-16）；AWS 维护 |
| Claude-Cage https://github.com/Lee-xeo/Claude-Cage | 桌面 App，在 Lima 管理的 Debian 13 VM 内跑 Claude Code / Claude Desktop；基于 agent-vm 项目 | macOS 14+（Apple silicon+Intel）、Windows x64、Debian12/Ubuntu 22.04/24.04 x86_64；不支持 Windows/Linux ARM64 | 完整 VM（Lima），所有平台同一个 Debian 13 guest，**所有项目共享一个 VM，项目间无隔离** | 全部 guest 流量强制经内置 Mihomo 代理核心（可导入 Clash/sing-box 配置）；代理不可用则断网、无直连回退；仅 IPv4 TCP，公网 UDP/IPv6/ICMP/宿主与 LAN 受限。本质是"防泄露/固定出口 IP"，而非域名 allowlist（自述不能保证账号不被限制，也未经独立审计） | 只共享默认 workspace 与显式打开的项目目录，guest 内修改/删除/Git 操作直接作用于宿主原文件；工具/登录态在虚拟磁盘持久化 | MIT | 8.8k stars；pushed 2026-11-27；v0.2.1（2026-11-25）；open 143；1235 commits；Go 为主（cmd/internal/desktop/mobile/ui 等目录）；自称"快速迭代中"。动机含规避账号风控/指纹，属产品应用而非可嵌入的隔离库，对 loom 参考价值有限（可看其 Lima 配置与代理强制思路） |

## 4. Agent 专用沙箱 / 平台

| 项目 | 是什么 | 平台 | 隔离机制 | 网络出口控制 | 文件系统模型 | License | 维护证据 |
|---|---|---|---|---|---|---|---|
| Claude Code devcontainer（官方参考） https://github.com/anthropics/claude-code/tree/main/.devcontainer | devcontainer.json + Dockerfile + `init-firewall.sh`；官方文档明确称其为"示例而非维护的基础镜像" | 任何 Docker / devcontainer 工具 | Docker 容器（非 root 用户） | `init-firewall.sh`：容器内 iptables + ipset 域名→IP 白名单，需 `NET_ADMIN`/`NET_RAW`。文档警告：`--dangerously-skip-permissions` 下容器内凭据仍可外泄 | 仓库 bind mount 为 workspace，修改直接落到宿主；`~/.claude` 用命名卷（`CLAUDE_CONFIG_DIR`） | claude-code 仓库无 SPDX（专有）；示例脚本可借鉴 | claude-code 157k stars，pushed 2026-11-26；另有 anthropics/devcontainer-features |
| dagger/container-use https://github.com/dagger/container-use | MCP server，给每个 agent 一个容器 + 一个 git 分支 | macOS（brew）、Linux | Dagger 引擎启动的容器（依赖 Docker 类运行时） | README 未提网络控制 | 分支模型（非 worktree）；`git checkout <branch>` 审查；可进 agent 终端 | Apache-2.0 | 4.1k stars；pushed 2026-11-14；**最新 release v0.4.2 为 2025-08-19**，已 15 个月无 release；标 Experimental；open 67 |
| superradcompany/microsandbox（原 zerocore-ai/microsandbox） https://github.com/superradcompany/microsandbox | 本地优先 microVM 运行时/库 | Apple silicon Mac、Linux+KVM、Windows+WHP | libkrun microVM | 有 host allowlist（Sandboxfile 的 `allow:`）、端口、host-scoped secrets（密钥不进 VM） | volume 管理；挂载细节 [unverified] | Apache-2.0 | 9.2k stars；pushed 2026-11-27；1438 commits；YC 背书；自称 beta，会有破坏性变更；release 未取到 [unverified] |
| E2B 开源 https://github.com/e2b-dev/infra → 现 e2b-dev/runtime | E2B 云沙箱的开源基础设施 | Linux（Firecracker + KVM，GCP/AWS 自托管） | Firecracker microVM | [unverified] | [unverified]，VM 内 rootfs，非宿主 worktree 友好 | Apache-2.0 | runtime 1.9k stars；pushed 2026-11-25；infra 最近 release 2026.30（2026-09-10）；面向云端多租户，不适合本机 |
| Daytona https://github.com/daytonaio/daytona | AI 代码执行基础设施 | Linux 自托管 [unverified] | 容器（Docker）/ 沙箱 [unverified] | [unverified] | [unverified] | GitHub 无 SPDX（历史上 AGPL-3.0 [unverified]） | 71k stars；**GitHub 标记 archived，pushed 2026-07-24（>4 个月）**。按调研规则降级，仅作历史参考；是否迁移到新仓库 [unverified] |
| OpenHands https://github.com/OpenHands/OpenHands | agent 平台，runtime 在 Docker 容器内执行 | Linux/macOS（Docker） | Docker 容器 runtime | 无内置 allowlist [unverified] | 挂载 workspace | MIT | 94k stars；pushed 2026-11-27；活跃。是整套 agent 产品，隔离层不易抽出 |
| abshkbh/arrakis https://github.com/abshkbh/arrakis | 自托管 microVM 沙箱（Cloud Hypervisor）| Linux（KVM） | microVM | [unverified] | snapshot/restore 特色 | AGPL-3.0 | 897 stars；**pushed 2025-06-02，已 >17 个月无更新**，跳过（历史参考） |
| OpenCode (sst/opencode) | 其本身权限系统而非 OS 沙箱 | - | 无原生 OS 级沙箱 [unverified] | - | - | - | 需外包沙箱（srt / 容器）；[unverified] |

### 配套网络出口工具（经验层面）

| 方案 | 说明 | 备注 |
|---|---|---|
| iptables + ipset 域名→IP（Claude Code devcontainer 做法） | 启动时解析域名为 IP 集合，其余 DROP | 需 NET_ADMIN；CDN IP 漂移需刷新；无 SNI 校验 |
| 本地 HTTP/SOCKS 代理 + 域名 allowlist（srt、Docker sbx 做法） | 沙箱内只能连代理；代理按域名过滤；dial 时再校验解析结果防 DNS rebinding | 对 macOS Seatbelt、Linux netns、VM 三种形态都通用，**是跨平台统一方案** |
| Squid / mitmproxy / tinyproxy 等 allowlist 代理 | 通用 HTTP(S) CONNECT 过滤 | 维护状态未逐一核实 [unverified]；srt 内置代理实现可直接借用 |
| Mihomo（Claude-Cage） | 规则代理核心，强制全部流量 | 偏"固定出口"而非最小授权 |

---

## 5. 对 loom 的含义

### 总体判断

- 唯一能在 macOS 与 x86 Linux 上用**同一套思路**实现网络 allowlist 的，是"沙箱内只能连宿主侧代理 + 代理做域名过滤"这一模式（srt、Docker sbx 都是这么做的）。它与隔离形态无关，可与任何隔离后端组合。
- 对 loom 现有形态（PTY holder → CLI TUI，宿主 worktree、热升级连续性）而言，**进程级沙箱**（Seatbelt / bubblewrap）比容器/VM 更契合：PTY 仍在宿主，路径与宿主一致，holder 可以不重启地接管。

### macOS

重要事实：macOS 上**所有 Linux 容器（Podman machine、Docker/sbx、OrbStack、Lima/Colima/Finch、apple/container、microsandbox）都跑在 VM 里，guest 是 arm64 Linux**（apple/container 为每容器一 VM；其余多为共享 VM 或每 sandbox 一 VM）。含义：(1) 生产是 x86 Linux 或 macOS，arm64 guest 与二者都不一致，原生二进制/依赖可能出现 arch 差异，x86 需 Rosetta/QEMU 模拟；(2) 宿主文件经 virtiofs，worktree 上大量小文件 I/O（git status、构建）比原生慢；(3) 每个 VM 有固定内存占用，apple/container 已知内存不归还宿主；(4) macOS 上的 CLI（含 Codex/Claude 的 macOS 原生登录态、Keychain）无法原样在 guest 运行；(5) 热升级时 PTY holder 在 VM 内外的分界要重新设计。

| 需求 | 最佳候选 | 可直接借用 | 需自建 |
|---|---|---|---|
| (a) 环境隔离 | 1. srt（Seatbelt）；2. Codex 的 Seatbelt 实现作参照 | srt 的 Seatbelt profile 生成逻辑（Apache-2.0，TS）；或直接把 `srt` 作为子进程 wrapper | 每个 worker 的 HOME/环境变量/provider home 隔离（Seatbelt 只管文件与网络，不虚拟化 HOME） |
| (b) 网络 allowlist | srt 的本地 HTTP+SOCKS 代理 + Seatbelt 只放 localhost 端口 | 整套代理与域名校验（含 dial 时 IP 校验） | 每 cell 一个代理实例/策略下发、日志与审批流；macOS 26 以前对 Mach/trustd 的例外要评估（`enableWeakerNetworkIsolation` 的外泄路径） |
| (c) 文件系统/worktree | 宿主原生路径（零拷贝、零性能损失、与 git worktree 直接对应）；允许写集合 = worktree + tmp + 该 worker 私有 home | srt 的 allowWrite/denyRead 配置模型 | worktree 与 `.git` 公共目录（worktree 的 gitdir 在主仓库 `.git/worktrees/`）的写权限精细化；`git` 操作需要写主仓库 `.git` 的部分 |

备选（需要强隔离/不可信代码时）：apple/container 或 microsandbox（Apple silicon 原生，每任务一个 VM），但要接受 arm64 guest 与 virtiofs 代价，只建议作为"高风险任务"可选档，而非默认。Docker sbx 的 clone 模式（宿主只读 + 沙箱内 clone）是对 worktree 关系的好参考，但它专有且年轻。

### Linux（x86_64 生产）

| 需求 | 最佳候选 | 可直接借用 | 需自建 |
|---|---|---|---|
| (a) 环境隔离 | 1. bubblewrap（经 srt 或直接）；2. 若需更强：gVisor(runsc) 或 Podman rootless | bwrap 命令行；srt 的 Linux 路径（含 seccomp 拦 unix socket）；Codex 的 Landlock 路径作备份 | 兼容性处理：Ubuntu 24.04+ 的 apparmor 对 unprivileged userns 限制；嵌套容器/Chromium 沙箱需 `allowNestedUserNamespaces` |
| (b) 网络 allowlist | netns 全断 + unix-socket 桥接到宿主代理（srt 做法）；退路：iptables/ipset（Claude devcontainer 脚本） | srt 的 proxy + socat 桥；`init-firewall.sh` | 策略下发与 DNS 处理；IP 型 allowlist 的刷新 |
| (c) 文件系统/worktree | bwrap bind mount：worktree 读写、其余只读/隐藏；与 PTY holder 在同一宿主路径 | bwrap 的 `--bind/--ro-bind/--tmpfs` | 每 worker 私有 HOME overlay/tmpfs；热升级时 holder 与 bwrap 子进程的生命周期（bwrap 用 `--die-with-parent`，需评估 holder 重启是否杀子树） |

补充：Landlock（landrun）适合不能用 userns 的环境，但只有端口级网络控制，不能做域名 allowlist，只作后备；systemd-run `IPAddressAllow` 可做 IP 级兜底；容器路线（Podman rootless）适合需要独立 rootfs/工具链的 worker，网络仍需自带代理方案。

### 可直接借用 vs 自建（汇总）

- 可借用：srt（macOS+Linux 的隔离与代理，Anthropic 维护，但 Beta、v0.0.x，API 不稳，建议 vendoring 并锁版本，符合"borrow before build"）；Claude devcontainer 的 firewall 脚本；Docker sbx 的"代理注入凭据、占位符"思路。
- 需自建：cell 生命周期与 loomd 的接口；每 worker HOME/凭据隔离；网络策略的集中配置/审计；热升级下 PTY holder 与沙箱进程的所有权；worktree 与 `.git` 公共目录的最小授权。

---

## 6. 需要实验验证的问题

1. srt 能否包住"PTY holder 子进程 → Codex/Claude/agy/OpenCode TUI"？这些 CLI 自带沙箱（Codex 的 Seatbelt）时，嵌套沙箱在 macOS 上会失败（Seatbelt 不可嵌套，沙箱内无法再 sandbox-exec）——要选择"外层 loom 沙箱 + CLI 内 `--dangerously`/关闭自带沙箱"。需实测各 CLI。
2. srt 的 macOS 代理方案下，Go 程序、Node、Rust（rustls/native certs）、git over ssh、`gh`、npm/pip/cargo 是否都能走代理？SSH/其他 TCP 经 SOCKS 的覆盖面。`trustd` 例外的实际风险。
3. Linux 上 srt/bwrap 在目标发行版（Ubuntu 24.04 的 apparmor userns 限制）的开箱可用性；无 root 部署路径。
4. Seatbelt 下 git worktree：主仓库 `.git/worktrees/<name>` 与共享 objects 的写权限最小集合；`git gc`、`git fetch` 是否需要放宽。
5. 热升级连续性：loomd 或 PTY holder 重启时，Seatbelt/bwrap 子进程是否存活、PTY fd 如何交接（`--die-with-parent`、`setsid`、launchd 管理）。
6. 对比实测：virtiofs（apple/container、Lima VZ、Podman machine、sbx）下 worktree 的 `git status`、`cargo build`、`npm install` 与宿主原生的耗时比，以及内存开销与 VM 启动时间（并发 10+ worker 时）。
7. apple/container 的 macOS 15 vs 26 差异；能否在 guest 内放 srt 风格代理与出站限制；x86_64 镜像经 Rosetta 的兼容性。
8. Docker sbx：专有许可对 loom 分发/集成的限制；Linux 上 KVM 依赖（x86 生产机/CI 是否有嵌套虚拟化）；network policy 是否可无组织订阅使用；是否能从外部 PTY 接管其 agent 会话。
9. 是否需要"两档 cell"：默认进程沙箱（srt）+ 高风险任务 microVM（microsandbox / sbx）；两者的统一接口应放在哪里。
10. 凭据策略：沙箱内是否放真实 OAuth（Codex auth.json/Claude 登录态）；采用代理注入（sbx 做法）能否适配这些 CLI；每 worker provider home 的隔离方式。
11. Colima（最近 release 2026-06）、Daytona（archived）、container-use（release 停在 2025-08）、arrakis（2025-06 后无更新）按调研规则不作为首选，除非有特定理由。
12. 未核实项补查：OrbStack 条款与网络能力、Codex 沙箱细节与 allowlist（查 Codex 官方 Sandboxing 页）、Podman machine 当前默认 provider、E2B/Daytona/OpenHands 的 egress 能力、OpenCode 是否有沙箱。
