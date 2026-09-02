# Room 设置、成员页与随机头像修复验收

本次范围是用户四张截图所指出的头像尺寸、默认重复头像和成员导航问题。
[施工合同与上游位置](../product/2026-08-31-room-members-and-avatar-contract.zh-CN.md)先于实现落地。

## 已修复

- 设置页 Human、Agent、＋均为36×36 CSS px；8px间距、自动换行。原Agent使用sidebar尺寸并被后加载CSS覆盖；不再靠不稳定的覆盖顺序修正。成员列表28px、添加候选20px，保留独立presence点。截图复核又发现成员行flex拉伸头像，已固定头像flex基准并纳入尺寸断言。
- 创建Agent默认省略avatarKey，由Kernel在创建事务内采用Raft的hash/mulberry32/8×8镜像算法分配随机key，检查现有随机图案防碰撞，写入AgentDefinition。幂等重放不再分配。已有无效provider key不再全部回退robot；未指定key的旧身份按participantId确定图案。显式手选preset不被覆盖，也不因为加入另一个Room而换头像。
- 设置→＋进入独立添加页面；搜索、checkbox多选、确认计数、禁用态和逐项失败恢复接入真实membership接口。成功项不重复提交，只保留失败项供重试。
- 人数摘要进入独立成员管理；Human/Agent分组与搜索，角色标签读取RoomMembership而不是Agent人设role。
- 返回保留入口：从设置添加返回设置，从成员管理添加返回成员管理。子页Escape走同一路径，恢复入口焦点；设置草稿留在父组件，不因子页切换丢失。pending期间阻止重复提交和退出。
- 390px实测发现旧CSS隐藏频道设置按钮，已使该按钮使用既有mobile-visible members合同；没有增加第二个移动端业务实现。

## 来源与差异

官方当前bundle的`Bst`（成员摘要）、`Nst`（成员/添加页）、`Hst`（设置导航）、`o$e/l$e/c$e`（随机头像）是来源。属于结构移植和RAH接口接线，不是字节完全复制。

官方实页只读确认：设置＋→添加→返回成员列表→返回设置。RAH的来源感知返回是用户明确指定的改进，不写成官方原行为。官方成员角色为server角色；本地展示真实Room角色。当前本地保留直接“移出”操作，尚未复制官方完整角色编辑菜单。官方未提交成员增删，没有把本地写入验收称为双边后端证明。

默认去重是本地增强。显式手选同一个preset允许重复；没有强制改写用户已有头像或历史revision。分配器检查当前Workspace现有定义，不是一个跨Workspace、跨所有历史版本永久保留的头像注册表。

## 真实浏览器证据

1. 修改前隔离UI回归实际失败：36px一致性不成立，＋没有独立添加页面。修复后完成36px/28px、头像不同、两种返回路径、双击防重和部分失败重试；调用序列为`Grok,Cindy,Cindy`，成功的Grok未重复提交。测试页明确标识“不连接daemon、不调用CLI”。
2. 4198隔离daemon实页：创建私密`成员修复验收-0831`，搜索Kimi，实际键盘清空搜索恢复Alice/Kimi，多选添加两人；设置显示1Human+2Agent。成员页移出Alice，刷新后仍是1Human+1Agent。另保存描述`成员界面验收：返回后保留草稿`，再次冷加载保留。没有使用真实付费CLI。
3. 390×844、DPR1：从正式产品组件的移动标题栏打开设置，Human/Kimi/＋全部36px、无横向溢出；独立添加页、Escape返回、草稿保留、焦点回到＋均实际检查并查看截图。1440×1000、DPR1完成本地成员列表截图复核。
4. 官方与本地正式页同为1049×1172、DPR2，逐页检查设置/成员/添加布局和返回语义；实际截图已查看。1440和390是本地验证，不能称为这些视口的官方双边验证。

## 工程门禁与部署

- 最终`npm run check`：685项package测试（683通过、2项真实CLI opt-in跳过）、96项Web测试、33项真实回调测试；共814项、812通过、2跳过、0失败。TypeScript通过。
- `npm run build:web:workbench`、`npm run format:check`、`git diff --check`通过。构建仍有原有大chunk警告，不把它隐藏为性能已收口。
- 旧静态所有权断言要求内联展开，已改为独立成员页合同；既有真实浏览器业务gate的成员操作辅助函数也已更新。本轮通过内置浏览器执行上面的实际操作，未宣称整套独立浏览器gate全量重跑。
- SQLite测试证明自动生成的两张图案不同、创建重试key不变、数据库关闭重开仍保持、手选cat保留；未让真实CLI参与头像分配测试。
- 备份：`/Users/sun/Library/Application Support/RAH OS/backup-before-members-4MmWBv`。两份SQLite完整性均ok。重启前只有1completed Activation、1exited Run、1terminated RuntimeProcess，无Task；没有打断活跃工作。
- 优雅停止正式进程93243，确认4173释放后启动新进程10288。固定Web目录`.workbench-web/99e39f1c1eb5382a33c0ffdb9a1123a80a665c9eacbbc211dff307c491f6a7e9`，正式HTML入口`/assets/index-Bem-nFAb.js`。正式新页载入四家本机CLI身份，未换成Fake环境。
- 重启后逐表比较备份：2Workspace、4Room、12Membership、2Message、4AgentDefinition、8Revision全部内容不变；配置/凭据/私有目录8个普通文件逐字节一致。正式设置页1Human+2Agent及＋均36px，两个Agent图案不同；正式新页再次实际检查两种返回路径，未更改用户成员。

本批最终跨日至2026-09-01：补上全宽手机设置根页的明确关闭按钮（桌面仍维持官方无额外按钮的外观），实际390px点击关闭后dialog消失，焦点回到频道设置入口。重跑全部814项门禁与正式构建后，再次确认无活跃工作，优雅停止10288并启动最终进程12382。最终固定资产为`.workbench-web/75d9fd98d3138abe7db377c368fd24ae0272f902b29a024c78a53add7fd120c0`，入口`/assets/index-ByHq09D8.js`。六张业务表、所有私有/配置文件再次与本批备份逐项一致，数据库integrity_check为ok。上面的10288/99e39f记录是首次部署，不是最后运行版本。

## 未收口与本轮边界

不能由本批宣称聊天室设置完整等同Raft。频道个人偏好仍禁用；归档、退出、停止频道Agent、删除频道的完整设置页操作未接齐；可见性仍通过本地设置表单保存。Human头像上传、Human邀请与完整成员角色编辑、官方头像点击详情/hover在这些新成员行的完整移植未包含本批。大成员数量的官方压缩预览策略、设置根页退出时的未保存确认也未完成。

本次没有提交或推送代码；保留工作区此前未提交的行为指南文档。正式用户入口为`http://127.0.0.1:4173`，4198仅用于隔离验收。
