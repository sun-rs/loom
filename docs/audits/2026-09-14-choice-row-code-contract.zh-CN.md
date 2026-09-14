# Agent候选行：共享组件与可执行颜色合同

## 来源与Owner

本批延续[Raft源码矩阵](2026-09-14-agent-choice-hover-contract.zh-CN.md)的发布URL、
SHA256、行号及Multica对照。再次读取Raft 52329通用菜单、117030提及候选，
以及Multica property-picker.tsx 的hoverClassName/selected分离实现。
不复制发布包，不新增第三方素材；四种配置是RAH对来源的结构化归纳。
没有新的线上Raft同条件双边验收。

ui-tokens的choice-row.css唯一持有透明、100%黄、30%黄、50%黄和20%粉的
背景规则。ui-web的ChoiceRow唯一持有profile/current/tinted-selection的DOM映射；
页面原有控制器继续拥有候选、选择和命令，不新增业务协议或状态。

## 已迁移范围

| 配置             | 生产调用                                          | 状态                                            |
| ---------------- | ------------------------------------------------- | ----------------------------------------------- |
| member-selection | RoomCreateDialog成员、RoomMemberPage添加候选      | hover纯黄；创建选中粉20%；添加保留checkbox      |
| member-browse    | RoomMemberPage的Human与Agent                      | hover/focus-within黄30%；头像亮度与移除动作不变 |
| property-option  | DiscoveryFilter，包括Task负责人及人员筛选         | hover/focus黄30%；已选保留勾选                  |
| autocomplete     | ComposerMentionMenu，Room/DM/Thread及文件评论复用 | 普通hover黄50%；当前候选纯黄                    |

原有局部背景规则已移除。DiscoveryFilter的表情反应选项维持单独的粉色合同，
不强行归为Agent属性选项。Agent目录导航卡片、会话导航行、原生select有不同来源，
不纳入本次候选行迁移。本地没有独立的侧栏会话自动补全控制器；不为迁移凭空新增它。

## 防止再次漂移

ChoiceRow要求四种profile之一，禁止style参数。current仅适用于属性和自动补全；
选中粉色仅适用于member-selection显式tint。普通成员行不会因成员身份变成已选色。
member-browse允许div承载内部独立按钮，其既有键盘/点击行为保留。

ui-choice-contract进入check:ui-library，扫描实际ChoiceRow调用及其样式别名，拒绝：
局部style、props展开、手写data-choice属性、匹配行的background/opacity/filter或
变量覆盖，以及经父容器button选择器施加的同类覆盖。允许布局及子图标规则。
负例测试包含dialog祖先、状态组合、变量重定义；不是按弹窗位置统一调色。
静态扫描不能证明任意全局选择器安全，因此computed浏览器状态门禁也加入npm run check。
现有library catalog登记共享owner和fixture，不创建第二份组件注册表。

## 验收

新增门禁测试先因缺失owner失败，再实现通过；后续保留局部覆盖负例测试。
浏览器矩阵使用隔离fixture，无daemon/付费Provider：Chromium及Firefox，1440×844与390×844，
指针进入/退出、已选+hover、键盘current、disabled、嵌套位置、实际DiscoveryFilter和reload。
预期颜色按来源字面值在白色表面合成，不从待测token生成期望。
创建频道与成员管理另运行既有隔离真实产品页面门禁。

共享行额外用真实点击复现了aria-disabled的div仍能激活的问题；修复为捕获并阻止点击与
键盘激活，原生按钮将aria-disabled映射为disabled。保留该回归测试。

交付检查：npm run check、format:check、git diff --check、build:web:workbench通过；
更新后的共享组件另通过typecheck及test:ui:choice。组件样式sidebar-row/sq-btn门禁与catalog均通过。
创建频道、成员管理既有门禁在Chromium/Firefox均通过。

正式工作台完成空闲检查、备份校验、优雅停止及启动；新鲜浏览器HTML确认冻结构建
`6baf02486828ff35f068d7380fb9e5f1845c3dffae1f94364c7fc8ac8cbf660f`。
备份：`/Users/sun/.rah/backups/pre-restart-72eadc29-6b5a-4038-b0ad-8e98b9376650`。
正式URL为`http://127.0.0.1:4173/`，核验1440×900和390×844的创建候选黄底、已选粉底、
成员浏览浅黄与真实提及候选；截图已目视检查。未发送消息或修改成员。
正式截图目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-choice-formal-ZB4ghb`。
隔离双浏览器证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-choice-state-g2OPk4`。
未进行真实iPhone PWA、付费CLI或新的Raft线上双边验收；本批未commit/push。
