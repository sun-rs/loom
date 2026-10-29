# 频道创建、Role 配置与头像清晰度

## 变化与边界

- 频道创建有名称、描述、工作区文件夹及可选成员。文件夹的＋复用ComputerFiles文件树，
  仅目录可选、不显示上传；原Composer文件引用/上传路径保留。目录仍由Host校验，
  平台频道主目录和附加目录的创建后冻结规则不变。
- 名称/描述/成员的JSX独立取自官方`db5e399f017d584e49597e3a28757645d6807893`，
  不修改上游原件；`upstream/channel-create-2026-10-29`保存源及SHA，
  `generate-channel-create.mjs`负责再生。成员用现有Role目录，选择后各实例化一次，
  不引入多人账户、Slack或公开／私密配置。工作区是明确的Loom插槽，非官方全应用照搬。
- 创建与成员加入分为现有Kernel操作。先确认频道，再串行实例化；部分失败显示已建频道，
  只继续剩余成员。未知写入使用原WriteIntentSlot相同key/basis核实，不重复创建频道。
- 频道设置标题不再显示公开／私密标签。现有UI没有其他可见性入口；历史visibility字段、
  ACL、成员围栏、实例私聊、Side与文件树“显示隐藏文件”均保留。
- Role提示词真正允许为空：Protocol两处min(1)及Kernel实例配置规范化的非空要求修正，
  创建/编辑Textarea不再required。不填充通用提示词，不改变既有实例快照和连续session。
- 移除Role左侧列表筛选框。模型显示清理`local:<adapter>:`，真实绑定ID不变；
  只有多个effort选项时显示推理强度控件。单一effort仍由官方表单级联选择并保存，
  包括AGY模型ID已固定的effort，不发明模型别名。
- 新增58款图案重绘为32×32细节网格，稳定key不变；原生16款和2款保留图不动。
  Loom自制像素诠释不是官方品牌素材。扩展配色不覆盖原色，生成器只对详细网格开放
  尺寸和同行连续颜色合并；原8×8 SVG输出不变，仍一个缓存IMG，无外部图片请求。

## Kimi 根因

只执行免费元数据和交互式目录检查，没有提交模型任务。安装版本2.3.3的
`kimi provider list --json`只列K2.8 Preview、K2.7 Highspeed、K3、K3-256k；
原生CLI启动刷新返回`Skipped refreshing managed:kimi-code: The provided authorization grant is invalid`。
因此不是Loom漏解析K3.1 Pro，而是失效授权留下旧目录。已请用户`kimi login`，
不能通过硬编码未发布binding绕过；重登后应先在原生`/model`刷新，再刷新Loom目录
（Host元数据缓存60秒）。不更改账号、默认模型或现有session。

官方依据：[模型目录及切换](https://www.kimi.com/code/docs/kimi-code/models.html)、
[原生API契约](https://moonshotai.github.io/kimi-code/en/reference/server-api.html)。
官方发布K3.1 Pro不证明当前账号已有有效授权或已经完成付费调用验证。

## 验证

先记录空提示词、旧尺寸网格、可见性/筛选和旧目录输入的失败；新增Kernel完整实例化
测试进一步复现`instructions is required`，再修复真正的执行入口。源契约中的旧频道
弹窗位置检查改为检查新组件和原生MobileFormDialog，仍验证Sheet/busy边界。

- 根及Loom类型检查、产品构建、受影响Kernel/协议/图库/表单契约。
- 原生控件场景及源码/生成一致性检查；官方源hash独立校验。
- 1440×1000与390×844，真实临时Core/数据库、Fake目录、无付费执行：真实目录导航、
  仅目录选择、描述保存、可选Role实例化；故意丢失成功响应后同key核实，只有1实例；
  空prompt创建/修订；固定effort保存low且无重复下拉；模型内部前缀隐藏；32×32渲染。
- 截图为模拟视口；非实体手机。正式服务只读页面检查与部署收据另录；不在正式环境
  创建测试频道或Role，不声明新一轮成本/模型质量通过。Kimi重登仍是未完成前置条件。

已完成自动检查：541项源码/契约、37项受影响owner与回归、8项控件场景检查通过；
根及Loom类型、产品构建通过，桌面/390浏览器完整回环通过。各组存在重叠，不能相加
作为独立覆盖量。正式服务已在推送后备份／平滑重启，schema91、保护账本和配置校验保持，LAN/Tailnet原CA验证通过。`formal-page.json`记录新标签页的真实Chrome核对；未创建正式测试对象，模型草稿确认丢弃，侧栏恢复并关闭验收标签。Kimi仍待重登。
