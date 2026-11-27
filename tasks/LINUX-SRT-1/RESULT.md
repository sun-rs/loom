# LINUX-SRT-1 实测报告：x86_64 Linux 宿主机上的 srt 与常驻 Cell 模型

测试机器：`root@yt.sunrs.net`（Ubuntu 24.04 LTS, x86_64, 24 核, 62 GiB RAM），全程仅使用假 CLI，未安装或登录任何真实 agent CLI。

---

## 红线与基线核对（开始 vs 结束）

| 检查项 | 开始基线 | 结束基线 | 核对结论 |
|---|---|---|---|
| `docker ps --format '{{.Names}} {{.Status}} {{.ID}}'` | `file-prod-1 Up 3 minutes 8f5d2b450a6d`<br>`file-dev-1 Up 3 minutes aafccb7b83bf` | `file-prod-1 Up 19 minutes 8f5d2b450a6d`<br>`file-dev-1 Up 19 minutes aafccb7b83bf` | **PASS**（容器 ID 与运行状态不变，运行时长连续增长） |
| `cat /proc/loadavg` | `0.01 0.04 0.01 1/518 5241` | `0.00 0.03 0.00 1/583 12666`（全程峰值 `0.36`，红线 ≤ 8） | **PASS** |
| `MemAvailable` | `64499340 kB`（61.51 GiB） | `64494252 kB`（61.51 GiB；16 并发最低 `60.82 GiB`，红线 ≥ 40G） | **PASS** |
| `ss -ltnp` 监听端口 | `53, 7890, 7891, 7892, 2288, 2299, 22, 1053, 9090` | 完全一致，无新增残留监听 | **PASS** |
| 文件与进程清理 | `/root/loom-srt-trial/` 不存在 | 已停掉全部试验进程（`NONE_RUNNING`），已删除 `/root/loom-srt-trial/`，`/tmp` 与 `/mnt` 干净，全局 `node`/`npm`/`srt` 均 `ABSENT` | **PASS** |
| 系统改动 | 无 | 仅执行 `apt-get install -y --no-install-recommends bubblewrap socat ripgrep`（`0 upgraded, 3 newly installed`），未改 `/etc`、sysctl、AppArmor、iptables/nftables、docker/systemd | **PASS** |

**保留的 3 个 apt 包（按卡保留，是否卸载由 Super 决定）：**
- `bubblewrap` `0.9.0-1ubuntu0.3`
- `socat` `1.8.0.0-4ubuntu0.1`
- `ripgrep` `14.1.0-1`

---

## 1. 环境指纹

**命令：**
```sh
uname -a
cat /etc/os-release | grep -E "^(NAME|VERSION|PRETTY_NAME)="
sysctl -n kernel.apparmor_restrict_unprivileged_userns
cat /proc/sys/kernel/unprivileged_userns_clone
cat /sys/kernel/security/lsm
bwrap --version && socat -V | head -n 3 && rg --version | head -n 2
/root/loom-srt-trial/node/bin/node -v
/root/loom-srt-trial/srt/node_modules/.bin/srt --version
```

**原始输出摘录：**
```text
Linux yt1 6.8.0-151-generic #151-Ubuntu SMP PREEMPT_DYNAMIC Wed Nov 11 01:28:36 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
PRETTY_NAME="Ubuntu 24.04 LTS"
NAME="Ubuntu"
VERSION="24.04 LTS (Noble Numbat)"
kernel.apparmor_restrict_unprivileged_userns = 1
kernel.unprivileged_userns_clone = 1
LSMs: lockdown,capability,landlock,yama,apparmor
LANDLOCK_ABI_VERSION= 4 errno= 0
bubblewrap 0.9.0
socat version 1.8.0.0 on 03 Jul 2026 12:45:49
ripgrep 14.1.0
node v22.23.5 (官方 node-v22.23.5-linux-x64.tar.xz 解压至 /root/loom-srt-trial/node)
@anthropic-ai/sandbox-runtime 0.0.83 (npm --save-exact 安装至 /root/loom-srt-trial/srt)
```

**结论：PASS**

---

## 2. 以 root 运行 srt（文件、Git refs/lock、模拟凭据与子进程边界）

### 2.1 重要发现：默认配置（启用 `apply-seccomp`）在 Ubuntu 24.04 `apparmor_restrict_unprivileged_userns=1` 下即使以 root 也会失败

**命令：**
```sh
HOME=/root/loom-srt-trial/t2/fake-home TMPDIR=/root/loom-srt-trial/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -d \
  -s /root/loom-srt-trial/t2/settings-dir-deny.json -- /bin/echo hi
dmesg -T | grep -iE "apparmor|apply-seccomp" | tail -n 6
```

**原始输出摘录：**
```text
[SandboxDebug] [Sandbox Linux] Applying seccomp filter for Unix socket blocking
[SandboxDebug] [Sandbox Linux] Wrapped command with bwrap (network, filesystem, seccomp(unix-block) restrictions)
apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied
(EXIT=1)

# dmesg 内核审计：
audit: ... apparmor="AUDIT" operation="userns_create" class="namespace" info="Userns create - transitioning profile" profile="unconfined" pid=6354 comm="apply-seccomp" requested="userns_create" target="unprivileged_userns"
audit: ... apparmor="DENIED" operation="capable" class="cap" profile="unprivileged_userns" pid=6354 comm="apply-seccomp" capability=21 capname="sys_admin"
```

