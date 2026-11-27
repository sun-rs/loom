# LINUX-SRT-1：在 x86 Linux 宿主机上实测 srt（只用假 CLI）

机器：`ssh root@yt.sunrs.net`（Ubuntu 24.04、x86_64、24 核、62G）。用户授权在此部署 srt 做实验。
**这台机器上有生产 Docker 容器在跑（file-prod-1、file-dev-1），绝对不能影响它们。**

## 红线（违反任何一条立即停止并报告）
- 一切文件只放在 `/root/loom-srt-trial/`。node 用官方 linux-x64 tarball 解压到该目录；srt 用 npm 固定 `@anthropic-ai/sandbox-runtime@0.0.83` 装进该目录。不做全局 npm/node 安装。
- 允许的系统改动只有一条：`apt-get install -y --no-install-recommends bubblewrap socat ripgrep`（srt 的 Linux 依赖）。不 `apt upgrade`，不装别的包；如果还需要别的包（如编译器），先停下报告。
- 不执行任何 `docker`/`systemctl`/`service` 写操作，不改 iptables/nftables、sysctl、AppArmor 配置，不重启任何服务，不改 /etc 下除 apt 自身外的任何文件，不占用已被监听的端口（先 `ss -ltnp` 看）。srt/代理只监听 127.0.0.1 或 Unix socket。
- 开始和结束各记录一次 `docker ps --format '{{.Names}} {{.Status}} {{.ID}}'` 与 `cat /proc/loadavg`，结束时核对容器 ID 与状态不变（容器的运行时长会增长，这正常）。
- 任何时候负载 > 8 或可用内存 < 40G 就停。
- 只用假 CLI（一个 node/shell 脚本模拟：读写文件、发网络请求、读凭据路径、起子进程）；本卡不安装、不登录任何真实 agent CLI。
- 不读这台机器上任何既有凭据或 /root 下除试验目录外的私有文件内容。

## 要测（层级按 C23：holder → srt → CLI；本卡先用一个最小 PTY holder 夹具代替 loom 的 holder）
1. 环境指纹：内核、发行版、bwrap/socat/rg/node/srt 版本；`apparmor_restrict_unprivileged_userns` 当前值（只读）。
2. 以 root 运行 srt：假 CLI 越界写（试验目录外）、写 `.git/refs/heads/main` 与 `.git/refs/heads/` 目录内新建 lock、读另一个模拟凭据目录，均应被拒；写自己的 worktree 与私有 tmp 应成功。
3. 以非 root 运行 srt（用已有的非 root 用户则跳过建用户；没有就只记录"需要非 root 用户才能测"，不新建用户）：在 apparmor 限制=1 下是否能起 user namespace，失败的原始报错。
4. 网络：假 CLI 直连外网（IP 与域名）应被拒；只允许经本机一个"cell 出口代理"（在试验目录里起一个最小 HTTP CONNECT 代理，白名单只放 example.com）出去；非白名单返回显式 403 并有结构化日志；记录 srt 自带代理是否能关闭或改为只转发到该出口代理。
5. PTY：一个最小 PTY holder（node 或 python 均可，放试验目录）在沙箱外分配 PTY，再以 srt 启动假 CLI 并继承该 PTY；验证读写、窗口尺寸变化、颜色输出正常。
6. 多 cell 可行性（只验机制）：两个 cell 各自不同的 HOME 目录与不同出口代理，cell A 的进程读不到 cell B 的 HOME，也连不到 cell B 的代理；记录 srt 本身是否支持为不同实例设置不同 hostname//etc/machine-id（不支持就写"需要直接调用 bwrap"）。
7. 开销：启动 srt+假 CLI 的耗时中位数（20 次），以及同时 16 个沙箱会话时的内存/CPU。

## 交付
- 结果写到 /Users/sun/Code/repos/loom_new/tasks/LINUX-SRT-1/RESULT.md（每项：命令、原始输出摘录、结论 PASS/FAIL/BLOCKED），以 STATUS 行收尾。
- 结束清理：停掉所有试验进程，删除 `/root/loom-srt-trial/`；保留已 apt 安装的三个包（如需卸载由 Super 决定），并在结果里列出。
- 不 commit，不 push。
