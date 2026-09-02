# Saved 聚合页对齐与双边证据报告

状态：**本批通过；Raft Server 源码不可得，不误报为服务端复制**（2026-09-02）。

## 1. 范围与证据等级

本批只审计左侧“已保存”入口进入的聚合页，以及它与消息收藏状态、精确消息跳转的连接。依据分为三层：

1. Raft 冻结 Web chunk `SavedPanel-BvhJ1TDV.js`，SHA-256 `261c2bd2262c8afe8040486ff2b5dad330badc14c573ee05c2ae522ffbb180cf`；共享 bundle `index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
2. 登录后的 Raft 官方实页 `https://app.raft.build/s/hakasemac/saved` 的 DOM、computed style 和可见交互。该账号本轮收藏数为 0，未为造测试数据而写入或删除官方数据。
3. RAH 隔离真实浏览器 fixture：空态与 3 条收藏态分别运行，不调用付费 Provider，不触碰正式用户收藏。

Raft 已发布代码只能证明 Web 请求、响应消费和界面行为；`GET/POST/DELETE /channels/saved` 的服务端事务没有发布。因此本文把 RAH Kernel 行为记为本地等效实现，而非 Raft 后端源码复刻。

## 2. 官方行为合同 → 本地映射

| 官方事实                                                                                                                                       | RAH 本地实现                                                                                         | 结果                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 首次 `loadSaved({query:"", sortDirection:"desc"})`；store 使用每页 20，并保留 `q/channelId/sort`                                               | `message.saved` 请求支持 query、channelId、asc/desc、limit 与冻结 cursor；独立页固定空查询、倒序、20 | 通过                                 |
| 响应消费 `saved/hasMore/total/globalTotal`                                                                                                     | 返回 items、nextCursor、筛选总数 total、Workspace 可见总数 globalTotal                               | 通过；字段按本地 typed protocol 命名 |
| 整卡打开精确 Channel/DM/Thread 消息                                                                                                            | 复用 typed message target 和 `navigationSearch`                                                      | 通过                                 |
| 卡片显示 `#Room` 或 `@sender`、可选“消息列”、14px 头像、姓名、相对时间、三行正文                                                               | `SavedMessageCard` 消费 canonical Room/Principal/Message 投影                                        | 通过                                 |
| 右上橙色实心书签移除；右键菜单依次为复制链接、复制 Markdown、分隔线、移除；共享菜单项为 14/20、500、`8px 12px`、yellow/30 hover，分隔线 2px 黑 | 同序、同样式菜单；链接为本地 typed deep link，Markdown 复制 canonical 原文                           | 通过                                 |
| 6 行 skeleton；空态“暂无收藏的消息 / 选择消息上的书签图标即可保存。”；无额外刷新按钮                                                           | 文案、结构、无限滚动 sentinel 与 `240px 0px` root margin 对齐                                        | 通过                                 |
| 收藏是当前用户私人状态                                                                                                                         | `human_saved_messages` 按认证 Human 隔离，写入幂等，读取重新做 Workspace/Room ACL                    | 通过，属于 `rah-os-glue`             |

独立页面没有渲染搜索、Room 筛选或排序控件。RAH 只补齐协议/Kernel 能力，没有自行增加 Raft 页面上不存在的控件。

## 3. 浏览器实测

### Raft 官方空态，1280×720

- 标题栏：`x=304, y=0, w=976, h=62`，左右 20px。
- 图标容器：`x=324, y=12, 36×36`，2px 黑边，computed background `rgb(255, 212, 64)`；内部书签 18px。
- 标题：`x=372, y=12`，16/20、700；空态内容区 `x=320, y=78, w=944, h=626`。
- 空态图标 36×36；标题 18/28；描述 14/22.75。官方账号为 0 项，本轮只读，没有伪造非空双边前置。

### RAH 隔离浏览器

