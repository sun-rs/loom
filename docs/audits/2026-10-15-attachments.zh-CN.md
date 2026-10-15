# 附件与计算机文件引用接线

Owner 本批裁定：暂缓任务描述／审核新入口；先完成附件链路。默认加号引用计算机文件，手机／平板另有系统文件／图片上传入口。路径引用与上传附件是不同操作，不把选中路径冒充成已发布 Artifact。

## 来源与单一所有者

- 官方界面来源：[Raft a98ae003](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，Owner 已授权。保留 notices 和官方源码逐文件摘要；没有修改 frontends/raft/packages。
- 直接复用：MessageInput、ComposerActions／ComposerIconButton、ComposerAttachment 系列、Dialog／Select、SelectionPopover、AttachmentChip、GalleryImageItem、MessageImageGallery 的布局算法和 ImageLightbox。图片画廊、文件卡、缩略草稿和弹层不另设尺寸／颜色体系。
- main 参考版本 f1bc8c9d2f70b44aa5e1cacc2362e8905ed4c612：apps/web/src/file-uploads.ts 与对应测试结构迁入本地组合层；仅替换已退休 ui-web 的随机 ID helper 为 Web Crypto UUID。composer-computer-files.tsx／composer-controls.ts 的授权目录浏览、隐藏文件、引用当前目录／多文件与带引号的 @ 绝对路径语义沿用。旧复刻 UI 源码没有恢复。
- main 的移动端直接 file input 覆盖触点方案沿用，见[既有设计](../design/composer-attachment-pickers.md)。当前官方按钮内部图标有 z-10，透明 input 在局部 isolate 内置 z-20，避免图标拦截真实 tap；没有通过强制点击绕过。
- 文件持久状态、鉴权／频道绑定／哈希和消息事务仍属既有 RoomFiles／Kernel。FileUploadStore 仅管理按 composer key 隔离的内存草稿；频道／私聊／消息列仍用原 RoomSession 和 WriteIntentSlot，提交冻结 attachmentIds，未知结果核实原请求。没有修改后端、调度、提示词或 Provider。

## 端到端行为

| 行为           | 当前接线与边界                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 加号 → 文件树  | 调用 computer.files.list，后端负责授权根与路径校验。目录切换中止旧请求；读取失败清空旧内容。文件可多选，未选文件时引用当前目录。确认只插入正文，不发送、不上传。       |
| 计算机选择     | 使用官方 Select；当前接口实际只连接本机文件浏览器，因此只列本机，不编造可用远端。远端机制继续冻结，远端选机浏览未验收。                                                |
| 手机／平板上传 | 根据 any-pointer: coarse 显示系统上传入口，不依赖窄屏判断。真实 input 支持多选，选择后清空其值；取消不上传。同一文件可再次选择。保留按钮键盘入口。                     |
| 桌面上传       | 默认加号仍是文件树；文件拖入或粘贴进入同一附件草稿。不是新增桌面上传菜单。                                                                                             |
| 草稿           | 既有单文件上限与每条最多10个附件；空文件拒绝。上传／失败不能发送，可移除后重选。切换对话不混用草稿，内存草稿不写浏览器持久存储。刷新未发草稿不承诺恢复。               |
| 消息           | 频道／私聊／消息列支持仅附件或正文＋附件，显式发送。未知结果保留提交，核实同一幂等键／Room seq／附件集合，不重复发表。任务创建仍不支持附件，可先发消息再转任务。       |
| 展示与下载     | 已发表附件来自 canonical Message 投影。常见栅格图片使用官方画廊、大图与下载，文件使用原生 AttachmentChip 下载。图片资源 URL 仍走本地鉴权文件路由，未改鉴权或公开文件。 |
| 未接范围       | 复杂文档、音视频的专用预览／批注、频道文件管理页、转发、远端文件树；不以下载可用冒充上述能力完成。SVG 等非白名单图片作为文件下载。                                     |

## 验证和保留的失败

先验证缺少上传 owner 的单测失败、旧构建缺少加号入口，再实现。旧“附件未接入”投影断言按新契约替换为 ID／名称／MIME／大小精确映射，并在旧实现上确认失败。迁入 main 的三项上传状态回归覆盖删除后晚到响应、成功提交快照及 Room／Thread 草稿隔离。

临时真实 Core 使用关闭执行的 Fake CLI；无付费或真实模型调用。桌面1440、手机390×844、平板820（DPR1，手机／平板真实 touch）验证引用路径、原生 filechooser 多选／取消、附件-only 发送、丢响应同请求核实及刷新后字节一致下载。补验同文件重选、上传失败阻止发送、消息列首次创建＋附件回复未知重放、私聊附件不进入频道、官方图片画廊／大图。

初轮错误保留：文件树错误使用无 Dialog 根的子组件，改回完整官方 Dialog；透明 input 被按钮图标层挡住，真实 tap 回归先失败后修复；夹具最初在初始读取未完成时直接 setInputFiles，改为先通过真实控件可操作性检查；夹具读取刚发送图片前未等待消息落地，改为等待实际消息再核验。失败未通过放宽业务断言掩盖。

截图与完整检查、WebKit 和正式只读页面的最终结果见[验收记录](../evo/evidence/2026-10-15-attachments/summary.json)。浏览器 filechooser 自动化不等于 iOS 真机系统菜单验收。正式服务不发送测试附件；业务写入只在临时状态中验收。
