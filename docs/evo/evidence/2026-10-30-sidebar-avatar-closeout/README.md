# 侧栏完整间距核对与 Role 头像接线

本批响应 owner 的三个问题：侧栏层级间距、头像上传缺失，以及新建／随机头像不能重复占用已有 Role 的头像。它是现有部署上的定向修复，不代表完整 Web 业务适配迁移已经完成。

## 侧栏：实测结果与限制

原样运行完整 Web1.21.40 归档，使用其实际 vendor／CSS。2026-10-30 再次取得官网入口，模块、vendor 与 CSS 文件名仍与锁定版本一致；没有混用另一个发布版本。`native-sidebar.json` 记录归档校验、四个页面的真实 DOM 测量及隔离请求。成员列表显式投影合成测试数据到官方自己的 store；这不是 Loom 的产品数据／业务接入验收。

| 桌面量值，1440×1000、DPR1、缩放1 | 官方     | Loom     |
| -------------------------------- | -------- | -------- |
| 相邻普通行                       | 2px      | 2px      |
| 分组标题上内边距                 | 16px     | 16px     |
| 标题容器底部至首行               | 8px      | 8px      |
| 计算机小分组至首行               | 8px      | 8px      |
| 前一计算机分组末行至下一小分组   | 14px     | 14px     |
| 前一组末行至下一组标题文字区域   | 24px     | 24px     |
| 普通行／计算机行高               | 38／60px | 38／60px |

聊天、Role、计算机、设置四类窄侧栏均已检查滚动原点、标题、列表和组间关系；Role 使用两个计算机分组，而不是仅测一个分组。聊天／Role／设置的相邻行均有覆盖；计算机使用实际实例对应的本机条目。

原点差异也必须说明：聊天先显示“已保存”，第一分组容器在54px；计算机／设置第一分组容器在0px、文字在16px。官方成员页在 Agent 分组上方还有54px的“关系图”模块；Loom 未实现这个功能，因此 Role 分组从0px开始，不补一段54px空白。官方还保留多人／联合频道等 Loom 没有的内容分组，省略后不能比较整个页面里每个条目的绝对 Y 值。

**本批未复现桌面侧栏上述间距与锁定官方版本不一致。** 没有为迎合印象再加全局／逐页 CSS 补丁。新增的是完整层级检查及证据，之前只测单行的报告不足以覆盖这些关系。手机仍保留此前 owner 采用的原生 App 紧凑布局例外；本次手机验收针对头像操作，不把桌面数值宣称为全站／手机一致。

## 默认随机与手动选择

- Kernel 在创建事务内、幂等回放之后选择，前端不再预填一个随机值绕过服务器分配。
- 使用当前工作区有效 Role 的**当前头像去重集合**；例如3个 Role 占用2款，只扣除2款。已删除 Role、旧修订和冻结实例不额外占用名额。
- 新建默认和“随机头像”按钮共享 `availableAgentAvatarKeys` 规则；手动选择始终保留全部72款并允许重复。
- 全部占用后按 owner 选择从完整库重新随机；不会因为最后一款未用头像已选在草稿中就提前回退到全部。
- 不改变既有 Role／Revision／实例，不在读取或重启时重新随机。

## 上传实际链路

按官方编辑器的预览＋上传图块＋分组图库组成接线。Upload 图标与18px规格、44px虚线图块均对应锁定源码；额外的“随机头像”图块是本次 owner 要求的明确扩展。支持现有图片服务的 JPEG／PNG／GIF／WebP，最多5MiB。

选择文件通过既有 `client.profileImages` 上传，取得内容键和短期凭据；此时只改草稿。Save 经原 `ManagementClient` 写入 Role 修订，凭据单独置于 create／revise 请求，不写进配置。Kernel 在同一事务中绑定图片和修订；幂等重试先回放，失败／过时命令不消费凭据。原生命周期服务统一回收未引用上传；所有不可变 Role 修订进入其引用检查，保护历史图片。资源适配器将 `upload_*` 身份键转换为既有同源 URL，避免原生渲染器把身份键当相对地址而退回机器人头像。

桌面和390×844视口验证随机排除已占用项、完整图库可手选、非法文件不改 Role、上传预览不产生修订、Save 后图片可解码及刷新保留。所有浏览器流程均使用临时真实 Core 和假运行时，不调用模型、不创建正式测试 Role。

## 验证与证据

- 新增测试先复现：自动创建重复占用、Role 请求不接受上传凭据、选择器缺少上传入口。修复后通过。
- `role-avatar-default`／既有头像分配与图片生命周期／图库／资源适配定向测试22项；表单／选择器 DOM8项；受影响 UI 源码契约24项。
- 根工程及前端类型检查、工作台构建通过。保留现有 bundle 大小提示，没有为了本次小范围修复运行全量后端或付费门禁。
- `native-sidebar.json`／`loom-sidebar.json` 为四页量值；Chromium／WebKit／Firefox 的头像记录及截图同目录。
- Firefox 首次严格拒绝测试 PNG 的错误 IDAT CRC；保留该失败说明，并换成校验正确的测试图重新运行。没有放松图片解码断言或为测试改变产品逻辑。
- 提交推送、安全部署及正式页面只读验证以本目录随后写入的收据为准；不会据此声明真机验收或整个官方 Web 业务适配完成。

## 已推送与正式部署

功能提交 `1f36f183` 已推送 `origin/main`。推送后重新构建、核对实际服务、验证完整备份并预演初始化，再平滑重启同一 Core。`deployment.json` 确认 schema91、14个保护表的逐表内容散列、原配置／通知／记忆文件保持不变；原本地CA验证 LAN／Tailnet HTTPS 首页成功。

`formal-page.json` 和 `formal-1440.png`／`formal-390.png` 是部署后的只读检查：官方72个 SVG逐项比较、图库组别／图块规格／原生弹窗正文与页脚关系，以及上传／随机入口都通过；两种视口均无配置写入和页面异常。正式环境没有上传测试图片、创建测试Role或调用模型。

复现入口：

```sh
LOOM_RELEASE_EVIDENCE=/tmp/native-sidebar node scripts/official-web/native-sidebar-spacing-browser.mjs
LOOM_PIXEL_AUDIT_EXPECT=140 LOOM_BROWSER_SLICE=sidebar-pixel-audit node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=role-identity node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=webkit LOOM_BROWSER_SLICE=role-identity node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=firefox LOOM_BROWSER_SLICE=role-identity node scripts/official-web/channel-browser.mjs
```
