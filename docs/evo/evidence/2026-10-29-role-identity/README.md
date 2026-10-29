# Role 头像与描述／提示词分离

Owner2026-10-29明确要求新增随机头像、主题像素库，以及独立展示备注。空态高度规则保持不变。

## 结果与所有权

- 新Role在创建草稿时抽取并固定头像，API缺省也在Kernel创建事务中、幂等重放检查之后
  抽取并保存；重放/刷新/服务重启不重新抽取，不修改已有Role和实例。
- 原生16款可选头像与2款保留头像原件不动；新增 **58款Loom自制8×8像素诠释**，共74款
  可选。分为AI/运行时13款、EVA13款、鲁路修4款、哆啦A梦6款、宝可梦22款。
  `avatars/presets.json`记录名称、分类及全部像素，提供分类、搜索、预览和随机选择。
  火焰鸟对应用户所称“火烈鸟”，皮卡丘及三只初始伙伴的进化线均包含。
- 原始Raft调色板、PixelAvatar SVG缓存和单IMG渲染器保持原样；生成器仅将数据导入
  接到 `pixel-avatar-library.ts` 合并层。无外部图片请求，未把新的诠释图案标为官方Logo
  或Raft官方预置。原有finch/mug仍不参与手动库和随机选择。
- Protocol只记录额外预置的稳定身份key，不依赖UI网格；实例头像归一化、Human/Worker
  头像白名单同步识别新key，未知值仍拒绝。旧codex/claude等兼容映射不改变。
- `description`是独立展示备注；`instructions`为真正的角色提示词。资料页上下一并显示，
  一个“描述”铅笔打开原生表单Sheet，一次保存一个不可变RoleRevision。备注为空时灰色
  显示已发布模型名＋effort，并作为输入框placeholder；实际value保持空，不保存占位文字。
- 原始MemberAgentRow的标题/副标题/尾部span/宽度约束重新保留，CLI由已验证Host目录提供。
  备注可被压缩隐藏，角色名和CLI仍按原生规则排版；不从不透明RuntimeOfferID猜CLI。
  搜索范围包含名称、展示备注及CLI，不把隐藏的可执行提示词混进列表备注。
- 修复真实执行边界：旧standing-prompt-compiler会将description拼进Initial role。本批移除
  此拼接及lease转发，验证只改备注时prompt与deterministicDigest相同。旧`role`前言仍完整
  保留在可编辑提示词中，不用猜测迁移丢掉用户指令。既有实例快照/session不变；已经进入
  旧原生session的历史文字无法逆向移除。本批不宣称付费CLI或成本门禁通过。

## 来源和接线

官方不变原件：`db5e399` 的 `PixelAvatar.tsx`、`pixelAvatars.json`、`MemberAgentRow.tsx`、
`Sidebar.tsx`；包 `@botiverse/raft-ui@0.52.0`。
`generate-shared-content.mjs`和`generate-identity-rows.mjs`负责再生，不手改生成结果。
头像预览/40px选择按钮的组合沿用AgentProfileEditDialog；分类和搜索是额外数据的Loom接线。
移动弹窗复用现有MobileFormDialog和官方DialogCommit：后者把保存按钮送到手机顶部栏，
不依赖原生Sheet已隐藏的底部Footer。名称编辑、运行时联动和未保存离开守卫继续保留。

## 验证

新建头像缺省、描述回环以及新头像在实例显示时被旧归一化替换的问题先复现；新增
standing提示不含备注的测试先失败，再修复。源契约、类型、产品构建、Kernel/daemon
受影响owner及1440/390真实浏览器交互分别记录于本目录。

浏览器为隔离Core、临时数据库和Fake CLI；未在正式服务创建测试角色/频道，未调用付费
模型。截图为模拟尺寸；非实体手机。新库总览在 `loom-avatar-library-preview.png`。

附带修正一个旧测试：role-channel-mvp仍要求“有实例不能删频道”，在本批修改前的
`8cfc4238`独立源码/包依赖快照中同样失败，违反owner2026-10-28删除契约。将删除校验移到
协作流程结束，明确断言频道移除、Role保留及另一频道实例隔离，未改变产品删除实现。
初始失败日志保留，不把新规则回退来迎合旧测试。正式部署与只读页面核对另见deployment.json。

最终记录：535项源码/契约检查与79项受影响owner检查通过，根/Loom类型及产品构建通过；创建、双字段编辑、头像持久化/刷新和旧资料兼容分别在1440/390视口通过。代码推送后备份并优雅重启，schema仍为91，角色/实例/账本/个人偏好和通知记忆文件校验保持。正式Chrome只读检查完成；Firefox当时由用户操作，因此不宣称本批Firefox验收。模拟截图与实际产品页面的验证分开记录，未运行付费模型，也未产生正式测试对象。