**根因：** `root` 启动外层 `bwrap --unshare-user --cap-drop ALL --cap-add CAP_SETFCAP` 本身成功，但 `bwrap` 丢弃了 `CAP_SYS_ADMIN` 后，沙箱内 `srt` 自带的 `vendor/seccomp/x64/apply-seccomp` 会再建一层嵌套 userns 并写 `/proc/self/setgroups`。在 Ubuntu 24.04 `apparmor_restrict_unprivileged_userns=1` 下，AppArmor 将无 `CAP_SYS_ADMIN` 的 `apply-seccomp` 切入 `unprivileged_userns` profile 并拒绝 `sys_admin`，导致失败（实测即使在配置中加 `"allowNestedUserNamespaces": true` 依然同错失败）。

### 2.2 设置 `network.allowAllUnixSockets: true`（跳过 `apply-seccomp`，保留 `bwrap --cap-drop ALL --disable-userns`）后的完整边界实测

**命令：**
```sh
# 2A: allowWrite=[worktree, private-tmp], denyWrite=[worktree/.git/refs/heads], denyRead=[other-creds]
HOME=/root/loom-srt-trial/t2/fake-home TMPDIR=/root/loom-srt-trial/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -s /root/loom-srt-trial/t2/settings-dir-deny-nounix.json -- \
  /root/loom-srt-trial/node/bin/node /root/loom-srt-trial/scripts/fake-cli.mjs fs-check /root/loom-srt-trial/t2

# 能力与 --disable-userns 校验
HOME=/root/loom-srt-trial/t2/fake-home TMPDIR=/root/loom-srt-trial/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -s /root/loom-srt-trial/t2/settings-dir-deny-nounix.json -- \
  /bin/sh -c 'grep -E "^(CapEff|CapPrm|CapBnd):" /proc/self/status; unshare -U /bin/true 2>&1; echo NESTED_UNSHARE_EXIT=$?'

# 2B: 仅文件级 denyWrite=[worktree/.git/refs/heads/main] 对照测试
# 2C: linked worktree（allowWrite=[linked-wt, main-repo/.git/worktrees/linked-wt, main-repo/.git/objects]）对照测试
```

**原始输出摘录：**
```json
{
  "uid": 0,
  "pid": 7,
  "results": [
    { "name": "oob_write_opt", "ok": false, "code": "EROFS" },
    { "name": "oob_write_root", "ok": false, "code": "EROFS" },
    { "name": "oob_write_tmp", "ok": false, "code": "EROFS" },
    { "name": "git_ref_main_write", "ok": false, "code": "EROFS" },
    { "name": "git_ref_lock_create", "ok": false, "code": "EROFS" },
    { "name": "cred_dir_list", "ok": true, "detail": [] },
    { "name": "cred_file_read", "ok": false, "code": "ENOENT" },
    { "name": "worktree_write", "ok": true, "detail": "hello-worktree" },
    { "name": "private_tmp_write", "ok": true, "detail": "hello-tmp" },
    { "name": "child_process_check", "ok": true, "stdout": "{\"child_oob\":\"EROFS\",\"child_cred\":\"ENOENT\",\"child_wt\":\"WRITTEN\"}" }
  ]
}
```
```text
# 能力与嵌套 userns 校验：
CapPrm: 0000000000000000
CapEff: 0000000000000000
CapBnd: 0000000000000000
unshare: unshare failed: No space left on device
NESTED_UNSHARE_EXIT=1

# 宿主机核对：
ABSENT_OK: /opt/loom-srt-oob-probe.txt /root/loom-srt-oob-probe.txt /tmp/loom-srt-oob-probe.txt /opt/loom-srt-child-oob.txt .../main.lock
main ref unchanged: 86918655b61999da4858362952f1b88a357b31d5
worktree/agent-ok.txt: hello-worktree | worktree/child-ok.txt: child-ok | private-tmp/agent-tmp.txt: hello-tmp

# 2B 对照（仅文件级 denyWrite=[.../.git/refs/heads/main]）：
{"main":"EROFS","lock":"WRITTEN"}

# 2C 对照（linked worktree，不把 main-repo/.git/refs/heads 放进 allowWrite）：
{"wt_write":"OK","main_ref":"EROFS","main_lock":"EROFS"}
```

**关键细节：**
- `denyWrite` 必须覆盖 `.git/refs/heads` **目录**（或 linked worktree 不挂载主仓 `refs/heads`），否则仅 `denyWrite` 单文件 `.git/refs/heads/main` 时仍可在 `.git/refs/heads/` 下创建 `main.lock`（2B 实测证实）。
- `denyRead` 对目录的实现是 `--tmpfs <dir>` 覆盖，因此 `readdir` 看到空目录 `[]`，读原文件报 `ENOENT`。
- 跳过 `apply-seccomp`（`allowAllUnixSockets: true`）后 `bwrap` 仍保持 `--cap-drop ALL` 与 `--disable-userns`（`unshare -U` 报 `ENOSPC`），但失去了 `socket(AF_UNIX)` 的 seccomp 拦截；宿主机敏感 socket（如 `/var/run/docker.sock`、其他 cell 控制目录）必须用 `denyRead` 遮蔽，或在生产机配好 AppArmor profile 放行 `apply-seccomp` / `bwrap`。

**结论：PASS（需 `allowAllUnixSockets: true`；默认启用 `apply-seccomp` 在 Ubuntu 24.04 AppArmor=1 下为 FAIL）**

---

## 3. 以非 root 运行 srt（既有用户 `sun`, uid=1000）

宿主机已有非 root 用户 `sun`（`uid=1000 gid=1000`），未新建用户，未修改 `/root` 权限，未读写 `/home/sun`；通过瞬态私有 mount namespace（`unshare --mount --propagation private` 临时将试验目录挂到空目录 `/mnt`，命令退出即自动销毁）让 `sun` 实际执行了 `bwrap` 与 `srt@0.0.83`。

