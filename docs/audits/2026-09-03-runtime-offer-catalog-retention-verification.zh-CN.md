# RuntimeOffer、模型目录与探测留存验证审计

日期：2026-09-03

裁决：**本批目标通过；磁盘无界增长和周期 Provider CLI 启动已关闭，常驻内存仍是独立 P1。**

## 1. 范围与来源

- 产品合同：`docs/product/2026-09-03-runtime-offer-catalog-retention-contract.zh-CN.md`；
- Raft：冻结 Computer/Web 发布物只提供 Runtime/Offer 的可见合同，没有可复制的 Server 留存事务；
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`：采用模型/effort 发现缓存、按需刷新和
  last-known-good 的结构，不采用 Issue/PostgreSQL owner；
- RAH OS glue：SQLite schema 43/registry schema 4、当前 lease 与不可变 observation 分离、
  executable metadata heartbeat 和启动前 SHA-256 复核。

因此本批不是伪称“直接复制 Raft Server”。可见语义以 Raft 为合同，后台的本机留存、迁移和
执行安全由 RAH OS 单一 owner 实现。

## 2. 已验证的不变量

| 风险                                 | 修复后的唯一行为                                                       | 证据                                                          |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| 每 30 秒启动 Provider CLI            | heartbeat 只验证 active revision、realpath、regular file、size、X_OK   | 120 秒正式采样每次 child count 都为 0                         |
| 等价 probe 重复保存完整目录          | 内容寻址 payload + report envelope + per-revision validation head      | 34,023 report 只对应 36 payload；连续 heartbeat 不增长        |
| Room 每次续租追加双 JSON             | 能力等价只更新 `runtime_offers` 当前 lease；能力变化才追加 observation | 63 observations / 29 current offers，连续 heartbeat 不增长    |
| 历史 Placement 失去证据              | 只删除非 current 且未被 Placement 引用的 observation                   | 30 placements 可读，broken current/placement 引用均为 0       |
| 轻量探测降低启动安全                 | 真正 spawn 前仍复核冻结 executable SHA-256                             | registry/implementation 单元门禁与 daemon 双 Agent 实进程门禁 |
| 当前 lease 被旧 observation 误判过期 | current query 用 mutable head 覆盖 immutable capability snapshot       | Agent provision/management 与 daemon 双 Agent实进程门禁通过   |

## 3. 正式迁移与磁盘结果

迁移前创建离线备份：
`~/.rah/backups/pre-runtime-catalog-20260903-jeVfWN`。两个备份库均
`quick_check=ok`，Room `foreign_key_check` 为空。

| 数据库                |        备份体积 |   迁移后体积 |   减少 |
| --------------------- | --------------: | -----------: | -----: |
| `room.db`             |   669,396,992 B |  5,025,792 B | 99.25% |
| `runtime-registry.db` |   408,166,400 B | 37,621,760 B | 90.78% |
| 合计                  | 1,077,563,392 B | 42,647,552 B | 96.04% |

正式 registry v3→v4 副本迁移实测约 1.74 秒，最大 RSS 约 190 MiB；迁移使用 SQLite
`json_remove` 的 distinct payload 和 32 行 envelope batch，没有把 34k 份完整 JSON 一次性读入 JS。
迁移后 Room `user_version=43`、registry `user_version=4`，两个库 `quick_check=ok`，外键检查为空。

## 4. 正式长期采样

正式服务在 `127.0.0.1:4173` 重启后，先做 60 秒，再做 120 秒采样：

- Runtime registry 的 mtime 停在启动迁移时；纯 heartbeat 不再写该库；
- reports `34,023`、payloads `36`、Room observations `63`、current offers `29` 全程不变；
- daemon child process 全部采样均为 `0`；
- 第二段 12 次 CPU 样本为 `2.4%–6.2%`，没有旧实现启动 CLI 时的尖峰；
- RSS 从约 604 MiB 缓慢到约 609 MiB 后平台化，没有随 heartbeat 周期阶梯增长。

RSS 的绝对值仍偏高。`vmmap` 显示较大的 V8/Memory Tag 255 与动态库映射；本批只能证明它
不再由 probe child 和重复目录 append 持续放大，不能证明 daemon 的常驻内存已经优化完成。
这保留为 P1：按 owner 分解 V8 heap、catalog cache、SSE/client projection 和 native library
驻留，并建立 1 小时/24 小时 soak 的稳定上限。

## 5. 浏览器验收

正式重启后在两个真实浏览器 fresh reload：

- Firefox：Computer 页可读，4 个 Runtime 与 4 个 Agent 均可用；Codex Runtime 详情显示
  `目录采样 2026-09-03T04:57:49.808Z`、`最近验证 2026-09-03T04:58:21.160Z`、
  `刷新方式 重启 RAH OS`；
- Chrome：首次进入时出现系统级通知授权弹窗，允许后 Computer 页与同一 Runtime 详情正常；
  页面显示 6 个已验证模型、1 个绑定 Agent；
- Chrome 回归 Agent Council：聊天历史与消息工具条可读，报数 1–10 的既有证据完整；Task 页显示
  `#1` 为 `submitted` 并保留讨论/确认完成/关闭动作；Files 页列出 3.8 KB Artifact，预览与下载
  动作可用；
- 已在重启前打开、仍持有旧 JS bundle 的页面会拒绝新字段，手动 fresh reload 后恢复。这是
  发布物跨版本缓存窗口；当前没有自动 reload 协议，列入前端 P1，而不是把旧 bundle 的解析错误
  写入消息正文。

浏览器验收没有启动真实付费模型，也没有使用被禁止的 GPT-5.6 Ultra。

## 6. 自动门禁

- `npm run check`：通过；packages 831 项中 829 通过、2 项付费 Provider 跳过，Web 230/230，
  parity callbacks 34/34；
- daemon 双 Agent real-process fake Provider、publisher、registry 和 schema migration 定向门禁：
  129/129；
- `npm run format:check`、`npm run build:web:workbench`、`git diff --check`：通过；
- source architecture ratchet：修复后通过，`RoomKernel` 与 daemon application 未突破上限。

## 7. 剩余缺口

1. **P1 常驻内存 owner 分解与长 soak。** 目前约 609 MiB，虽稳定但不够轻；需建立 1h/24h
   斜率、堆快照和连接数阶梯门禁。
2. **P1 跨版本 Web bundle 自愈。** 服务升级后旧页面应检测协议/build revision 并一次性提示
   reload，不能把 Zod/JSON 解析错误复制到每条 Message。
3. **P1 Registry 历史诊断分页。** 正常路径不会枚举 34k report，但内部
   `listProbeReports()` 仍可一次性物化全部 envelope；应改为有界 cursor，而不删除不可变证据。
4. **P2 目录主动刷新。** 当前真实语义是重启扫描；若增加手动/后台刷新，必须继续采用
   Multica 式 single-flight、TTL、LKG，且不得与 30 秒 Offer lease 重新耦合。
5. **P2 设备级通知闭环。** Chrome 权限请求已证明；OS 横幅、点击 deep link 与 iOS PWA 仍是
   设备级验收，和本批 catalog 修复无关。

本报告只允许宣称本批 RuntimeOffer/目录留存和迁移闭环，不扩大为全站 UI、所有 Provider
版本漂移或整套 RAH OS 已无前后端缺口。
