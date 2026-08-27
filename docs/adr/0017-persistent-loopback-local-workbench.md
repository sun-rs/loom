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
6. 正式 gateway 不提供 LAN bind。iPhone/LAN 仍是明确不安全的临时 fixture；正式远端访问必须先实现 pairing、TLS、allowed origin、credential rotation/revocation。
7. Runtime 自动化测试只使用 fake executable。安装过的真实 CLI 在启动时只做 identity/version 和机器可读 model catalog probe；目录命令不会发送模型请求。只有用户把 Agent 加入 Room 并发送工作后才会实际运行并可能消耗 Provider 额度。

## 已有证据

- bootstrap test：同一 credential、Workspace、Room、AgentDefinition/Policy、RuntimeProfile 和 Message 在第二次 prepare 后保持不变，workspace 错配 fail closed；
- gateway test：PAT 不进入浏览器，缺 cookie、错误 Host、跨 origin mutation、未知 API route 被拒绝；
- `npm run test:web:workbench`：production bundle 通过真实 Chrome 打开且不显示 token 输入；fake Codex 发布 probe-backed model binding，Agent 保存模型/推理配置后，Placement 将其变成实际 child argv，再进入真实 AgentHost lane并发 canonical Room reply；进程重启后同一 Agent/Room/Message/Policy 恢复，并在 390×844 无横向溢出。

## 未由本 ADR 完成

- launchd、签名/公证安装包、Keychain 与自动升级；
- 正式 LAN/iOS pairing；
- skill/memory ContextManifest、显式 execution restart/session reset；
- PWA manifest/service worker 与离线 shell。

因此本 ADR 建立的是“可持续使用、数据不丢、浏览器无 PAT 的本机 production Web 入口”，不是已经签名安装或与 Raft 全功能等价的发布包。
