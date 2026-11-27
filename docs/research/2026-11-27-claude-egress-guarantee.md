# Claude Code 出口保证调研(2026-11-27)

目标:Claude 进程树只能经 http://127.0.0.1:17891 出网,即使 env 缺失也不泄漏。只调研,不实施。
来源:code.claude.com/docs/en/network-config(2026-11-27 抓取);github.com/anthropic-experimental/sandbox-runtime README(只读到前 100k 字符);其余 macOS 条目来自通用知识,标 [未验证]。

## 1. macOS 机制对比
| 机制 | 强度 / 子进程 | 配置与系统改动 | 运维成本 |
|---|---|---|---|
| Seatbelt `sandbox-exec` profile:`(deny network*)` + `(allow network-outbound (remote ip "localhost:17891"))` | 内核强制,随进程树继承,子进程不能摘除(除非有 Apple Events/`open` 逃逸,见下)。不需 root、不需新用户 | 启动器在 claude 前加 `sandbox-exec -f profile`;零系统改动。sandbox-exec 已标 deprecated 但仍可用 [未验证未来版本] | 低;需放行文件系统(profile 要写全,否则 claude 无法跑),需调试 |
| @anthropic-ai/sandbox-runtime(包 Seatbelt) | README:"Seatbelt profile allows communication only to a specific localhost port","restrictions apply to the entire process tree";默认全拒。但它自带 HTTP/SOCKS 代理做域名白名单,上游需 `parentProxy` 指向 17891(parentProxy 是否支持 http 上游 [未验证]) | npm 包,无系统改动 | 中;多一层代理。注意三个逃逸口:`allowLocalBinding`(macOS 可直连任意 loopback 端口,不经代理,默认关)、`allowAppleEvents`(`open` 启动的应用在沙箱外)、`enableWeakerNetworkIsolation`(trustd 外泄通道)。保持默认关闭 |
| pf 防火墙按 user/group | pf `user`/`group` 只能按 socket owner 过滤,需专用 OS 用户 | 用户禁止建 OS 用户 → 排除。pf 也无按进程名规则 | -- |
| Network Extension 内容过滤(LuLu / Little Snitch) | 按可执行文件路径/签名,内核级 NE,强;规则按 app 而非进程树(子进程是不同二进制则需各自规则;node/bash 被复用时会误伤或漏放)[未验证] | 装第三方 app + 系统扩展授权(系统改动) | 中高;规则 "claude 只能到 127.0.0.1:17891",其余拒;不防 env 缺失导致的"走 loopback 以外"以外的问题,但能拦住直连 |
| TUN VPN 客户端按进程规则(mihomo `PROCESS-NAME`/`PROCESS-PATH`) | 弱到中:这是路由而非防火墙。规则可 REJECT claude 二进制的非代理流量,但 TUN 下 loopback 17891 流量本身不进 TUN;原生 claude 直连被 TUN 捕获后可被规则 REJECT。VPN 掉线/规则漏匹配/改名二进制/子进程(node、curl、git)则 fail-open [未验证 PROCESS 匹配对子进程的行为] | 只改 VPN 配置,不碰系统 | 低;fail-open 风险,适合作"第二层告警/拒绝",不是保证 |
| macOS 应用防火墙(ALF) | 只管入站,不管出站,无效 | -- | -- |

## 2. Claude Code 如何处理代理(文档原文要点)
- 支持 `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`,优先级 https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY;不支持 SOCKS。
- 所有变量亦可放 settings.json 的 `env` 块;但若启动环境已设同名变量,settings 文件值被忽略(以启动 env 为准)。
- `NODE_EXTRA_CA_CERTS` 追加 CA;默认同时信任内置 Mozilla 与系统证书库。
- 文档明确:WebSocket 到 localhost/::1/127.0.0.0/8 永不走代理(只影响本地,与出网无关)。
- 文档称 OAuth 刷新(platform.claude.com)、MCP 登录("applies your proxy, CA ... variables to the sign-in requests")、WebFetch 预检(api.anthropic.com)、遥测(Datadog)、下载/自更新(downloads.claude.ai)都列在需放行的 URL 表内,文档未声明任何绕过 HTTPS_PROXY 的部分。**但文档没有保证"所有组件都遵守代理",是否有绕过为 [未验证]**(如 stdio MCP 子进程、用户 Bash 工具里的 curl/git/npm 本就由各自行为决定,不受 Claude 控制)。
- 后台 agent:supervisor 进程跨终端共享,继承首个启动它的 shell 的 env;文档建议把代理变量写进 `~/.claude/settings.json` 的 env,而非 shell export。(与 loom 相关:这是另一条"env 丢失"路径。)
- 文档有 `processWrapper` 设置 / `CLAUDE_CODE_PROCESS_WRAPPER`(corporate-launcher 页):让 supervisor 及后台进程都经过指定启动器(可做沙箱/网络控制)。这正是把 sandbox-exec 或 CCP wrapper 强制套在所有进程上的官方钩子。细节页未读 [未验证]。
- 可减少出口面:`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`ENABLE_CLAUDEAI_MCP_SERVERS=false`。

## 3. Linux(未来 cell)三行
1. 网络命名空间/容器 `--network=none`,不带任何路由,进程天然无法出网。
2. 唯一出口:挂载宿主 unix socket(或 veth 仅到代理),容器内 socat 把 127.0.0.1:17891 转发到该 socket;env 缺失则直接连接失败(fail-closed)。
3. 额外可加 nftables 只放行代理地址;即使启动器有 bug,也不会泄漏。

## 4. 建议(供用户选择,不实施)
- 选项 A(最便宜且强):在 CCP wrapper 之外,由 loom 启动 claude 时用 Seatbelt profile 包一层(`sandbox-exec`,仅 allow 到 localhost:17891,其余 deny)。不建用户、不改 CCP 目录、不改系统;内核强制,env 缺失时直接连接失败而非走 TUN。可经 `processWrapper` 覆盖后台进程。代价:需调试文件系统放行 profile。
- 选项 B:直接用 sandbox-runtime,默认关闭 allowLocalBinding/allowAppleEvents;多一层代理,需要 parentProxy 接 17891 [未验证]。
- 选项 C(叠加防线):在 mihomo 加 PROCESS-PATH 规则对原生 claude 二进制 REJECT(仅作告警/兜底,fail-open)。
- 选项 D:LuLu/Little Snitch 按 app 规则,强但需装系统扩展。
- 排除:pf(需 OS 用户)、ALF(无效)。
- 先决:不建议单靠软件修复;最小组合 = 软件修复 + A 的 profile,可用最小 profile 先验证(只读试验:`sandbox-exec` 跑 curl 到 1.1.1.1 应失败,到 127.0.0.1:17891 应通)。尚未执行。
