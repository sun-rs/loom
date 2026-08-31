# ADR-0017：持久化 loopback 本地工作台

状态：Accepted（production Web build / persistent state / same-origin gateway / fake CLI + real Chrome E2，2026-08-27）

## 背景

开发期 `run-local-cli-web-fixture.mjs` 使用临时目录和 Vite proxy，退出后删除数据库。它适合交互核对，不是用户可长期使用的入口。直接把 Human PAT 写入生产 bundle、URL、Local Storage 或浏览器可读 cookie 同样不可接受；把该 proxy 监听到局域网还会把本机 Human authority 暴露给未配对设备。

## 决策

1. `npm run start:local-workbench` 构建 production Web bundle，并启动独立于浏览器窗口的 loopback daemon + static gateway。关闭或重载页面不停止 AgentHost；终止工作台进程会优雅 drain，数据不删除。
2. 默认状态位于 macOS `~/Library/Application Support/RAH OS/state`；`RAH_OS_HOME` 只允许显式覆盖根目录。首次引导在同父目录 staging 后原子 rename；既有但缺少合法 metadata 的目录 fail closed，不覆盖未知数据。
3. `room.db`、Runtime Registry、Human/Host credential、Workspace/Room/Agent identity 全部跨重启保留。状态目录为 `0700`，secret/metadata 为 `0600`；重启时重新认证并核对 Workspace、Room、Host ID 与 bootstrap participant scope。
4. 首次引导只为已探测的受支持本机 CLI 建立真实 RuntimeProfile 与长期 Agent。后续 UI 创建的动态 Agent 扩展同一 Host credential scope；daemon config 的 bootstrap participants 仍只是合法子集。
5. 浏览器只访问 `http://127.0.0.1:<port>`。gateway 检查精确 Host，拒绝未知 API 前缀；index navigation 发行随机 `HttpOnly; SameSite=Strict` 会话 cookie，非安全方法还必须带精确 same-origin `Origin`。gateway 校验会话后才在 server side 覆盖 Authorization 为 Human PAT。
6. 本 gateway 不提供 LAN bind。临时 iPhone/LAN fixture 仍不得用于产品；正式 HTTPS LAN edge、设备 pairing 与可撤销 session 已由 ADR-0019 的独立 gateway 实现，不能反向放宽本 loopback gateway。
7. Runtime 自动化测试只使用 fake executable。安装过的真实 CLI 在启动时只做 identity/version 和机器可读 model catalog probe；目录命令不会发送模型请求。只有用户把 Agent 加入 Room 并发送工作后才会实际运行并可能消耗 Provider 额度。
8. macOS source-checkout operator 现在可以把同一 runner 作为 per-user LaunchAgent staging/activation：plist 固定非 secret 环境、Node/runner/PATH/Workspace/Home，runner 带 SHA-256/size preflight，Web build 在任何 launchctl mutation 前验证，staging 原子发布；activation 还必须取得 `/_rah/health` 的精确、无业务内容证明。已加载服务和不同 staged plist 都要求各自显式 replace flag。公开卸载先证明服务 unloaded 再移除 plist，默认保留 Room/Agent/TLS 数据；只有单独的 `--purge-data` 才删除经 owner-private 校验的 Core 根目录。
9. 正式制品路径复用 pinned official Node carrier，构建单一 Local Core SEA；Core service、Worker CLI 和 process supervisor 由同一二进制的严格子命令分发。Web/PWA 静态资源与逐文件 SHA-256 manifest 同目录发布，installer 在形成 launchd plan 前核验二进制和全部资源。此路径不依赖 source checkout、TypeScript、`node_modules` 或仓库脚本；默认 ad-hoc codesign 只证明构建闭环，不替代 Developer ID/notarization。
10. 客户试用路径由同一已核验 SEA 内置 `install --quick-start`：它只接受一个独立的显式授权，要求至少一个可用且已登录的受支持 CLI，创建 owner-private `~/RAH OS Workspace`，固定 loopback edge 并激活 per-user LaunchAgent。它不开放 LAN、不猜测任意现有目录，也不替代高级 staged/LAN 安装合同。
11. SEA 自身提供 `install`/`uninstall` operator；客户机安装不再调用仓库脚本。launchd bootstrap 后必须在覆盖 CLI 冷启动探测与 label throttle 的 60 秒窗口内取得精确 gateway health；失败必须自动 bootout 新实例，不能留下 `KeepAlive` 重启循环。模型目录属于可选能力证据：瞬时探测失败时 Runtime 只允许 Provider 默认模型，不能伪造 model/effort 参数，也不能拖垮其他可用 Runtime。

## 已有证据

### 2026-08-31：产品静态资源隔离与固定版本