- 空态在相同 1280×720 布局下复测：标题栏、图标、标题和空态几何与上述官方 computed 值一致。
- 3 条收藏态：倒序渲染；卡片 `w=944`、2px `black/30`、12px 内距，头像 14×14，移除按钮 28×28、图标 14×14；hover 转黑边并出现 2×2 shadow，移除提示显示“从收藏中移除”。
- 右键菜单显示三项官方顺序与共享菜单 computed style；定位使用 Raft `style:{left:c.x,top:c.y}` 及相同视口夹取，而不是无效的 CSS `x/y`。Raft 冻结 Saved 代码只直接证明 backdrop dismiss；RAH 的 Escape 关闭并还焦、ArrowUp/ArrowDown/Home/End、外点与 resize 关闭属于本地可访问性和防悬空增强，并已纳入真实 Firefox 门禁。整卡点击生成并进入包含 `room`、`target=message`、`message` 的精确本地链接，返回后仍为 Saved 页。
- 390×844：无水平溢出；标题栏高 62，卡片 `x=16, w=358`，移动端 Room 列表入口可见，3 条均可滚动访问。
- 空态、非空态均无页面错误或重复顶层错误横幅。

## 4. 后端安全与测试

- `message.saved` 的 query/Room/sort/cursor scope 由 Zod 严格校验；cursor 绑定 actor、表和查询范围，切换排序后复用旧 cursor 会被拒绝。
- total 与 globalTotal 都使用同一冻结 ceiling，避免翻页过程中新增收藏改变已见窗口；取消收藏同步更新本地投影。
- Kernel 定向测试覆盖大小写查询、Room 筛选、升降序、双总数、Principal 头像/姓名、升序翻页和 cursor 范围拒绝。
- Web 纯模型测试覆盖动态目标、中文相对时间、跨页去重与菜单 viewport clamp；静态 UI 合同固定官方文案和关键几何。

最终串行验证通过：package tests 773 项中 771 通过、2 项真实 Provider 用例按约定跳过；Web 167/167；真实回调回归 34/34；Saved/Protocol/Kernel 专项 13/13。全仓 TypeScript、`git diff --check`、production Workbench build 与 `npm run test:web:firefox` 均通过。Firefox 150.0.2 门禁使用独立临时状态、随机端口和 Fake CLI，覆盖 1440×1000 与 390×844，并在结束时清理临时进程与目录。

第二次独立只读审计复核了冻结 hash、Raft 菜单共享组件、上述测试与 Firefox 门禁，裁决为无功能/安全 blocker，可声明 **Saved 范围内前后端外部行为等效**。审计保留一项非阻断无障碍债务：整卡 `div role="button"` 内含独立移除 `<button>`，可操作路径正确，但读屏嵌套交互语义仍可继续优化；Raft 冻结实现本身也有外层 button + 内层 role button 的同类结构，因此不构成当前可观察行为 parity blocker。

## 5. 正式重启与只读验收

- 最终重启前 Room DB 与 Runtime Registry 均为 `quick_check=ok`；26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，Task/Reminder 无活动项，正式收藏数为 0。
- 最终一致性快照位于 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-saved-final-20260902-KGIXLf`，使用 SQLite 固定读快照生成；两份 snapshot 均为 `quick_check=ok`。一次受持续写入影响而无法完成的 `.backup` 半成品已明确终止并删除，没有当成恢复点。
- 精确旧 PID `32811` 收到 `SIGTERM` 后正常退出；新 PID `47199` 监听 `127.0.0.1:4173`，health 为 online，入口资产为 `/assets/index-BRHqKbM4.js`。重启后执行终态计数和收藏数均未变化。
- 正式新标签冷开与整页刷新均恢复 `?surface=saved`；1280×720 的标题栏/图标/空态几何与官方实页一致，错误横幅及 `JSON.parse`、`NetworkError`、`Failed to fetch`、`RAH Client request failed`、`Human access token` 正文命中均为 0。
- 正式 390×844 页面 `scrollWidth=clientWidth=390`，标题栏 390×62、内容宽 358，移动 Room 入口可见，无错误横幅。没有向正式 Room 发消息、写收藏或调用 Provider。

## 6. 未冒充完成的部分

- 没有 Raft Server 源码，无法证明其数据库索引、事务隔离、ACL 查询或幂等策略与 RAH 内部相同；只证明外部合同与安全语义等效。
- 官方账号本轮为空，所以非空卡片没有“同数据双边实页”证据；其官方侧依据是已冻结发布代码，本地侧是真实非空浏览器。需要官方账户自然出现可保留的测试消息后，才能补同数据非空截图差分。
- 本报告不扩大为全站收藏搜索控件、跨计算机传输、Agent 自动感知收藏或通知唤醒；这些都不是当前 Saved 页面源码所证明的行为。
