# Agent 触发点合同与施工范围

施工后的实测结果、明确差异和放行条件见：[浏览器审计](../audits/2026-08-31-agent-trigger-browser-audit.zh-CN.md)。下表保留施工前状态，不等于验收结论。

后续来源纠正：当前发布版 RefText 会解析文本引用，再由目录/context 解析和检查过期导航；不是纯 metadata 渲染。以下关于“不解析文本”的旧表述已由[本地映射合同](./raft-frontend-local-contract.zh-CN.md)替代。官方文件成功态缺证不阻止本地施工。

## 产品边界

RAH OS 不安装 Agent CLI，不配置 CLI 账号或代管登录。用户负责计算机上的 CLI；RAH OS 发现已安装能力、绑定配置、调用、管理生命周期和展示诊断。本轮不重写模型/effort 发现。

## 六列证据表（施工前）

| 官方触发位置      | 源码组件及参数                                                                                                          | 显示内容／数据来源                                 | 关闭和键盘行为                                                          | 本地对应实现                                                                           | 双边实测结果                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 资料 → 角色旁问号 | 官方 bundle 的原生 `title="角色权限"` button，12px circle-question-mark；click 打开角色说明                             | Workspace/服务器权限角色，非人设 prompt            | 点击关闭、Escape、焦点归还需验收；hover 为原生 title，不虚构 hover card | 新 RolePermissions；复用 useDialogProtocol；从 Kernel control Room membership 返回角色 | 官方点击已看到管理员/成员说明；本地待实现              |
| 消息头像          | Mj/Nj/jj PreviewCard；调用点 delay=200ms、closeDelay=120ms、width=280px、sideOffset=6、collisionPadding=6、fixed portal | Agent 身份、状态、Computer、Runtime/模型、最近动态 | hover 离开延时关闭；点击头像打开右侧动态；Escape/Tab 待实测             | MessageAgentAvatar 改用统一 PreviewCard；异步响应按 Agent/组件生命周期取消             | 官方源码定位；本地原先 close=180、offset=8，有偏差     |
| 消息姓名          | message-sender-mention-* button，hover underline，title=提及 @name                                                      | canonical handle 插入当前 composer 光标位置        | 点击/Enter，不发送；Room/Thread 草稿互不污染                            | 现有 insertMention，保留并回归，不重新实现                                             | 待双边实测                                             |
| 动态记录的目标    | 官方 action metadata 的 target channel/thread chip                                                                      | 官方 action target；不是把日志文字当链接解析       | 点击导航；键盘访问                                                      | 首批只链接 Kernel ACL 过滤后的 Run 所属 Room；明确标“对话”，不假称每个工具的实际目标   | 原实现没有链接；精确 action/thread target 保留缺口     |
| 工作区 tab        | Computer 1.0.18 getFileTree/readFile/listDirectoryChildren；一次一级、目录优先、隐藏切换；text 1MiB、image 5MiB         | Agent 私有目录，非全机文件系统                     | 目录展开、选择预览、刷新、隐藏项、复制路径；键盘树导航                  | AgentHost 只读文件 owner + typed client + WorkspaceBrowser；记忆管理移入独立折叠区     | 官方 Computer 离线：加载文件失败。非空官方树待上线验证 |

## 复用与安全边界

来源：`raft-ui/vendor/raft/index-WTraJnrd.js`；`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js`（13029–13044、30559–30603、34186–34245、36583–36615）。它们是冻结发布产物，不宣称获得未发布源码。

- 移植 Raft 文件类型表、尺寸限制、隐藏/敏感路径规则、一级目录排序；额外拒绝 symlink/hardlink 越界和过多条目，避免把原版 lexical startsWith 检查误作完整沙箱。
- Workspace 浏览 API 不接受绝对根路径、owner ID 或 cwd；Human 先经 Kernel 管理权限验证，再由 Computer owner 映射 Agent 私有目录。读取不会创建目录、索引或触发 Agent。
- 当前 RAH 的 Agent 私有 home 与运行时 cwd 分离。浏览器明确说明本页只读私有 home，不把它冒充当前项目 checkout，更不隐式改变运行 cwd。完整项目挂载浏览另需 canonical mount 授权。
- 权限角色来自 control Room membership；Agent 当前只允许 member（ADR-0012），不为视觉对齐伪造管理员写入。人设继续由 AgentDefinitionRevision.role 拥有，另标“人设指令”。
- 动态来源链接来自 Kernel 可见 Room read model，不能正则提取诊断文本中的路径、URL、Room ID 作为 canonical target。
- 统一浮层分为非交互 preview 与模态 dialog；共享定位/延时/dismiss owner，不把 native title、菜单、可点击卡片强行视为同一种交互。

## 验收顺序

先失败测试：权限角色与人设分离、ACL 目标、目录/文件安全、浮层参数与碰撞。再实现。隔离 fake-runtime 环境核验头像 hover→Escape→click、姓名插入、角色说明键盘、动态跳转、目录展开/隐藏/预览/错误恢复；并回归 Room/DM 发送、搜索与配置。双边固定实际视口，官方离线项标阻塞，不用本地 fixture 冒充官方通过。完成此片段前不扩张 Agent 全页面改版。
