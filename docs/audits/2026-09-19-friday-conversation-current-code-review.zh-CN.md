# 周五以来本对话改动核查

核查日：2026-09-19。周五按 2026-09-18 解释；同时覆盖本对话周五提交中
汇总的此前 UI 请求。对象是 e07f7d7 加当前未提交工作区，不是单独该 commit。
本次只读产品代码、运行隔离测试；不修改正式业务数据、不执行付费 CLI。

## 结论与问题

没有发现周五 UI 提交整体丢失，但不能声明所有功能无问题。
45df1ae 是 e07f7d7 的父提交；删除身份、旧私聊和关闭会话续修仍未提交。

1. 历史消息模型标签仍读取当前 Agent.modelBindingId：
   apps/web/src/components/message-model-name.tsx:23，
   conversation-panes.tsx:1181。更换模型会改变历史消息标签；历史模型快照要求未完成。
2. 创建同名 Agent 的真实路径未闭合：agent-dialogs.tsx 按名称生成 handle，
   workspace-agent-provisioning.ts 调用 principalHandleIsAvailable，
   message-reference-identity.ts:7 检查所有 principals，包括已删除身份。
   删除后直接同名创建可发生 handle 冲突。已有同名私聊测试仅验证不同 ID 的
   显示独立性，不能证明真实同名创建成功。必须保留历史身份，不能简单重用旧 ID。
3. 创建弹窗仍使用原生 select；runtimeModelLabel 的 OpenCode 文本是
   provider + 中点 + displayName/modelId，不是用户指定的 provider.model_id。
   外框样式和字段布局已在，不等于弹出选项菜单完全对齐。
4. 新 Agent 自动向 #all 报到未实现。provisionWorkspaceAgentTransaction
   追加 agent.provisioned 并协调 #all 成员，没有首次报到的持久执行请求。
   AgentHost 初始 MEMORY.md 模板仍在，但它不证明创建时已经执行模型或报到。
5. 全仓验证未通过：接口清单、源码体积限制、图标摘要和旧 UI 测试均需处理。

## 保留清单

| 本对话要求                                                  | 当前代码与本次证据                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| 隐藏空分区独立卡片、默认关闭、折叠选择跨刷新/实例重置       | 在；settings-repair、sidebar-preferences 浏览器通过                      |
| 移动 Agent 动态悬浮 pill                                    | 在；sidebar-preferences 浏览器通过                                       |
| Composer Plus 直接引用、移动设备上传                        | 在；composer-controls、native-upload-reopen 浏览器通过                   |
| 文件窗口两行标题、Home、小按钮、多选、反选、去加载闪烁      | 在；file-dialog-chrome、file-directory-navigation 浏览器通过             |
| PWA 安全区按页面颜色延伸、不遮内容                          | 源码保留；scroll-ownership 通过；本轮没有真实 iPhone 验收                |
| 任务拖动抖动修复                                            | 在；task-touch-scroll 的全局/Room 列表和看板通过                         |
| Agent 工作区简化、移除额外记忆页                            | 在；agent-workspace 浏览器通过                                           |
| Room 成员头像                                               | 在；room-member-avatar 浏览器通过                                        |
| 设置移除计算机、归档频道、开关交互                          | 在；settings-repair、settings-archive 浏览器通过                         |
| Agent 聊天目录公开/私密图标、移除重复私信按钮               | 在；settings-repair 浏览器通过                                           |
| Tab 按内容留白、行内引用文字基线                            | 在；tab-content-spacing 通过；旧严格 Raft 底部对齐测试与新要求冲突       |
| 归档弹窗、已归档阅读/恢复、系统事件                         | 源码保留；settings-archive 通过，未重新逐像素双边验收                    |
| Agent 动态最新定位、底部按钮、去多余上下文标签              | 在；agent-activity-repair 通过                                           |
| 直接启动无确认、停止/重启/重置                              | 在；agent-direct-start 和 parity reset 浏览器通过；本轮无真实 CLI 重置   |
| 移除报告问题                                                | 在；旧单测反而仍要求它存在                                               |
| 创建弹窗布局、Provider/模型/推理/环境变量、移除高级身份字段 | 在；parity create/runtime 桌面和移动通过；原生菜单及模型文字仍有上述缺口 |
| Agent 资料名称/描述编辑规格                                 | 源码保留；本轮未单独重跑 profile-fields 模式                             |
| 删除头像灰显、无提及、不可用面板                            | 在未提交工作区；此前定向浏览器通过，本轮单元/Kernel 相关测试通过         |
| 删除后旧私聊身份保留、关闭历史私聊                          | 在未提交工作区；相关回归通过；不等于同名创建已闭合                       |
| Stop/steer/daemon 排队                                      | 源码存在；本次未运行付费执行端到端门禁，不作运行语义完备承诺             |

## 当前测试

- npm test：1758 项，1739 通过、2 失败、17 opt-in 跳过。
  失败为 RoomKernel 7091 行超过 6925 限制，以及 interaction-icons.svg
  新增 triangle-alert 后摘要断言没有同步。
- test:web:unit：451 项，446 通过、5 失败。
  两项硬编码旧 onOpenDirectPeer 单行回调；一项硬编码未过滤 footer agents；
  一项仍要求报告问题；一项仍要求 showMore/showAdvanced 状态变量。
  这些是测试契约未同步，不应恢复用户要求删除的 UI 来让测试通过。
- 第一组 12 个浏览器脚本：11 个通过；parity-controls 仅 390px header
  等待内联私信按钮超时，当前窄屏动作实际收纳在更多菜单，需要修正测试路径。
  该脚本其他 create/runtime/reminder/reset 组合通过。
- 追加 5 个浏览器脚本：目录导航、任务触摸、侧栏偏好通过；inline-reference
  仍以旧 vertical-align:bottom 作 oracle；mobile-tab-navigation 仍点击
  已移除的设置/计算机按钮。两者不能据此认定用户要求的改造丢失。
- npm run check 停在未登记 /v1/worker/message-present；后续测试以上述
  独立执行结果为准。format:check 有 5 个后台相关文件失败；typecheck 和
  git diff --check 通过。
- 原始日志：/tmp/friday-ui-audit.log、/tmp/friday-ui-extra.log、
  /tmp/audit-web-unit.log、/tmp/audit-kernel-all.log、/tmp/friday-check.log、
  /tmp/friday-format.log。临时日志不是长期证据来源。

## 运行状态更正

核查时正式进程已于 2026-09-19 17:58:39 启动，health 为 online，
buildId 75913ec137cd3733。这不是本次审计触发的重启。
只读 inspectSchemaState 显示 schema 56、pending=[]、supported=true。
工作区新增了 presented-window 兼容迁移和删除 bootstrap Agent 后的启动修复。
因此上一轮的 schema 阻塞已不再复现；不应继续以旧状态阻止重启。
本次未执行正式浏览器全链路验收，health/进程信息不代表全部 UI 已逐项部署验收。
