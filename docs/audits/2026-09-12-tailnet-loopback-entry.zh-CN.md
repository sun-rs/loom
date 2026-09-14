# Tailnet 模式补回本机入口

正式实例只监听 Tailnet IPv4 的 4173 端口，因此 `127.0.0.1:4173` 连接被拒绝。
这是监听配置缺口，不是 Room 数据丢失，也不是本次发现了 daemon 崩溃。

沿用 `LocalWorkbenchGateway`：非 loopback 绑定启动后，再在相同端口启动一个 loopback
入口，指向同一 daemon 与静态目录。两者各自保持 Host/Origin 校验；启动本机入口失败时
回收 Tailnet 入口；停止时关闭两者。未引入 wildcard 监听、配对或第二套业务状态。
这是 RAH 本地部署拓扑修复，Raft 中央服务拓扑不是复用对象。

回归使用 IPv6 loopback 代替测试环境的 Tailnet 接口：缺少本机监听时以 fetch failed 失败；
修复后本机页面、同一 Core API、Tailnet 页面、错误 Host 拒绝以及关闭双入口均通过。
本批保留先前正式冻结 Web 资源，不发布仍在调查的刷新恢复改动。

正式验证：空闲检查、状态备份与 graceful restart 已完成。同一个新进程同时监听两个地址；
Chromium 分别打开两入口，均显示原四个 Agent、非空原频道消息，并通过刷新后消息恢复。
冻结 Web build 仍为 `8408ff18191e2238b503b67726a94c2b3787e094932c51bc8fdc8d9d37840895`。

gateway 测试 6 项通过；类型、Web 单元、格式及 diff 检查通过。全仓检查根测试为 1564 项，
1545 通过、17 跳过、2 失败，仍为既有 interaction sprite hash 和 icon-semantics 列表顺序。
后续 Web 单元、parity regression、formal browser policy、bilateral capture 合同检查单独通过。
本批无付费 CLI 测试，未声称新一次 iOS 5G 或 Raft 双边验收。

后续三入口：启动时显式发现 RFC1918 局域网地址，新增该地址监听，保留 Tailnet 与 loopback。
新正式实例同时监听本机三地址的同一端口；三个页面都经浏览器验证原四个 Agent、历史消息
和刷新恢复。局域网绑定由启动时地址决定，IP 改变需重新启动；不是 wildcard 监听。
