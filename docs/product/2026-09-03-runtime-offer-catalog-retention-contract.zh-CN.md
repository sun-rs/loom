# RuntimeOffer、模型目录与探测留存解耦合同

日期：2026-09-03

状态：`A`（RAH OS 本机正式实例）；实现、迁移、压力测试、正式重启和 Firefox/Chrome
验收均已完成。Raft 未公开的 Server 留存实现仍不得宣称为源码级对等。

## 1. 问题与单一 owner

正式实例暴露出两个同源的无界增长路径：

- daemon 的 `RuntimeOfferPublisher` 每 30 秒执行完整 Runtime Profile probe；v3 probe 会启动
  Provider CLI 枚举模型；
- Runtime Registry 为每次 probe 保存一份完整目录，Room Kernel 又为每次 lease heartbeat 保存
  `report_json + projection_json` 两份完整 Offer。

能力事实、在线租约和审计历史是三种不同状态，不能由同一条 append-only 记录兼任：

- `packages/agent-host`：可执行文件身份、模型目录快照、Runtime Profile probe 和本机 registry；
- `packages/daemon`：RuntimeOffer heartbeat cadence，只组合 owner，不保存第二份目录；
- `packages/kernel`：当前 Offer lease、能力变化快照及被 Placement 引用的不可变 observation；
- `packages/protocol`：客户端可见的目录采样时间和最近验证时间；
- `apps/web`：只显示 daemon 提供的新鲜度，不自行推断。

## 2. 上游依据与采用范围

Raft 冻结 Web/Computer 发布物主要提供静态 `RUNTIME_MODELS` 和 Offer/Computer 展示合同，
没有可直接复制的动态目录续租数据库实现。本批不虚构 Raft Server 源码。

Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`：

- `server/pkg/agent/models.go`：动态模型发现按 runtime/command 缓存，60 秒内不重复启动 CLI；
- `server/pkg/agent/thinking.go`：effort 发现独立缓存 10 分钟；
- `server/internal/handler/runtime_model_catalog.go`：按需 stale-while-revalidate，并保留 24 小时
  last-known-good，不把瞬时失败覆盖成长期目录。

RAH OS 结构性采用“昂贵发现、短 freshness、长期 LKG 分离”，但保持 Room-first 安全边界：
RuntimeOffer 不是执行授权；每次真实启动仍必须对冻结 executable SHA-256 做精确复核。

## 3. 决策

### 3.1 RuntimeOffer heartbeat

- 每 30 秒 heartbeat 只检查 active revision 和可执行文件的 `realpath / regular file /
executable / byte length`，不启动 Provider CLI，也不刷新模型目录；
- 同一 capability snapshot 只更新 `runtime_offers` 当前头的 lease/observed/accepted 时间，不追加
  `runtime_offer_observations`；
- state、model bindings、workspace mount、capacity 或其他能力字段变化时才追加 immutable
  observation；
- Placement 继续冻结 observation ID + snapshot digest；真实启动继续做完整文件 hash，metadata
  快检不降低执行安全性。

### 3.2 Runtime Profile probe registry

- schema v4 将报告拆为内容寻址的 immutable payload 与轻量 report envelope；旧 report ID、digest、
  observedAt 均可无损重建；
- 每个 revision 有一个 mutable validation head，记录当前 report、`lastValidatedAt` 和计数；
- 等价 probe 只推进 validation head，不新增完整 payload、report 或 audit；能力变化才写新报告；
- v3 历史迁移保留所有外部可能引用的 report ID/digest，并用 payload 去重后 `VACUUM` 回收页，
  不以删证据方式缩库。

### 3.3 旧 Room heartbeat 历史

- schema 43 只删除既不被 `placements` 引用、也不是 `runtime_offers.current_observation_id` 的旧
  observation；
- 当前头和所有 Placement 证据必须保留；迁移后 `foreign_key_check` 必须为空；
- 一次性 `VACUUM` 回收旧双 JSON 占用，未来 heartbeat 不再产生同类记录。

### 3.4 客户端语义

- `probeObservedAt` 表示当前目录快照形成时间；
- `probeValidatedAt` 表示该快照最近一次由本机 probe 确认的时间；
- 当前产品仍为“重启时重新扫描”，不得显示不存在的后台实时刷新或 Provider 配额。

## 4. 验收

- TDD：等价 probe 去重、内容变化生成新快照、v3→v4 无损重建、heartbeat 不追加 observation、
  capability 变化仍追加、schema 43 只清无引用历史；
- 30 秒以上正式采样不得再启动模型目录 CLI，两个数据库的报告/observation 行数不得随纯
  heartbeat 增长；
- 迁移前离线备份，迁移后两个数据库 `quick_check=ok`、Room `foreign_key_check` 为空，所有
  Placement 引用仍可读取；
- `npm run check`、Web build、format、diff check；Firefox/Chrome fresh reload，并检查 Computer /
  Runtime 新鲜度显示，以及 Room/Task/Thread/Artifact 投影；自动浏览器门禁继续拦截 console error。

实测结果、迁移体积、心跳稳定性及仍保留的 RSS 风险见
[RuntimeOffer 长期运行验证审计](../audits/2026-09-03-runtime-offer-catalog-retention-verification.zh-CN.md)。
