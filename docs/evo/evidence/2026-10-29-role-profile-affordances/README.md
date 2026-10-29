# Role 双编辑入口与运行时信息

描述、提示词右侧各有一个官方铅笔按钮；共用原来的双字段弹窗与单次Role修订。
通过DialogSheetContent的原生initialFocus把光标放入对应Textarea，关闭回到原按钮。
不使用延时抢焦点，不拆成两个互相覆盖的配置写入；提示词入口也走同一脏草稿确认。

## 官方复用与 Loom 数据

独立取得官方`db5e399f017d584e49597e3a28757645d6807893`的
`packages/web/src/components/machine/RuntimeAccountUsageChip.tsx`，完整原件及SHA见
`frontends/raft/upstream/runtime-info-2026-10-29`。生成器提取Badge、浮动Card、Header及
移动BottomSheet组合，保留官方200ms打开、160ms关闭、点击固定、外部点击/Escape关闭
规则与viewport clamp。复用已有官方BottomSheet/useViewportClamp/dismissLayer及CloseButton
兼容入口；没有在不透明官方API之后虚接一个Loom数据库。

Loom适配的字段为Host原有inventory：本机检测、CLI版本、可执行文件、模型数量与检测时间。
版本缺失用原生“版本暂不可用”，灰色表示未检测到/未知，绿色只表示CLI已检测到。
原生Status的sm尺寸及Chip排版保留。此次不是把账户健康含义悄悄套到本机安装状态。

**真实账户额度未接入。** 当前Loom协议没有官方所用的runtime-account-usage读取/刷新
接口；原组件该部分依赖Raft Server/Computer收集器，而不是靠前端就能得到余额。
浮窗明确显示“当前未提供账户额度”；不由CLI安装、模型目录、登录猜测或历史token推算。
没有假额度/百分比/重置时间，没有新启动Provider进程、账户探测或后台刷新轮询。
因此完成的是运行时信息UI和已有真实事实的接线，不宣称账户剩余额度已经可查。

## 验证

先以缺少提示词铅笔/initialFocus/运行时信息组件的断言失败，再实现。
定向检查包括官方源SHA/再生、单修订、检测状态与额度语义；UI场景所有权、类型与构建。
1440×1000和390×844，临时Core/Fake目录：两个入口实际焦点与返回焦点正确；
一次保存两字段只有一次revise；桌面hover移入卡片保持、移出收起、点击固定/Escape；
手机点击及底部卡片关闭。额外验证Host声明CLI不可用时为灰色，而非健康/额度正常。
截图为模拟尺寸，非实体手机或真实账户额度验收。正式环境不创建测试对象。

9项定向检查、8项UI场景检查、Loom类型和产品构建通过。`eed83c1d`已推送并备份／平滑重启，schema91、账本及配置保持，LAN/Tailnet原CA验证通过。正式Chrome新页面确认两个入口实际焦点、真实CLI版本及检测信息，账户额度仍明确未知；没有保存配置，已关闭验收标签。见deployment.json和formal-page.json。