**命令：**
```sh
runuser -u sun -- sh -c 'cd / && unshare -Ur id'
runuser -u sun -- sh -c 'cd / && bwrap --ro-bind / / --dev /dev --unshare-user --unshare-pid --proc /proc /bin/true'
runuser -u sun -- sh -c 'cd / && bwrap --ro-bind / / --dev /dev --unshare-user --unshare-net --unshare-pid --proc /proc /bin/true'
unshare --mount --propagation private sh -c '
  mount --bind /root/loom-srt-trial /mnt
  runuser -u sun -- env PATH="/mnt/node/bin:/usr/bin:/bin" HOME="/mnt/t3/sun-home" TMPDIR="/mnt/t3/sun-tmp" \
    sh -c "cd /mnt/t3/sun-wt && /mnt/node/bin/node /mnt/srt/node_modules/.bin/srt -s /mnt/t3/settings.json -- /bin/echo hello-from-sun"
'
```

**原始输出摘录：**
```text
# unshare -Ur id:
unshare: write failed /proc/self/uid_map: Operation not permitted (EXIT=1)

# bwrap --unshare-user:
bwrap: setting up uid map: Permission denied (EXIT=1)

# bwrap --unshare-user --unshare-net:
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted (EXIT=1)

# srt@0.0.83 CLI as sun:
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted (EXIT=1)

# dmesg 内核 AppArmor 审计日志：
audit: ... apparmor="AUDIT" operation="userns_create" class="namespace" info="Userns create - transitioning profile" profile="unconfined" pid=6138 comm="bwrap" requested="userns_create" target="unprivileged_userns"
audit: ... apparmor="DENIED" operation="capable" class="cap" profile="unprivileged_userns" pid=6139 comm="bwrap" capability=8 capname="setpcap"
audit: ... apparmor="DENIED" operation="open" class="file" info="Failed name lookup - disconnected path" error=-13 profile="unprivileged_userns" name="proc/6139/uid_map" pid=6139 comm="bwrap" requested_mask="wr" denied_mask="wr" fsuid=1000 ouid=1000
audit: ... apparmor="DENIED" operation="capable" class="cap" profile="unprivileged_userns" pid=6143 comm="bwrap" capability=12 capname="net_admin"
```

**原因说明：** Ubuntu 24.04 的 `bubblewrap 0.9.0-1ubuntu0.3` 未附带 `/etc/apparmor.d/bwrap` profile；在 `kernel.apparmor_restrict_unprivileged_userns=1` 下，非 root 进程调用 `userns_create` 被 AppArmor 切入 `/etc/apparmor.d/unprivileged_userns`（内含 `audit deny capability`），随即因缺少 `CAP_NET_ADMIN` / `CAP_SETPCAP` 及写 `uid_map` 被拒而失败。

**结论：BLOCKED（在 `apparmor_restrict_unprivileged_userns=1` 下非 root 无法起 userns；已完整实测并捕获原始报错与审计日志）**

---

## 4. 网络隔离、Cell 出口代理与 srt 自带代理处置

在试验目录启动最小 HTTP/CONNECT 代理 `cell-egress-proxy.mjs`（仅监听 `127.0.0.1:37765`，白名单仅 `example.com`，拒绝返回显式 `403` + JSON 体并写 JSONL 日志 `/root/loom-srt-trial/t4/egress.jsonl`）。

### 4.1 实测结果（直连外网 vs 外置 cell 出口代理）

**命令：**
```sh
# settings-ext-proxy.json 同时设置 httpProxyPort=37765 与 socksProxyPort=37765
HOME=/root/loom-srt-trial/t4 TMPDIR=/root/loom-srt-trial/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -s /root/loom-srt-trial/t4/settings-ext-proxy.json -- /bin/sh -c '
    curl -sS --noproxy "*" --connect-timeout 3 https://1.1.1.1
    curl -sS --noproxy "*" --connect-timeout 3 https://example.com
    curl -sS -o /dev/null -w "HTTP_CODE=%{http_code}\n" https://example.com
    curl -sS -o /dev/null -w "HTTP_CODE=%{http_code}\n" http://example.com
    curl -sS -v https://cloudflare.com
    curl -sS -i http://cloudflare.com
    curl -sS --socks5-hostname 127.0.0.1:1080 https://cloudflare.com
  '
```

**原始输出摘录：**
```text
# 1. 直连 IP (1.1.1.1:443, --noproxy "*"):
curl: (7) Failed to connect to 1.1.1.1 port 443 after 0 ms: Couldn't connect to server (EXIT=7)

# 2. 直连域名 (example.com, --noproxy "*"):
curl: (6) Could not resolve host: example.com (EXIT=6)

# 3/4. 经 cell 出口代理访问白名单 example.com (HTTPS & HTTP):
HTTPS: HTTP_CODE=200 (EXIT=0)
HTTP:  HTTP_CODE=200 (EXIT=0)

# 5. 经 cell 出口代理访问非白名单 HTTPS cloudflare.com:
> CONNECT cloudflare.com:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
curl: (56) CONNECT tunnel failed, response 403

# 6. 经 cell 出口代理访问非白名单 HTTP cloudflare.com:
HTTP/1.1 403 Forbidden
Content-Type: application/json
X-Cell-Egress: denied
{"error":"egress_denied","cell":"cell-t4","host":"cloudflare.com","port":80,"reason":"not_in_allowlist"}

# 7. 尝试 SOCKS5 绕过 (socks5h://127.0.0.1:1080 -> cloudflare.com):
curl: (97) Received invalid version in initial SOCKS5 response. (EXIT=97)

# 结构化日志 t4/egress.jsonl 摘录：
{"ts":"2026-11-27T04:51:26.728Z","cell":"cell-t4","method":"CONNECT","host":"example.com","port":443,"decision":"allow","status":200,"reason":"allowlist_match"}
{"ts":"2026-11-27T04:51:27.559Z","cell":"cell-t4","method":"GET","host":"example.com","port":80,"decision":"allow","status":200,"reason":"allowlist_match"}
{"ts":"2026-11-27T04:51:28.051Z","cell":"cell-t4","method":"CONNECT","host":"cloudflare.com","port":443,"decision":"deny","status":403,"reason":"not_in_allowlist"}
{"ts":"2026-11-27T04:51:28.060Z","cell":"cell-t4","method":"GET","host":"cloudflare.com","port":80,"decision":"deny","status":403,"reason":"not_in_allowlist"}
```

