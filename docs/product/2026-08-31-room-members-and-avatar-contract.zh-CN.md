# Room 成员页面与头像修复合同

用户本轮明确要求：成员头像同尺寸；新Agent默认分配未使用的头像；设置页“＋→添加→返回”回设置页，人数摘要才进入成员管理。这是限定修复，不包括尚无后端合同的频道归档/删除、Human邀请或频道个人偏好。

## 来源与裁决

当前官方`index-BoAC7nSE.js` SHA-256为`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：

- `Bst` 3092523–3095252：成员摘要、头像网格；`panel-header`头像36px、8px间距、＋36px虚线边框，wrap布局。
- `Nst` 3031217–3048132：独立成员/添加页面；搜索、分组、批量选择、逐项提交；失败项保留、成功项移除，不伪称批量原子性。成员头像28px，添加候选20px；header高度来自全局panel header。
- `Hst` 3095880附近：root/members视图；＋通过initialView=add进入成员组件。官网添加返回成员页，本地按用户要求保留**真实入口来源**：从设置进入返回设置，从成员进入返回成员。
- 随机头像`o$e`1855676–1855821、`l$e`1855821–1855910、`c$e`1856089–1856375：32-bit字符串hash、mulberry32、12组配色、8×8水平镜像、填充概率0.45。复用该算法及已有palette，不另造图案规则；不复制无界缓存。

偏移单位UTF-16。真实官方设置与添加入口已只读打开，未提交成员变更。最终双边与本地结果另记审计。

## 单一owner与实现方案

1. `protocol`提供跨端一致的头像key与纯pattern recipe（不含DOM/CSS）；`ui-tokens`既有官方palette/preset提供颜色。Kernel在`agent.provision`事务内生成并检查随机pattern签名，持久化到AgentDefinition；幂等重放不再分配。Web创建默认为自动，用户手选preset保留。
2. 老数据中的`claude/codex/kimi/opencode`不是官方preset，过去全回退robot。本地渲染按持久化key稳定生成官方random图案；没有key的旧Agent按participantId生成。不是每次render随机，不重写用户配置、历史revision或memory。显式同preset允许保留：默认防碰撞不意味着擅自覆盖用户手选。
3. `RoomMembersDialog`仍只拥有一个drawer和一次focus trap；成员子视图独立组件。资料草稿留在父级，返回不丢草稿；子页Escape返回上一级，root Escape关闭。pending期间阻止退出/重复提交；返回焦点落到原入口。
4. 增删复用现有`onboardAgent/removeAgent`、Room membership和client-core stale-context重试，不创建新成员API。批量按选中项顺序执行；只重试失败项，错误可见。成员角色读取canonical RoomMembership，不能将人设role当权限标签。
5. 设置主页面avatar/header同尺寸；不让通用sidebar尺寸覆盖局部36px合同。成员页Human/Agent分组与搜索；操作行尽量使用官方布局，缺后端动作禁用并解释，不用空成功回调。

## 验收门禁

- 先失败：当前头像相同/尺寸不同、＋内联展开而非添加页、返回路径与搜索/选择不成立。
- 单测：random recipe确定性/镜像/碰撞重试/持久key；创建自动与手选；批量部分失败、重复点击、权限、返回路径。
- 浏览器：同尺寸官方/本地的设置→＋→返回、摘要→成员→添加→返回、成员增删/筛选、pending/Escape、资料草稿保留；桌面与390×844，头像几何和状态点，轮询不抖动。官方不作业务写入；增删在隔离Kernel/Fake CLI环境，不冒充真实模型工作。
- 工程check、正式build、format/diff；检查在途工作、备份后重启正式4173，新页验证不同头像和三页路径，保持历史/配置/记忆。

设计自审：不改变Room/Agent身份关系，不清理旧重复头像配置，不扩大CLI安装、权限或记忆系统；random recipe只复用已阅读的纯函数，并记录local collision guard是额外增强。全部页面不是本批收口声明。
