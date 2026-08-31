# ADR-0018：launchd 常驻 Computer supervisor 与 K 可替换 service slots

状态：Accepted / implementation in progress（2026-08-28）

## 决策

macOS LaunchAgent 只直接运行一个不参与 K stable/experiment 替换的 constant Computer supervisor。K slot artifact 是 supervisor 的直接子进程，不是 launchd job 本身。

supervisor 是唯一的本机 service-child lifecycle owner：

- 正常启动只从 K `stable` slot 拉起 service；
- coordinator 通过 owner-private、HMAC 认证、enum-only Unix socket 请求 exact PID stop 与指定 slot start；
- planned stop 打开 bounded handoff window，超时则 supervisor fatal 退出，由 launchd 拉起新 supervisor 和 stable；
- service 从 FD 3 读取 owner-private 配置，并监控 FD 4 parent lease；supervisor 被 `SIGKILL` 时 FD 4 EOF，service 必须退出，不能成为 orphan；
- K 继续唯一拥有 WAL、stable/experiment、promotion/rollback 和 terminal outcome；supervisor 不持久化第二套版本或 transaction truth；
- launchd plist 只包含 supervisor config path，不包含 token、attachment credential 或 Server session；
- staging installer 验证 supervisor 与 service artifact 的 signed descriptor size/SHA-256，原子写 0600 配置、bootstrap K stable，最后发布 0644 plist；它不自行调用 `launchctl`。

## 原因

本机 `launchd.plist(5)` 明确要求直接托管的进程不得自行 daemonize 或让父进程退出。若 launchd 直接指向 K stable service，同时 detached coordinator 停止 stable 并启动 experiment，launchd 也会重拉 stable，两个生命周期 owner 将竞争 singleton，正常升级会变成概率性回滚甚至双启动风险。

constant supervisor 使 launchd 只管理一个永不参与 slot handoff 的父进程，K 只管理该父进程下面的可替换 child；FD lease 又把 supervisor crash 转换为 child 的可观察终止。

## 已验证

- supervisor stable → stop → experiment 单 owner 状态机；
- stale PID 与错误 HMAC token fail closed；
- handoff timeout 使 supervisor fatal；
- service 配置只经 FD 3，父环境为空；
- supervisor `SIGKILL` 后 service 因 FD 4 EOF 退出；
- 完整 supervisor process 持有 control socket 并响应 SIGTERM；
- service readiness barrier 阻止未完成 parked/catalog 初始化的进程提供 live attestation 或执行 startup recovery；
- durable parked snapshot 可在 successor startup 前阻止 attachment 重连，显式 release 才重建同一个 catalog manager；
- multi-attachment workload factory 把每个 attachment 组合为独立 bounded Remote AgentHost，同时共享一个 service incarnation；
- Remote RuntimeProfile set 共享 local daemon 的 revision/model/Offer/recovery fence，并将 Provider secret 与 activation-scoped remote Worker lease 组合；
- production service strict config v1 只经 FD3 读取，打开并探测 active RuntimeProfile，绑定 file secret reference、Workspace evidence、attachment catalog 与 K startup recovery，不接受 inline command/env；
- 统一 `rah-os-computer` 内部 dispatch 精确区分 supervisor、service 与 detached upgrade，service 监控 FD4 pipe/socket lease；
- LaunchAgent XML 经 `plutil -lint`；
- installer 在临时目录完成 artifact 验证、0600/0500/0644 权限、K stable bootstrap，且不调用 launchctl。
- provisioning owner 一次生成 plan、service、supervisor 与 upgrade 三份严格配置，并保证 token、socket、state 与配置路径闭包一致；
- shell-free launchctl adapter 已实现 idempotent bootstrap、`kickstart -k` restart 与 bootout，并将 registration 与 service readiness 分开证明；
- SEA release gate 固定官方 Node v26.8.1 darwin-arm64 archive 的 57,813,947 字节与 SHA-256 `6e577fd0d9db776db82306629e441a9dace416702622aebdd171c9dfaa41f4d2`；构建期将统一 CLI 与只含 `node:*` require 的 process supervisor 收敛进同一 artifact，冻结 buildVersion、禁用 `NODE_OPTIONS` 扩展并 ad-hoc codesign；
- 同一 SEA 已实测同时通过 unified CLI、embedded process-supervisor、离线 Ed25519 publisher/consumer round trip、typed installer 与 K stable bootstrap；publisher 要求 owner-private Ed25519 私钥，先持久化不可变 artifact/manifest，再原子单调推进 latest pointer，重复字节幂等而冲突或回滚 fail closed；Homebrew 的 shared Node 明确没有 SEA fuse，不进入发布产物。
- operator install 只接受 owner-private、no-follow、strict schema v1 请求；默认只 staging，`--activate` 才允许 bootstrap 并做 service-level readiness proof，已 loaded 的服务还必须显式 `--replace-loaded`。重复运行会从三份 owner-private 配置恢复完全一致的 capability closure，partial 或与请求冲突的 staged state fail closed；任何 artifact 都在 bootout 前预检。

## 尚未完成

- Developer ID codesign、notarization、生产私钥托管/轮换与 HTTPS artifact/manifest 上传（当前已有 ad-hoc 本机签名、离线 Ed25519 发布器和消费侧验证）；
- 在隔离用户登录域实际执行 launchctl 及 login/reboot/power-loss gate（API 已实现，单元测试不碰用户 live service）；
- 面向 operator 的 uninstall/retain-state/purge-state contract；install/stage/activate 已有 CLI，但尚未在真实用户登录域运行；
- Keychain-backed attachment/supervisor secret 的创建、轮换和撤销；Runtime Provider secret 已可通过固定 `/usr/bin/security` 的有界 shell-free loader 读取；
- attachment/supervisor 的自动 Keychain 写入不得把 secret 放入 `security ... -w <password>` argv。本机 `security` 帮助与隔离临时 keychain 实测确认，安全 prompt 形式要求 `-w` 为最后 option，无法同时把非默认 keychain 作为后置参数；因此正式自动化必须等 Developer ID 身份确定后，由随发行物签名、从 stdin 读取有界 secret 的 Security.framework helper 同时承担读写，不能先落一个进程列表可见的过渡实现；
- 跨机器 pairing、TLS 与可达 Worker HTTPS endpoint。