### 4.2 srt 自带代理能否关闭或改为只转发到出口代理（3 种模式实测 + 源码核实）

| 模式 | 配置方式 | srt 自带 mux 代理是否启动 | 非白名单 HTTPS 响应 | 非白名单 HTTP 响应 |
|---|---|---|---|---|
| **模式 1（推荐）：完全关闭自带代理，直桥外置 cell 出口代理** | 同时设 `network.httpProxyPort` 与 `network.socksProxyPort` 指向 `127.0.0.1:<CELL_PORT>` | **否**（`sandbox-manager.js:1330` 仅当任一未设时才启 mux；`-d` 日志无 `Mux proxy listening`，直接 `Using external HTTP/SOCKS proxy on port 37765` + 单条 socat 桥） | 显式 `HTTP/1.1 403 Forbidden`（原样透传 cell 代理状态与 JSON） | 显式 `HTTP/1.1 403 Forbidden` + JSON |
| **模式 2：自带代理经 `parentProxy` 转发到出口代理** | 设 `network.parentProxy: { http, https }` 指向 `http://127.0.0.1:<CELL_PORT>` | 是（多一跳 mux 代理） | **坑：被 srt 转译为 `HTTP/1.1 502 Bad Gateway`**（cell 代理日志为 403，但客户端收到 502） | 显式 `HTTP/1.1 403 Forbidden` + JSON |
| **模式 3：仅用 srt 自带代理** | 不设外部端口与 `parentProxy`，用 `allowedDomains: ["example.com"]` | 是 | 显式 `HTTP/1.1 403 host is not on the allow list`（含 `X-Proxy-Error: blocked-by-allowlist`） | 显式 `HTTP/1.1 403 Forbidden`（`Connection blocked by network allowlist`） |

**结论：PASS**

---

## 5'. （追加验收重点）holder 在常驻 srt cell 内

模型：宿主机外 `loomd` 替身 ←(允许共享目录内的 Unix socket `t5p/ctl/cell.sock`)→ 常驻 `srt` 实例根进程 `cell-agent.mjs` → 沙箱内 2 个 PTY holder (`in-cell-pty-holder.py`) → 2 个假 CLI (`fake-cli-incell.py`)。

**命令：**
```sh
# 启动常驻 srt cell（allowWrite 包含 home/wt/ctl，allowAllUnixSockets: true）
HOME=/root/loom-srt-trial/t5p/home TMPDIR=/root/loom-srt-trial/t5p/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -s /root/loom-srt-trial/t5p/settings.json -- \
  /root/loom-srt-trial/node/bin/node /root/loom-srt-trial/scripts/cell-agent.mjs \
  /root/loom-srt-trial/t5p/ctl/cell.sock cell-5p h1,h2 &

# 宿主机外部 loomd-stub #1：连接、收发数据、resize h1 (80x24 -> 120x40)、断开退出
node /root/loom-srt-trial/scripts/loomd-stub.mjs /root/loom-srt-trial/t5p/ctl/cell.sock phase1
sleep 0.5
# 宿主机外部 loomd-stub #2（新进程）：重连验证 PID 不变并继续收发
node /root/loom-srt-trial/scripts/loomd-stub.mjs /root/loom-srt-trial/t5p/ctl/cell.sock phase2
```

**原始输出摘录：**
```text
CELL_AGENT_READY cell=cell-5p pid=7 sock=/root/loom-srt-trial/t5p/ctl/cell.sock
srwxr-xr-x 1 root root 0 Nov 27 12:55 /root/loom-srt-trial/t5p/ctl/cell.sock
```
```json
// Phase 1 (loomd-stub #1, host pid=11807):
{
  "phase": "phase1",
  "loomdStubPid": 11807,
  "cellAgentPid": 7,
  "h1": {
    "holderPid": 14, "cliPid": 16, "pty": "/dev/pts/0",
    "initBuf": "CLI_READY[cell-5p:h1] pid=16 isatty=True/True devTty=OK size=80x24 color=\u001b[32mOK\u001b[0m\r\n"
  },
  "h2": {
    "holderPid": 15, "cliPid": 17, "pty": "/dev/pts/1",
    "initBuf": "CLI_READY[cell-5p:h2] pid=17 isatty=True/True devTty=OK size=80x24 color=\u001b[32mOK\u001b[0m\r\n"
  },
  "pingH1": "PONG[cell-5p:h1] pid=16 payload=from-loomd-1",
  "pingH2": "PONG[cell-5p:h2] pid=17 payload=from-loomd-1",
  "resizeWinchH1": "WINCH[cell-5p:h1] count=1 size=120x40",
  "sizeQueryH1": "SIZE[cell-5p:h1] 120x40 winch=1"
}

// Phase 2 (loomd-stub #2 独立新进程, host pid=11815, 重连同一 cell.sock):
{
  "phase": "phase2_reconnected",
  "loomdStubPid": 11815,
  "cellAgentPid": 7,
  "h1": { "holderPid": 14, "cliPid": 16, "pty": "/dev/pts/0", "alive": true },
  "h2": { "holderPid": 15, "cliPid": 17, "pty": "/dev/pts/1", "alive": true },
  "pingH1": "PONG[cell-5p:h1] pid=16 payload=after-loomd-restart",
  "pingH2": "PONG[cell-5p:h2] pid=17 payload=after-loomd-restart"
}
```

