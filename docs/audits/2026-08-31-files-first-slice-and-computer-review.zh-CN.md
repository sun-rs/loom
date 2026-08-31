# Files 首批实现与空间 / Computer 复核

日期：2026-08-31。范围：[施工方案与来源](../product/2026-08-31-files-and-computer-contract.zh-CN.md)。

## 结论

Human 在 Channel / DM 的附件上传、发送关联、Files 列表、文本预览、下载和原消息定位已有真实浏览器证据。它不再是占位页面，但不是完整 Artifact / Agent 文件闭环，也不代表全部 Raft UI 已经 1:1。

本次未重新研究或更换 CLI、model / effort 发现、记忆和消息虚拟化实现；未引入 OpenAgents；未重启正式 daemon。构建了 trusted-proxy Web 产物，正式后端是否升级不能由构建成功推断。

## 双边实页发现

### 空间标识

Raft 登录后按钮的 accessible name 是“切换服务器（当前：hakasemac）”。当前实测 hover 是名称 tooltip，点击才打开含 `hakasemac /hakasemac`、`TF and Friends /tf-and-friends`、排序与加入 / 创建服务器入口的菜单。因此 H 表示当前 server/workspace 身份，不是当前 Computer 的直接缩写。

RAH OS 当前点击标识打开空间编辑，而非切换菜单，仍存在产品差距。方案是复用 Workspace selection/update owner，将 anchored switcher 与编辑入口分离。空间可默认以本机命名，但注册多 Computer 后不能随 Computer 选择改变空间身份。没有真正多服务器能力的社区 / 创建服务器项不能伪装可用。

### Computer

本轮修复了进入 Computer 后必须再点一次计算机才显示详情的问题；隔离浏览器确认默认详情直接出现。

尚未实施完整 Computer read model。当前 CLI inventory 不能代替 Computer 注册、版本、hostname、description、创建者、heartbeat / lastSeen，以及该机 Agent 绑定。尤其不能用 `runtime.available` 判断计算机在线。图示中的编辑、离线恢复和 Runtime badges 必须来自上述独立数据，不从 Room 或可执行文件存在与否猜测。详情布局沿用 Raft 分段；RAH 没有对应能力的操作先禁用，不展示虚假的 Raft 命令。

## Files 的复用边界与实现

- 产品语义来自 Raft 当前实页：Files 只列当前对话已发送附件，上传入口在 Chat，文件行菜单为“跳转到原消息 / 下载文件”。本次未在 Raft 账号发送或删除文件。
- 上传状态和 200 MiB 单文件上限参考 Raft Computer 1.0.18 的 `attachmentUploadContract.ts`。本机适配为 prepare → authenticated PUT → 服务端长度 / SHA-256 验证；不照搬云对象存储签名 PUT。
- 本地原子存储、稳定标识及 draft 上传生命周期借鉴 Multica `server/internal/storage/local.go`、`server/internal/handler/file.go`、`packages/core/drafts/upload-coordinator.ts`。这是 TypeScript 结构化适配，不是 Go 源码原样搬入。
- 文件行规格提取自 Raft live DOM/computed style：列表 padding 12px / gap 8px；行 padding 12px 16px、2px 边框；图标框 56px；标题 14px/20px，元信息 12px/16px；overflow 28px，SVG 14px。文件 / overflow / 时钟 SVG 路径采用实页数据；没有声称全部弹窗都已像素一致。

单一 owner：protocol 定义合同，Kernel `RoomFiles` 管理预约 / 字节 / ACL，`room-agent-service` 在 Kernel 事务内协调消息关联与预约消费。传输层只认证和流式转发；前端通过 RahClient 操作，连接级 upload store 保留跨页草稿。上传成功不等于发送成功；未发送文件不进入列表。能力握手 `fileShare` 为可选字段，新 UI 对旧后端保持禁用，不把不存在的接口伪装成可用按钮。

Schema 22 增加附件列及预约表，旧消息默认无附件；老版本 daemon 不应打开已迁移的新版本数据库。本次只在隔离数据库中验收迁移，未操作正式数据库。

安全与可靠性：Room membership / 上传所有者校验；不可把一个附件用于另一 Room 或另一消息；幂等重试不重复消费；服务端生成磁盘 ID；私有目录、拒绝 symlink root / 下载 symlink；流式精确长度验证和原子 rename；取消 / 过期后不能发布。过期回收仅处理未发送的本服务文件，不扫描或删除已发送文件。下载是 attachment + octet-stream + nosniff；HTML / SVG 不作为活动页面执行。

