# 任务标识／回复预览／Role在线角标修复

本批修复现役产品的数据接线，不升级依赖或完整Web版本，不部署尚未接齐能力的adapter123候选。官方源和生成器边界保持；付费模型调用0，正式环境不创建测试对象。

## 根因与实现

- 受控MessageItem只收到回复计数，未收到原生只读回复scope，因此回退为小数字按钮。任务引用又从空的上游store取Task，正文不能生成原生任务chip。现在由当前Room的既有Task context绑定任务引用与点击入口，原生组件继续负责状态色、字号和布局；生成器适配规则是唯一修改源，没有手改生成文件。
- `thread.list`增加可选、去重、最多100个根消息ID。Kernel在原Room成员鉴权后一次批量查询，仅给指定根返回最新3条、每条最多400字符的摘要；不传则不返回摘要。传输有界不代表数据库仅扫描3行。当前可见消息窗口请求此投影，不逐列拉取全部历史，不推进已读或改变Thread计数，无迁移／第二业务状态所有者。
- Activity客户端丢弃原API已返回的Task／根消息ID，行组件也没有任务徽标并使用了反向图标。保留canonical Task后，复用原生TaskStatusBadge、ThreadIcon及频道Hash角标；任务身份和状态不从预览文本解析。点击仍进入对应消息列，未改成任务资料弹窗。
- Role列表把Room工作状态idle显示为灰。现复用已有Host presence读取，按旗下实例稳定Agent ID聚合：任一online／working／thinking显示绿；全部offline或无实例显示灰，缺失观测保留unknown，异常保留error。不新增逐频道轮询，不修改实例启停与唤醒范围。

## 空闲进程与实例身份

现有AgentHost资源策略已支持空闲CLI进程回收：默认30分钟，冷恢复超过20秒时可延为2小时；忙碌／清理中／原生TUI固定占用不被空闲回收。实例及原生session绑定保留，收到原本应投递给它的消息时恢复同一会话；不把回收变成禁用／移除实例，也不把定向@改成广播。Host在线表示实例可接工作，不证明CLI进程持续驻留。本批仅核实策略与接线，没有改默认值，也没有等待30分钟实机试验。

## 验证

- 28项定向检查通过：Kernel摘要、原摘要／权限、频道客户端、任务接线、来源生成一致性、Role聚合与原消息列交互。UI规则／动作规格8项、既有假时钟空闲回收2项通过。
- Core与产品前端类型检查通过。最终产品构建、临时Core浏览器和正式部署记录在本批收尾后补入。
- 红测试保留：修前缺任务payload／root身份，实际旧构建缺行内任务chip；Kernel摘要与来源绑定先失败再修复。测试准备中纠正了无效workflow请求字段、返回ID取法、原生in-review属性名、Activity原有跳转预期及presence路径；这些准备错误不算产品缺陷、不隐匿成通过样本，没有付费调用。
- 浏览器仅Host在线观测作桩，其余为真实临时Core／API数据；1440×1000与390×844验证任务chip、5条回复中的最近3条摘要、打开正确消息列、Activity任务徽标与图标顺序、Role绿灰切换。正文和动态任务底色均为同一原生token。不是最新官网全站像素或真机认证。

可复跑入口：

```sh
node --test packages/kernel/test/thread-preview.test.ts packages/kernel/test/thread-summary.test.ts scripts/official-web/task-message-presentation.test.ts scripts/official-web/role-presence.test.ts scripts/official-web/channel-client.test.ts scripts/official-web/channel-task.test.ts scripts/official-web/chat-host-source.test.mjs scripts/official-web/discovery-task-source.test.mjs scripts/official-web/thread-adaptation.test.ts
npm run test:official-web:ui-contract
npm run typecheck
npm run typecheck:loom --prefix frontends/raft
npm run build:web:workbench
LOOM_BROWSER_SLICE=task-presentation npm run test:official-web:channel
```

## 部署

待最终构建、推送和既有安全部署流程完成后记录，不把隔离测试地址当作产品服务。实体手机系统通知／状态栏、全站完整候选迁移及真实CLI成本门禁不属于本批验收。
