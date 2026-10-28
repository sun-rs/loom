# Tailnet HTTPS 入口修复

2026-10-28。用户报告 `https://100.101.107.87:4178/` 无法访问。

## 根因与修复

诊断时 Tailscale 为 Running/Online，Tailnet HTTP 4176 返回 200；HTTPS 4178 只监听 LAN `192.168.1.86`，Tailnet 对应端口直接拒绝连接，尚未进入 TLS。原有 LAN 叶证书也只含 LAN IP。不是已证实的 VPN、代理或 CLI 问题。

增加显式 `RAH_TAILNET_HTTPS_ORIGIN`，只允许与 `RAH_TAILNET_HOST` 相同的精确地址。复用已有 HTTPS gateway 与原本地 CA，为 Tailnet IP 签发独立叶证书；保留 LAN HTTPS 和三个 HTTP 入口。一个 Core、无设备配对，服务端 Human、Host/Origin 与业务围栏保持。配置写入启动收据，后续重启可复现两个 TLS 入口。

## 验证

- TDD：[修改前失败](red-tests.txt)，随后启动配置、收据回放、额外 TLS、网关与证书 33 项[定向检查通过](green-tests.txt)；另有 1 项 [Core 组合测试](core-tests.txt)。均使用临时状态／假运行时，无付费模型。仓库日志只规范化尾部空白，原日志保留在本机审查目录。
- [类型检查](typecheck.txt)通过；本次无前端修改或 Web 重建。
- 空闲检查、状态在线备份及备份校验后，精确服务 `com.loom.evo` 从 PID 4381 优雅重启至 35175；保留原配置并仅加入新 TLS origin。[部署收据](deployment.json)记录源码哈希、备份位置和原 Web index 哈希，业务事件账本与 CA 公共证书未变。备份含原 plist 和 TLS 私有材料，仅保留本机，不提交仓库。
- 两个 HTTPS origin 均经原 CA 校验：页面/API/Service Worker 200，外来 Origin 403、错误 Host 421，无配对 cookie。三个 HTTP 原入口均 200。
- [本机 Firefox 实际页面](browser-check.json)通过 Tailnet HTTPS 打开，证书由原 CA 验证，计算机页显示本机在线和六种运行时；本次临时标签页已关闭。

部署后首版验证脚本在响应结束后读取已释放的 socket，验证器报错；修正验证脚本时另有一次多余逗号导致语法失败。两次失败保留在本机审查目录，最后仅重跑只读验证成功，没有为此再次重启服务。它们不是产品成功证据，也未当作网络故障。

## 范围

验证的是本机经自身 Tailnet IP 的 TLS、实际页面和既有 API。未声称另一个远端物理设备、全部预览路径或关闭页面后的推送已重新验收；未修改 Tailscale ACL、网络代理或浏览器信任设置。