**关键发现：**
- `bwrap --dev /dev` 在沙箱内提供独立 `devpts`，沙箱内分配 PTY（`/dev/ptmx` → `/dev/pts/0`, `/dev/pts/1`）完全正常，假 CLI 内 `devTty=OK`、颜色正常，且 `TIOCSWINSZ` **原生自动触发 `SIGWINCH`**（彻底规避了“holder 在沙箱外”模式下 `bwrap --new-session` 吃掉 `SIGWINCH` 的问题，见附录原第 5 项）。
- 宿主机 `loomd-stub` 退出重启后重连，cell 内 `cellAgentPid=7`、两个 holder (`14, 15`) 与两个假 CLI (`16, 17`) PID 全部不变，双向 I/O 立即恢复。
- **架构注意：** cell 内进程主动 `bind/listen` 创建控制 Unix socket 需要放行 `socket(AF_UNIX)`（即 `allowAllUnixSockets: true`，或由宿主机预先 `bind` 后以继承 fd 传入）。

**结论：PASS**

---

## 6'. （追加验收重点）单机多 cell 证明

同时运行两个常驻 cell（Cell A 与 Cell B），各自独立 `HOME`、独立 `worktree`、独立控制 Unix socket、独立出口代理（Proxy A 仅放 `example.com`，Proxy B 仅放 `example.org`），分别用 **6'A（常驻 `srt` 实例）** 与 **6'B（直调 `bwrap` 补齐 UTS/machine-id）** 做双向实测证明。

### 6'A：两个常驻 `srt@0.0.83` 实例并行（Cell A vs Cell B）

**命令：**
```sh
# 并发启动 Proxy A (127.0.0.1:42343, example.com) 与 Proxy B (127.0.0.1:37247, example.org)
# 并发启动常驻 srt Cell A (denyRead=[cell-b], httpProxyPort=socksProxyPort=PA) 与 Cell B (denyRead=[cell-a], PB)
# 外部 loomd-rpc.mjs 分别经 cell-a/ctl/cell.sock 与 cell-b/ctl/cell.sock 在两个 cell 内执行 multicell-audit.mjs
```

**原始输出摘录：**
```json
// Cell A (cell-a-srt) 实测摘要：
{
  "cell": "cell-a-srt",
  "HOME": "/root/loom-srt-trial/t6p_srt/cell-a/home",
  "hostname": "yt1", "hostnameMatchesHost": true,
  "machineIdMatchesHost": true, "machineIdPreview": "<SAME_AS_HOST>",
  "ownHomeRead": { "ok": true, "val": "SECRET_HOME_A" },
  "ownWorktreeWrite": { "ok": true, "val": "WRITTEN" },
  "peerHomeRead": { "ok": false, "code": "ENOENT" },
  "peerHomeWrite": { "ok": false, "code": "ENOENT" },
  "peerWtRead": { "ok": false, "code": "ENOENT" },
  "peerWtWrite": { "ok": false, "code": "ENOENT" },
  "peerProxyTcpConnect": { "ok": false, "code": "ECONNREFUSED" },
  "peerCtlSockConnect": { "ok": false, "code": "ENOENT" },
  "peerBridgeTmpList": { "ok": false, "code": "ENOENT" },
  "allowEgressCurl": { "host": "example.com", "exit": 0, "httpCode": "200" },
  "denyEgressCurl": { "host": "example.org", "exit": 56, "stderr": "curl: (56) CONNECT tunnel failed, response 403" },
  "psProcessCount": 11,
  "seesDockerOrSshdInPs": false,
  "peerHostPidVisible": false
}
```
```text
# 宿主机核对 & 代理日志：
CLEAN_ABSENT: cell-b/home/pwn.txt, cell-b/wt/pwn.txt, cell-a/home/pwn.txt, cell-a/wt/pwn.txt
proxy-a.jsonl: CONNECT example.com -> allow 200; CONNECT example.org -> deny 403 (0 条来自 cell-b)
proxy-b.jsonl: CONNECT example.org -> allow 200; CONNECT example.com -> deny 403 (0 条来自 cell-a)
```

**srt@0.0.83 缺失配置核实（源码 `dist/sandbox/sandbox-config.d.ts` 与 `dist/sandbox/linux-sandbox-utils.js`）：**
- `linux-sandbox-utils.js` 仅向 `bwrapArgs` 推入 `--unshare-net`、`--unshare-pid`、`--unshare-user`，**缺少 UTS 命名空间与主机名配置**（无 `--unshare-uts` / `--hostname` 字段）。
- `FilesystemConfigSchema` 仅支持 `denyRead`/`allowRead`/`allowWrite`/`denyWrite`，**缺少任意源→目标只读文件覆写绑定**（如 `--ro-bind <cell-machine-id> /etc/machine-id`）。
- 因此**不同 hostname / `/etc/machine-id` 视图需要直接调用 bwrap**。

