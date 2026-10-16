# 原生表情回应、中英文排版与无对外分享边界

## 范围与来源

Owner 要求保留中英文字体与字号，并明确产品不需要对外分享。本批不接分享链接、匿名页面或公开发布；内部转发也未启用。该范围已写入目标合同，未删除历史协议或改变冻结后端。

来源为 `https://github.com/botiverse/raft-source` revision `a98ae003246a0360872a77d76dec2fccd0347ef7`：MessageItem → MessageHoverToolbar → ReactionGlyph／ReactionCount → 原生 reaction picker、context quick row、reactor popover；styles来自 raft-ui 0.5.64。保留FSL-1.1-ALv2及MIT声明和owner复用授权，原始官方源码文件未改。

`reaction-adaptation.ts` 在已有消息任务适配之后替换数据hook和提交函数，复用原生回应条和选择器。桌面hover工具栏直接复用MessageHoverToolbar，省略尚未接入的收藏按钮；右键／手机长按仍由原生MessageItem处理，readOnly分支只包含原生quick row与已有Loom任务菜单，不暴露官方分享或上游业务写入。原生计数尺寸、选中颜色、emoji图形及弹层参数保持。

## 数据所有者

Kernel `message.social`／`message.react`仍是唯一事实来源。MessageReactionsProvider仅为当前有界消息窗口的读取投影，每批最多100个ID，去重后分批读取、15秒更新；离开窗口取消读取，不为每条消息发一个请求。以version阻止旧读覆盖新写；没有官方乐观消息store副本。

提交复用当前频道／消息列的RoomSession与WriteIntentSlot，同步因果序号后发送明确active=true/false。请求失败不乐观伪造计数。未知结果保留原payload、basis与idempotency key，由Human明确核实；测试确认服务器已经提交而响应丢失后核实不新增第二个回应。归档、停用私聊及权限信息未取得时不给回应按钮；复用既有composer只读边界，并有专项回归。

频道、消息列父消息及回复接入；实例私聊复用频道视图路径，但本批没有独立私聊写入验收。搜索结果仍为只读投影，不宣称所有消息出现位置都支持回应。其他成员变化通过定时读回显示，不宣称实时推送。

## 字体与字号

对两种官方主题、1440×1000和390×844、DPR1进行浏览器FontFaceSet及CDP实际字形检查：本机中文使用系统 `PingFang SC`，Brutal消息英文字形为 `Hanken Grotesk`，Elegant消息英文字形为 `Inter`。消息预览小／中／大分别为12／14／16px，两尺寸一致。Geist／Geist Mono等原生界面字体继续本地加载，未改主题变量或CSS规则。

这是当前Mac上Chromium的真实字形证据，手机尺寸不等于物理iPhone测试。其他系统中文遵循官方system-ui回退，不硬编码PingFang，也不引入替代中文字体。无Google字体网络请求。

## 验证

- 新增客户端测试先缺实现失败；覆盖100项分批、明确active及未知结果精确核实；适配测试校验原生quick row逐字保留、隐藏未接收藏、源码漂移拒绝。
- 旧部署构建缺回应入口的浏览器失败保留。修复测试核实按钮名称后，隔离Core的频道及消息列均完成桌面hover／手机真实触点长按、添加、丢响应、精确核实、计数不重复及取消。
- 手机消息列首轮点在外层12px留白，未触发原生长按；改用实际MessageItem边界内触点后通过，未改产品布局或长按规则。线程夹具第二个视口复用了已有thread root导致409，改为独立根消息，未放宽后端约束。
- 107项源码测试、前端类型检查、产品构建、格式及diff检查通过。顺便修复字体构建模块的TypeScript闭包窄化问题，运行字体映射不变。
- 未执行全后端套件、完整浏览器套件或付费模型。部署及正式页面结果见[证据](../evo/evidence/2026-10-16-reactions/summary.json)。