`apps/web/build-output.ts` 是输出路径的唯一 owner：普通 `build:web` 写 `dist`；可信代理产品 `build:web:workbench` 写 `dist-workbench`。两者均产生 Vite manifest，前者不得覆盖后者。此前已运行的旧 runner 仍读取共享 `dist`，不受此代码变更自动保护；正式进程是否升级必须单独验证。

`scripts/workbench-web-assets.mjs` 在 runner 启动前读取、校验并冻结逐文件 bytes，发布到 `.workbench-web/<sha256>`；loopback/LAN runner 只使用该目录。已设置 `RAH_WEB_STATIC_DIRECTORY` 时从指定版本冻结，不回退到最新 mutable build。source installer 固定这一路径；SEA 打包在耗时二进制构建前固定同一份输入，结束时不重新读 mutable build。

校验涵盖 HTML/CSS 引用及存在 manifest 时的静态/动态依赖闭合；拒绝非普通文件、缺失资源及被篡改的既有快照。旧无 manifest 输入只具备较弱的 HTML/CSS 校验。冻结不构成针对同一 OS 用户的安全隔离，采集期间也未实现跨进程构建锁；不能将 hash 自身当成完整发布、签名或并发构建证明。

对应方案及独立证据：[补强设计](../product/2026-08-31-parity-reinforcement-plan.zh-CN.md)、[源码复审](../audits/2026-08-31-parity-reinforcement-source-review.zh-CN.md)。普通构建测试通过不等于旧正式进程已切换；重启仍需授权、任务检查、一致性备份及新页验收。

### 2026-08-30：启动时的 RuntimeProfile / Offer 修订迁移

旧 runner 的 `local-workbench-offer-<cli>` 在 Profile 更新后仍被复用，违反 Kernel 的 Offer 不可变身份合同，曾导致实际旧库无法启动。`local-workbench-runtime-bindings.ts` 现在是该引导迁移的唯一 owner：

- 每个 Offer ID 加上已激活的 RuntimeProfileRevision ID；旧 Offer/observation 不改写，Kernel 冲突校验不放宽。
- 只替换当前本机 Workspace 中、精确引用本引导器已知旧 Offer 的 `required.allowedOfferIds` 和 `preferred.runtime_offer`。不按字符串前缀猜测远程 Offer。
- 使用 Kernel 的 `policy.revised` 和 `agent.revised` 追加后继版本。保持人设、记忆引用、model/effort、工具权限、其他约束和未管理 Offer 不变；已冻结的 Placement/RunAttempt 不改写。若所选模型已不被新版 Runtime 支持，仍由 Placement 拒绝，不能静默换模型。
- 稳定幂等键允许策略和 Agent 两笔事务之间的失败重试；重复启动无变化则不追加迁移。此路径用于已停止旧实例之后的正常启动，不是运行中的热切换。
- 首次引导产生的临时旧格式策略同样通过该 owner 转为 revision-bound 引用；metadata/credential/Agent identity 不另建一套。

回归覆盖旧库 Offer 已发布、Profile 升级、个性配置/历史保留、旧 Offer 仍拒绝被新版覆盖、新 Offer 可发布以及重复启动不重复迁移。正式启动前保存 SQLite 一致性备份；本次上线事实见对应交付审计。

- bootstrap test：同一 credential、Workspace、Room、AgentDefinition/Policy、RuntimeProfile 和 Message 在第二次 prepare 后保持不变，workspace 错配 fail closed；
- gateway test：PAT 不进入浏览器，缺 cookie、错误 Host、跨 origin mutation、未知 API route 被拒绝；
- `npm run test:web:workbench`：production bundle 通过真实 Chrome 打开且不显示 token 输入；fake Codex 发布 probe-backed model binding，Agent 保存模型/推理配置后，Placement 将其变成实际 child argv，再进入真实 AgentHost lane并发 canonical Room reply；进程重启后同一 Agent/Room/Message/Policy 恢复，并在 390×844 无横向溢出。

## 未由本 ADR 完成

- Developer ID 签名/公证安装包、Keychain 与自动升级；immutable Core SEA 和 `sourceBound: false` LaunchAgent 路径已经实现，但尚未成为经 Apple 公证的客户安装包；
- LAN 证书自动签发/信任安装、设备管理 React UI 与真实 iOS PWA gate（HTTPS pairing edge 本身见 ADR-0019）；
- skill/memory ContextManifest、显式 execution restart/session reset；
- loopback gateway 自己不拥有 PWA 生命周期；共享 manifest/service worker 与正式 HTTPS gate 见 ADR-0019。

因此本 ADR 建立的是“可持续使用、数据不丢、浏览器无 PAT，并可显式常驻的本机 production Web 入口”，不是已经签名安装或与 Raft 全功能等价的发布包。