### 6'B：两个常驻 `bwrap 0.9.0` 实例并行（补齐 `--unshare-uts --hostname` 与 `--ro-bind .../machine-id /etc/machine-id`）

**命令（Cell A 示意，Cell B 对称）：**
```sh
bwrap --new-session --die-with-parent \
  --unshare-net --unshare-pid --unshare-user --unshare-uts \
  --hostname cell-a-box \
  --cap-drop ALL --disable-userns \
  --ro-bind / / \
  --ro-bind /root/loom-srt-trial/t6p_bwrap/cell-a/machine-id /etc/machine-id \
  --bind /root/loom-srt-trial/t6p_bwrap/cell-a/home /root/loom-srt-trial/t6p_bwrap/cell-a/home \
  --bind /root/loom-srt-trial/t6p_bwrap/cell-a/wt /root/loom-srt-trial/t6p_bwrap/cell-a/wt \
  --bind /root/loom-srt-trial/t6p_bwrap/cell-a/ctl /root/loom-srt-trial/t6p_bwrap/cell-a/ctl \
  --bind "$BR_A" "$BR_A" \
  --tmpfs /root/loom-srt-trial/t6p_bwrap/cell-b \
  --dev /dev --proc /proc \
  --setenv HOME /root/loom-srt-trial/t6p_bwrap/cell-a/home \
  --setenv HTTP_PROXY http://127.0.0.1:3128 --setenv HTTPS_PROXY http://127.0.0.1:3128 \
  -- /usr/bin/bash -c "socat TCP4-LISTEN:3128,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:${BR_A} >/dev/null 2>&1 & exec /root/loom-srt-trial/node/bin/node /root/loom-srt-trial/scripts/cell-agent.mjs ${SOCK_A} cell-a-bwrap h1"
```

**原始输出摘录（Cell A 与 Cell B 双向实测）：**
```json
// 外部 loomd-rpc.mjs 同时管理两个常驻 bwrap cell：
// Cell A status: agentPid=2, hostname="cell-a-box", h1={holderPid:10, cliPid:11, pty:"/dev/pts/0", devTty:"OK"}
// Cell B status: agentPid=2, hostname="cell-b-box", h1={holderPid:10, cliPid:11, pty:"/dev/pts/0", devTty:"OK"}

// Cell A 审计结果：
{
  "cell": "cell-a-bwrap",
  "HOME": "/root/loom-srt-trial/t6p_bwrap/cell-a/home",
  "hostname": "cell-a-box",
  "machineId": "11111111111111111111111111111111",
  "hostnameDiffFromHost": true, "machineIdDiffFromHost": true,
  "ownHomeRead": { "ok": true, "val": "SECRET_BWRAP_A" },
  "ownWtWrite": { "ok": true, "val": "WRITTEN" },
  "peerHomeRead": { "ok": false, "code": "ENOENT" },
  "peerHomeWrite": { "ok": false, "code": "ENOENT" },
  "peerWtRead": { "ok": false, "code": "ENOENT" },
  "peerWtWrite": { "ok": false, "code": "ENOENT" },
  "peerProxyTcpConnect": { "ok": false, "code": "ECONNREFUSED" },
  "peerCtlSockConnect": { "ok": false, "code": "ENOENT" },
  "allowEgressCurl": { "host": "example.com", "exit": 0, "httpCode": "200" },
  "denyEgressCurl": { "host": "example.org", "exit": 56, "stderr": "curl: (56) CONNECT tunnel failed, response 403" },
  "psCount": 7,
  "psComms": ["1 0 bwrap", "2 1 node", "3 2 socat", "10 2 python3", "11 10 python3", "13 2 node", "20 13 ps"],
  "seesPeerInPs": false, "seesHostDaemonInPs": false, "peerHostPidVisible": false
}

// Cell B 审计结果（完全对称）：
{
  "cell": "cell-b-bwrap",
  "HOME": "/root/loom-srt-trial/t6p_bwrap/cell-b/home",
  "hostname": "cell-b-box",
  "machineId": "22222222222222222222222222222222",
  "hostnameDiffFromHost": true, "machineIdDiffFromHost": true,
  "ownHomeRead": { "ok": true, "val": "SECRET_BWRAP_B" },
  "ownWtWrite": { "ok": true, "val": "WRITTEN" },
  "peerHomeRead": { "ok": false, "code": "ENOENT" },
  "peerHomeWrite": { "ok": false, "code": "ENOENT" },
  "peerWtRead": { "ok": false, "code": "ENOENT" },
  "peerWtWrite": { "ok": false, "code": "ENOENT" },
  "peerProxyTcpConnect": { "ok": false, "code": "ECONNREFUSED" },
  "peerCtlSockConnect": { "ok": false, "code": "ENOENT" },
  "allowEgressCurl": { "host": "example.org", "exit": 0, "httpCode": "200" },
  "denyEgressCurl": { "host": "example.com", "exit": 56, "stderr": "curl: (56) CONNECT tunnel failed, response 403" },
  "psCount": 7,
  "seesPeerInPs": false, "seesHostDaemonInPs": false, "peerHostPidVisible": false
}
```

