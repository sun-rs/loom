# Agent 候选行颜色：按组件与状态，而非窗口层级

## 结论与反证方法

“独立弹窗的 Agent 列表均明黄，基础页面的 Agent 菜单均浅黄”不成立。
创建频道、添加成员候选列表支持前半段观察，普通成员行支持后半段观察；
Task 弹窗的负责人菜单、侧栏会话搜索和聊天 @ 补全提供反例或额外状态。
不能把窗口是否有遮罩、是否portal或是否在页面内，作为颜色切换条件。

本次搜索授权Raft发布包的`hover:bg-soft-signal`、`hover:bg-brutal-yellow`及透明度后缀，
然后回溯组件、候选数据、调用入口与鼠标事件。命中行不等于独立交互数量；这不是全站菜单
完成率统计。区分CSS hover、键盘/鼠标当前候选、已选成员和disabled状态，避免仅凭截图推断。

## 来源与限定

Raft：`https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
配套`index-DPaRRgFJ.css`，SHA256
`0d658697e96e6569a8a9d29279e0765da20517a7133a2facf708f45af39afbf0`。
以下行号为授权本地pretty副本。本次仅形成源码证据与工程约定，没有复制发布包为生产依赖，
没有新增素材，既有授权/notice保持；不宣称新一次同条件线上双边浏览器验收。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`：
`packages/views/issues/components/pickers/assignee-picker.tsx`使用PropertyPicker；
同目录`property-picker.tsx:269`允许hoverClassName，默认`hover:bg-accent`，
selected则控制对勾。它同样分开行交互与选中表示，没有“modal决定黄色”的规则。
不采用其调色板或复制代码，Raft仍是本次颜色依据。

## 可核对的组件矩阵

| 场景                                | Raft 行为                                                        | 源码证据                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建频道／编辑频道的成员候选        | 未选中hover纯黄；已选中pink 20%＋对勾                            | 129320、129358；编辑复用规格129875、129913                                                                                                                                      |
| 添加成员独立弹窗                    | Agent候选hover纯黄                                               | 150815附近Ei外层；150880 Agent行；151490批量候选仍纯黄                                                                                                                          |
| 成员浏览行                          | hover为黄30%，不因复用到覆盖层而升级为纯黄                       | zg：139251起，139300／139333；150680在成员管理路径复用                                                                                                                          |
| **Task详情弹窗里的负责人Agent选择** | **hover为黄30%**；当前负责人另用对勾                             | Jmt 170355起创建Ei＋wb modal；wb 170187／170221使用S9；169545 lazy映射Gue；172125调用rpt；171617起读取channelAgents，171819负责人使用JD；JD 155823明确`hover:bg-soft-signal/30` |
| **侧栏搜索会话的Agent候选**         | **鼠标移入更新当前候选，实际变为纯黄**；非当前行CSS hover是黄50% | btt 127899接收agents，127945按agent打开DM；128032的onMouseEnter更新index，128033当前index为`bg-soft-signal`                                                                     |
| 聊天输入区 @ Agent候选              | 当前候选纯黄；非当前频道内候选hover为黄50%                       | 117018起inChannel候选、117030的index分支；不是只有纯黄/30%两档                                                                                                                  |
| 通用菜单／单选菜单                  | hover及data-highlighted为黄30%；不是所有“选中”都用粉色           | 52329、52336、52341共享brutal menu规格；Itt 128340保持同规格                                                                                                                    |

负责人反例说明：即使整个Task是独立模态弹窗，嵌套的Agent属性菜单也保持自己的浅黄规格。
侧栏反例说明：基础页面的Agent候选也可能在鼠标进入后呈现纯黄，这是当前候选状态的结果。
因此“选择Agent”还需说明是浏览人员、添加成员、属性单选还是自动补全。

## 本地映射与预防规则

Raft CSS：`--color-soft-signal`指向`--color-brutal-yellow:#FFD440`。
`hover:bg-soft-signal`是100%；`/30`、`/50`分别显式应用30%、50%透明度。
本地历史`--soft-signal`却已经是`rgba(255,212,64,.3)`，对应Raft的`/30`，不是其无后缀token。

- 100%黄使用现有语义变量`--yellow`。
- 30%黄沿用本地`--soft-signal`的当前契约；不要再乘一次30%。
- 其他比例从不透明`--yellow`按来源比例混合；不从已经透明的变量二次混合。
- 创建频道的已选成员使用现有pink20%＋对勾；不要把它推广到所有候选列表。
- 不新增`.dialog ... hover`或`[role=dialog] ... hover`之类按祖先层级全局覆盖的规则。
- 修改或新增Agent选择组件时，记录所属组件家族和rest/hover/current/selected/disabled，
  查明鼠标进入是否更新active index，再复用正确的共享行样式。
- 浏览器断言检查实际computed颜色、指针退出恢复、已选行的悬停、键盘当前项及必要的嵌套弹窗场景。
  只检查class名、只比较单张截图或只判断是否modal，均不能证明颜色正确。

本次将以上规则写入`docs/design/neo-brutalist-ui.md`及AGENTS.md入口。
不更改生产CSS、token含义或业务协议，不进行全站颜色批量替换。
先前创建频道hover修复及其Chrome/Firefox与正式验收仍见
[创建频道弹窗对齐](2026-09-14-channel-create-dialog-parity.zh-CN.md)。
本批为文档变更，仅需格式、diff和来源/链接一致性检查；无需重启未改变的正式运行时。

## 追加：可复用协议与自由调色的边界

用户指出，仅列出组件差异仍会让独立开发时的颜色漂移。这个问题成立。
同一份来源矩阵已经足以提取「固定颜色档位＋独立交互状态＋有限组件配置」，
而不需要推导“所有弹窗一种颜色”。本次在维护中的
[UI规范](../design/neo-brutalist-ui.md#shared-choice-state-contract)集中定义
member-selection、member-browse、property-option、autocomplete四类配置、
状态叠加规则、owner及新增配置准入，AGENTS.md指向同一约定。

这是RAH对已有源码证据的设计归纳，不宣称Raft本身存在同名API。
未改变CSS、组件行为或canonical协议；未重复创建颜色注册表。
现有共享库拥有部分交互规则，但尚未形成覆盖这些配置的typed行组件接口及全量越界检查。
后续代码收敛必须用共享组件替换各页旧样式并加入门禁，不能把本次文档归纳算作已完成迁移。
