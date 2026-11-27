# loom cell 执行面：隔离与部署选型（2026-11-27，网页调研，未实测；[未核] 为二手/记忆）

**五类方案**
1. 整机专用（Mac mini / Linux 机，用户账户下直接跑）：启动 0、密度受 RAM/CPU 限、TUI 原生、macOS Keychain 登录最顺；只防跨机器，worker 间不隔离——必须叠加 2。
2. 进程级 OS 沙箱：Anthropic sandbox-runtime（srt，github.com/anthropics/sandbox-runtime；macOS 动态 Seatbelt，Linux bubblewrap + 独立 netns + 代理出网白名单，可热更新；Windows alpha）；Codex 自带（Linux bwrap+seccomp，Windows elevated/unelevated 两档，`codex exec` 有已知 bug #40158）。原生 IO、无挂载开销；凭据目录白名单挂载，不复制 token；防误操作与外泄，不防内核逃逸。可叠"每账户一个 OS 用户"获得文件与 Keychain 天然隔离。
3. 容器：Linux rootless Podman/Docker 亚秒级、密度高；macOS 必经 VM（Docker Desktop/OrbStack/Colima 共享一 VM；Apple `container` 每容器一轻量 VM，1.0 约 2026-06，推荐 macOS 26）。容器里是 Linux：Claude 凭据为 `~/.claude/.credentials.json`，宿主 Keychain 不可用 → 容器内重登或 `claude setup-token` 一年期 `CLAUDE_CODE_OAUTH_TOKEN`（仅模型请求，Remote Control 不可用）；Codex `--device-auth`（beta，可能被管理员禁用）；复制 auth.json 有 ToS 风险[二手]。macOS virtiofs 绑定挂载重 IO 慢[需实测]。Claude Code 官方 devcontainer 用 iptables+ipset 白名单默认 DROP。
4. VM/microVM：Linux 宿主 Firecracker/Cloud Hypervisor/Kata（百毫秒级、MB 级开销[厂商数据]），gVisor 兼容性略差；macOS 宿主 Virtualization.framework（Tart/Lima/UTM）Linux guest 不限、**macOS guest 每台 Mac 最多 2 个并发（EULA）**、每个约 8 GB；Docker Sandboxes（Docker Desktop 4.58+，每 agent 一 microVM，内置多家 CLI）[官方文档未核]；Windows WSL2 即 Hyper-V 轻量 VM，Claude Code 原生 Windows 无沙箱、WSL2 有。
5. 托管沙箱（E2B、Vercel、Modal、Daytona、Cloudflare）：冷启动 0.3–5 s，会话时长上限（如 24h），订阅 OAuth 进第三方机器有合规/ToS 风险——只适合溢出与不可信代码。

**业界**：Cursor Cloud Agents 每 agent 一台 Ubuntu VM + 快照预热；Copilot 云 agent 每会话临时 runner/沙箱 + 默认防火墙；OpenHands 默认 Docker（可选 process/remote）；SWE-ReX 同一 API 覆盖本地/Docker/Modal/Fargate/Daytona；container-use 每 agent 一容器一分支；Conductor、Vibe Kanban 只用 worktree。共识：本地优先工具 = worktree（+可选 OS 沙箱），云产品 = 每会话 VM/容器 + 快照 + 出网白名单。

**推荐分层（待实验确认）**
- **T0 默认（macOS/Linux 专用机）**：每订阅账户一个 OS 用户与独立 `CLAUDE_CONFIG_DIR`/`CODEX_HOME`；每 worker 独立 worktree，holder 子进程由 srt（或 CLI 自带沙箱）包裹，网络走代理白名单；原地登录一次，不复制 token。零 VM 开销、TUI 原生、热升级只需 holder 与 loomd 解耦——最符合 ops-first。
- **T1 Linux 强隔离**：按项目一个 rootless Podman 容器或 Firecracker/CH microVM，holder 与 loomd 在 guest 内，凭据卷按账户挂载，nft 出网白名单。
- **T2 macOS 强隔离**：按项目一个 Apple `container` 或 Lima/Tart Linux guest（不受 2 个 macOS VM 限制），guest 内用文件凭据/device-code/setup-token；仅需 Xcode 等时用 macOS guest（≤2）。
- **T3 Windows**：一个 WSL2 Linux 发行版 = 一个 cell，内部走 T0/T1。
- **T4 溢出**：托管沙箱只跑 headless 一次性任务，用 API key，不放订阅登录态。

**待实验**：①srt 包住四家 TUI 时 PTY/颜色/鼠标是否正常，与 CLI 自带沙箱叠加是否冲突；②Claude 在 srt/独立 OS 用户下 Keychain 是否弹框、SSH 下 Keychain 锁定时的回落；③Apple `container`、Lima virtiofs 上 worktree `git status`/`npm install` 耗时对比原生；④单台 Mac mini（如 32 GB）T0 与 T2 的会话密度；⑤setup-token 功能缺口对 loom 的影响；⑥Codex device-auth 可用性；⑦VM 内 holder 在宿主 loomd 热升级与快照恢复后能否存活/重连；⑧agy/Gemini 凭据位置与 Windows 现状；⑨Docker Sandboxes 官方文档与许可。

## 修订（2026-11-27，用户评审）
- **Mac 上的 Linux 虚拟机/容器不能做开发 cell。** Apple silicon 上的 OrbStack、Apple `container`、Lima 跑的都是 arm64 Linux；x86 只能经 Rosetta 转译或仿真。生产环境只会是 x86 Linux 或 macOS，在 arm64 Linux 里写出、测过的代码两边都不算数（原生依赖、二进制、性能、系统调用差异都可能不同）。因此 T2 取消。
- **修订后的分层**：Mac 目标 → 原生 macOS + 每 worker 沙箱 + 出网白名单（T0）；x86 Linux 目标 → 真实 x86 Linux 机器（裸机或 x86 云主机）上的 T0，需要更强隔离时在同架构上加 rootless Podman / Firecracker（T1）；Windows 待定；托管沙箱（T4）只跑 x86 Linux 的一次性无头任务。原则：**cell 的 OS 与架构必须等于生产目标**。
- **顺序**：先完成文件 + 网络隔离的 T0 cell，账号额度调度冻结，之后以 Magpie 开源实现为蓝本重做（切换策略、Codex 等切账号后原地重连）。