| 6' 逐项证明矩阵 | 常驻 `srt@0.0.83` (6'A) | 直调 `bwrap 0.9.0` (6'B) |
|---|---|---|
| A 读/写不到 B 的 HOME 与 worktree（及对称） | **PASS**（`ENOENT`） | **PASS**（`ENOENT`） |
| A 连不到 B 的出口代理与 B 的控制 socket（及对称） | **PASS**（`ECONNREFUSED` / `ENOENT` + 代理日志互不串流） | **PASS**（`ECONNREFUSED` / `ENOENT` + 代理日志互不串流） |
| A 内 `ps` 看不到 B 的进程及宿主机进程（PID 命名空间） | **PASS**（仅见自身 11 进程，`peerHostPidVisible=false`） | **PASS**（仅见自身 7 进程，`seesPeerInPs=false`） |
| A、B 看到不同 `hostname` 与 `/etc/machine-id` | **FAIL**（srt 缺 `--unshare-uts`/`--hostname` 及 `/etc/machine-id` 只读覆写配置） | **PASS**（`cell-a-box`/`1111...` vs `cell-b-box`/`2222...`） |

**结论：PASS（单机多 cell 全部 4 类隔离已证实；若要 per-cell `hostname`/`/etc/machine-id`，需直接调用 bwrap，因 srt 缺少对应配置）**

---

## 6''. （追加验收重点）cell 内 worker 之间使用 Landlock 隔离

在**单一** `srt` cell 内（`allowWrite` 同时放开 `t6pp/wt-1` 与 `t6pp/wt-2`，沙箱内 `CapEff=0`、`CapBnd=0`、`unshare -U` 被禁用），用系统自带 Python 3 `ctypes` 直接调用内核 Landlock ABI v4 系统调用（`SYS_landlock_create_ruleset=444`, `SYS_landlock_add_rule=445`, `SYS_landlock_restrict_self=446`，无需新命名空间、无需任何特权、无需安装编译器或额外包），为 Worker 1 仅开放 `wt-1` 读写、为 Worker 2 仅开放 `wt-2` 读写。

**命令：**
```sh
HOME=/root/loom-srt-trial/t6pp/home TMPDIR=/root/loom-srt-trial/t6pp/tmp \
  /root/loom-srt-trial/srt/node_modules/.bin/srt -s /root/loom-srt-trial/t6pp/settings.json -- /bin/sh -c '
    grep -E "^(CapEff|CapBnd):" /proc/self/status
    unshare -U /bin/true 2>&1 || echo userns_blocked_as_expected=true
    # 无 Landlock 基线：同一 cell 可写 wt-1 与 wt-2
    echo baseline-ok > /root/loom-srt-trial/t6pp/wt-1/cell-baseline.txt
    echo baseline-ok > /root/loom-srt-trial/t6pp/wt-2/cell-baseline.txt
    # Worker 1: Landlock 仅放行 wt-1 读写
    python3 /root/loom-srt-trial/scripts/landlock-exec.py --ro "$RO_BASE" --rw "/dev,.../wt-1" -- node worker-landlock-probe.mjs w1 .../wt-1 .../wt-2 .../wt-2/seed-w2.txt
    # Worker 2: Landlock 仅放行 wt-2 读写
    python3 /root/loom-srt-trial/scripts/landlock-exec.py --ro "$RO_BASE" --rw "/dev,.../wt-2" -- node worker-landlock-probe.mjs w2 .../wt-2 .../wt-1 .../wt-1/seed-w1.txt
  '
```

**原始输出摘录：**
```text
CapEff: 0000000000000000
CapBnd: 0000000000000000
unshare: unshare failed: No space left on device
userns_blocked_as_expected=true
baseline_both_wt_writable=true
```
```json
// Worker 1 (Landlock: RW 仅 wt-1):
{
  "worker": "w1",
  "ownWrite": { "ok": true, "val": "WRITTEN" },
  "peerWrite": { "ok": false, "code": "EACCES" },
  "peerRead": { "ok": false, "code": "EACCES" },
  "grandchild": { "own": "WRITTEN", "peer": "EACCES" },
  "stackedLandlock": { "sub": "WRITTEN", "parent": "EACCES" }
}
// Worker 2 (Landlock: RW 仅 wt-2):
{
  "worker": "w2",
  "ownWrite": { "ok": true, "val": "WRITTEN" },
  "peerWrite": { "ok": false, "code": "EACCES" },
  "peerRead": { "ok": false, "code": "EACCES" },
  "grandchild": { "own": "WRITTEN", "peer": "EACCES" },
  "stackedLandlock": { "sub": "WRITTEN", "parent": "EACCES" }
}
```
```text
# 宿主机核对文件清单（无任何 pwn-* 跨 worktree 写入文件）：
.../wt-1/{cell-baseline.txt, child-w1.txt, from-w1.txt, seed-w1.txt, sub/stacked-w1.txt}
.../wt-2/{cell-baseline.txt, child-w2.txt, from-w2.txt, seed-w2.txt, sub/stacked-w2.txt}
```

**结论：PASS**（同 cell 内无需 userns、无需特权，Landlock ABI v4 原生可用，worker 间互写/互读被拒 `EACCES`，子进程自动继承且可继续二层叠加收窄）

---

## 7. 开销（20 次启动耗时中位数 + 16 并发沙箱内存/CPU）

**命令：**
```sh
python3 /root/loom-srt-trial/scripts/bench-t7.py "$PORT_T7"
# 依次测：
# 1) srt(外置代理) + fake Node CLI (`node -e 'process.exit(0)'`) × 20 次
# 2) srt(自带代理) + fake Node CLI × 20 次
# 3) srt(外置代理) + `/bin/true` × 20 次
# 4) 同时启动 16 个常驻 srt + fake Node CLI 会话，稳定后采 /proc/<pid>/smaps_rollup (RSS/PSS) 与 2s CPU delta
```

**原始输出摘录：**
```json
// 20 次启动耗时（ms，已做 1 次预热）：
{"bench": "srt(ext-proxy)+fake-node-cli",     "n": 20, "median_ms": 163.23, "mean_ms": 205.76, "min_ms": 137.32, "p95_ms": 289.20, "max_ms": 290.34}
{"bench": "srt(builtin-proxy)+fake-node-cli", "n": 20, "median_ms": 171.10, "mean_ms": 197.37, "min_ms": 154.41, "p95_ms": 292.86, "max_ms": 308.83}
{"bench": "srt(ext-proxy)+bin-true",          "n": 20, "median_ms": 159.55, "mean_ms": 195.28, "min_ms": 133.50, "p95_ms": 278.58, "max_ms": 289.56}

// 16 并发常驻沙箱会话：
// before-16x: loadavg=(0.36 0.09 0.03) MemAvailable=61.42 GiB
// during-16x: loadavg=(0.36 0.09 0.03) MemAvailable=60.82 GiB (实测宿主机可用内存净降 ~614 MiB)
{
  "sessions": 16,
  "boot_all_16_ms": 310.43,
  "total_processes": 176,
  "procs_per_session": 11.0,
  "total_rss_mb": 2336.47,
  "total_pss_mb": 655.16,
  "per_session_rss_mb": 146.03,
  "per_session_pss_mb": 40.95,
  "idle_sandbox_cpu_pct_of_1core": 0.0,
  "host_total_cpu_busy_pct": 0.021,
  "by_comm": {
    "node":  { "count": 32, "rss_mb": 1952.76, "pss_mb": 607.62 },
    "socat": { "count": 48, "rss_mb": 177.19,  "pss_mb": 30.69 },
    "bash":  { "count": 48, "rss_mb": 120.29,  "pss_mb": 10.40 },
    "bwrap": { "count": 32, "rss_mb": 55.96,   "pss_mb": 4.13 },
    "sh":    { "count": 16, "rss_mb": 30.26,   "pss_mb": 2.37 }
  }
}
```

**解读：**
- 启动耗时呈 ~155 ms / ~285 ms 双峰分布，源于 `srt` 轮询等待 `socat` 桥就绪的间隔；外置代理与内置代理中位数相差仅 ~8 ms。
- 16 并发会话总物理内存（PSS）仅 **655.16 MiB**（**40.95 MiB/会话**），其中 32 个 `node` 进程（16 个 `srt` 宿主父进程 + 16 个假 CLI）占 607.62 MiB，纯沙箱进程管道（`bwrap` + `socat` + `sh` + `bash`）仅 **47.59 MiB PSS（约 2.97 MiB/会话）**；若采用 **5' 的单常驻 cell 承载多 holder**，还能进一步省去每 worker 一套 `srt`+`bwrap`+`socat` 常驻进程。

**结论：PASS**

---

## 附录：原第 5、6 项顺带记录（C23 旧假设对照）

### 原 5. PTY holder 在沙箱外（`holder → srt → fake CLI`）
- **命令：** `python3 /root/loom-srt-trial/scripts/pty-holder.py` 与 `pty-holder2.py`（沙箱外 `pty.openpty()`，通过 `srt -s settings.json -- ...` 启动假 CLI 继承 slave fd）。
- **原始输出摘录：**
  ```text
  # Node 假 CLI (pty-holder.py):
  READY isTTY=true/true/true TERM=xterm-256color init=80x24 devTty=false(ENXIO)
  COLOR_DEMO \x1b[31mRED\x1b[0m \x1b[38;5;208mORANGE\x1b[0m \x1b[38;2;0;255;128mMINT\x1b[0m
  PONG hello-from-holder
  AFTER TIOCSWINSZ 40x120 ONLY: async_events='' | size_query='LIVE_SIZE 80x24 winch=0 resize=0'
  AFTER TIOCSWINSZ 50x140 + SIGWINCH to srt: async_events='' | size_query='LIVE_SIZE 80x24 winch=0 resize=0'

  # Python 假 CLI (pty-holder2.py，直接 ioctl TIOCGWINSZ):
  AFTER TIOCSWINSZ 40x120 ONLY: 'PY_SIZE ioctl=120x40 winch=0'
  AFTER FORWARDED SIGWINCH TO CHILD PID: 'PY_SIGWINCH count=1 ioctl=140x50'
  ```
- **结论：FAIL（窗口尺寸自动通知失败；读写与颜色 PASS）** — 因 `srt` 硬编码 `bwrap --new-session` 脱离控制终端（`/dev/tty` 报 `ENXIO`）且 `srt` CLI 仅转发 `SIGINT`/`SIGTERM` 不转发 `SIGWINCH`，导致 Node TUI 拿不到 `SIGWINCH` 且缓存的 `columns/rows` 停留在 `80x24`（仅原生 `ioctl(TIOCGWINSZ)` 看到新尺寸，或需外部向沙箱内子 PID 显式转发 `SIGWINCH`）。相比之下，**5'（holder 在 cell 内）原生无此问题**。

### 原 6. 基础多 cell 机制（非持久化双 srt 实例）
- Cell A (`example.com`) 与 Cell B (`example.org`) 并发运行：互读 HOME/tmp Unix socket 均 `ENOENT`，互连对方 TCP 代理端口均 `ECONNREFUSED`，各自出口代理互不串流；`hostname`/`/etc/machine-id` 不受 `srt` 支持（**需要直接调用 bwrap**）。已由 **6'** 完整覆盖。
- **结论：PASS（hostname/machine-id 需要直接调用 bwrap）**

---

STATUS: done
