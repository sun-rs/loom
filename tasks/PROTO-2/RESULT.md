# PROTO-2 结果

- 协议 v2 直接引用 OAR 类型和源码行号，正文聚焦 loom 的编排扩展。 [协议 v2](../../docs/PROTOCOL-v2.md)
- 索引、持久收件箱、按波搬运和六条命令均给出边界与映射。
- Codex 走 app-server，agy 与 OpenCode 走 ACP，Claude 通过 hc PTY 封装成自建 OAR runtime。
- 区分指定轮中断、跨进程回放、投递证据和最终正文提取的边界。
- 建议 `schema/` 直接导入并重导出 OAR 类型，只定义 loom 扩展。沿用现有 `0.130.1` 锁版本。

STATUS: done