## 验收结果

所有 UI 操作使用真实浏览器和隔离 fake-runtime 工作台；不把 fake Agent 回复计作真实 Agent 读取附件成功。

| 用例                            | 实测结果                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Channel 上传，发送前切 Files    | 空列表；返回 Chat 附件草稿仍在                                                              |
| 无文本、仅附件发送              | canonical Message 与附件关联成功，Files 出现文件行                                          |
| 文本预览                        | UTF-8 中文及符号完整，无布局覆盖                                                            |
| 浏览器下载                      | 下载文件与测试源文件逐字节相同                                                              |
| 文件菜单原消息定位              | URL 含同一 Room / Message ID，Chat 中存在对应附件消息                                       |
| 菜单键盘行为                    | Escape 关闭，焦点回到触发按钮；没有残留 menu                                                |
| 私聊 Alice                      | 通过真实 UI 建立 DM、上传并发送；DM Files 独立显示其文件                                    |
| 持久化 / 分页 / 越权 / 取消竞态 | Kernel / HTTP + SDK 集成测试通过；磁盘重开后消息附件和列表恢复                              |
| Computer 首次进入               | 无需第二次点击，显示默认计算机详情                                                          |
| 现有长聊天 fixture              | 10,000 条，向前追加 50 条后锚点仍为 timeline-1、offset 62px，偏移 0px；DOM 从 15 行到 22 行 |

下载证据：自建无敏感内容的 `apps/web/test/fixtures/files-smoke.txt` 与浏览器保存的 `/Users/sun/Downloads/files-smoke.txt` SHA-256 均为 `7bdb724745924749797d6d6ba06013722b32e4700f5e59cdf396083fdb7f5c3c`。浏览器下载事件等待曾超时，不能记为该事件 hook 通过；实际落盘及字节校验通过。

视口限制：本轮双边真实 `innerWidth/innerHeight` 均为 **1280×720，DPR 2**。浏览器的 viewport 设置调用没有改变实际尺寸。因此只报告该桌面尺寸，不报告 1440px 或 390px 移动端通过。旧报告的移动端结果也不能代替本轮新增 Files 的移动验收。

现有 `message-timeline.html` 起初缺少 Composer draft provider 和新增消息 props，打开即报错；本轮修复的是验收 fixture 的接线，继续使用既有虚拟窗口 / anchor 实现，没有重写滚动算法。此结果证明所测追加路径，不覆盖所有缩放、极长单消息、图片加载后的高度变化。

门禁：`npm run check` 通过（packages 670 项：668 通过、2 跳过；Web 58/58），TypeScript 通过；`npm run build:web:workbench` 通过，仍有大 chunk 警告；源码规模门禁曾发现 `RoomKernel` 超限，协调代码抽到已有 owner 后为 6,924 行，未提高 6,925 上限。格式与 diff 检查一并执行。未运行付费 Provider。

## 未完成项及下一批顺序

1. **Agent 文件闭环**：Worker / MCP / CLI 读取被授权附件、发布本地产物，统一来源与权限，不能仅让 Agent 看见文件名就声称已理解内容。
2. **Task / Thread / Artifact**：任务提交关联产物、线程 composer 附件；保留 canonical Task/Review owner，不由 Files 列表反向创造业务完成状态。
3. **Files 体验验收**：图片缩略图、各类型预览与失败态、移动端、LAN、较大文件内存预算。当前浏览器下载完整 Blob，不具备断点 / Range 下载；图片代码路径尚未完成真实浏览器图片验收。
4. **Computer 和空间切换**：实施上述 read model / switcher 方案，再双边核对鼠标、编辑、在线 / 离线状态和多机选择。当前只是默认详情修复，不能记为整页完成。
5. **长聊天扩展验收**：复用现有实现继续覆盖跨页返回、实时尾随、离开底部后的新消息、图像与超长单条消息；不为了验收另造实现。

“Agent 安装与配置”应拆开表述：现有机器上的四家 CLI 调用及 Agent 角色 / 模型配置是已有能力；新机器安装、登录、检测、故障恢复是另一个部署引导。模型 / effort 链已有来源账本和真实执行证据，本轮没有发现必须替换它的证据；无需再引入一个项目重做，但不能承诺上游版本 / 账号变化后永久完美。
