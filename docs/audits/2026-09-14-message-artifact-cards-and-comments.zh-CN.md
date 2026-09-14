# 消息附件卡片与文件评论

后续用户要求：[移除评论输入区“打开讨论”](./2026-09-14-comment-composer-remove-discussion-link.zh-CN.md)，取代本文记录的保留入口决定。

## 来源与范围

参考发布的 [Raft index-MqTUR4Ez.js](https://app.raft.build/assets/index-MqTUR4Ez.js)，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
授权分析副本：`/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。
`qA/wst`（pretty 142454附近）规定消息卡176×80、px10/py8、文件名12px粗体、
元数据10px、1px黑色15%边框；hover为黑色5%底和30%边框。加载为黄色30%底，
底部24px黄色状态条和2px上边框。`rot`（144253附近）限制单图片416×288，
无尺寸时176px、4:3；本地没有上游缩略图服务，认证读取受限图片后按自然尺寸呈现。
`Jw`（121500附近）规定文件名标题、11px空状态提示、头像/时间/文件引用和紧凑输入。
预览侧栏320px，`transition-[width] duration-300 ease-in-out`，移动端沿用已有45dvh布局。

本批是参数和结构移植，加上RAH既有受认证文件接口接线；未复制发布bundle或引入上游运行时依赖。
沿用已有素材和notice，未新增第三方资源。文件列表仍由原Files行组件拥有；消息附件独立采用紧凑卡片，
复用同一FilePreview、下载接口、对话框焦点和资源清理协议。Markdown/HTML维持全屏。
入口评论上下文和PDF/音频排除规则不变。保留本地已有“打开讨论”入口，放在评论输入区。
HTML仍使用受限sandbox，未为复刻页面交互放开不可信脚本或网络权限。

## 持久关联与投递

核查发现原 `attachment_comment_links` 已记录附件ID，但Message projection与Worker文本输出未保留关联。
Kernel AttachmentCommentsService继续是唯一评论owner；新增 `messages.attachment_comment_json` 为该关联的
可恢复显示投影，仅保存不可变附件ID和文件名。启动从历史links修复缺失投影，读取不依赖当前列表中的文件。
Human评论事件同时包含文件名；普通消息文本保持原样。Web消息显示“回复：文件名”，
Worker历史/实时读取输出明确的文件名和附件ID，因此同一原消息下的Markdown与HTML可被区分。
旧事件幂等重试按原附件ID、anchor、body和recipients比较，兼容未携带filename的历史事件。
Worker评论仍进入同一关联投影和原有授权/续发处理。

若文件尚无讨论线程，首次Human评论通过既有 `followAgentThreadParticipants` 将仍为当前Room成员、
且启用的Agent文件作者作为已参与者加入新线程关注，再由原 `replyThread` 派生Inbox/Activation。
此项是实现用户“就该交付文件向Agent提问”的RAH接线，未声称取得Raft中央服务的对应服务器实现。
已有线程不强制重新关注，尊重取消关注；Human作者、停用或离开Room的Agent不会因此被加入。
显式@仍使用原成员解析；不唤醒无关Agent，不绕过权限和执行围栏。

## 验证

先以测试复现640px大卡、缺失Message文件引用，以及首次评论未投递给Agent作者。
针对性测试覆盖投影、重启回填、Agent实时/历史文本输出、新线程作者参与和已有线程取消关注。
浏览器验证使用隔离临时Room及假Provider，不向正式Room发送消息或调用付费CLI。

`npm run check`通过：核心1595项（1578通过、17跳过、0失败），Web单测410项通过；
`npm run format:check`、`git diff --check`、正式Web构建通过。最后的图片可见区域加载调整另以类型检查和卡片浏览器门禁验证。

`test-message-artifact-cards-browser.mjs` 在Chrome、Firefox的1440×900和390×844验证卡片尺寸、
HTML真实请求待完成时的黄色状态、文件名标题/placeholder、300ms侧栏及文件列表/PDF/audio入口排除。
`run-attachment-comments-browser-gate.mjs` 在Chrome、Firefox验证八类预览、真实隔离后端评论、
115条评论分页、读取失败恢复、发送重试幂等、reload、键盘发送、焦点返回、HTML跨段区域与sandbox隔离，
并验证聊天Thread中的文件回复标签。截图已检查。分页门禁明确选择原附件的首个可见入口，
允许原消息同时出现在聊天正文与Thread父消息位置；断言仍读取同一附件的完整分页结果。

正式构建`e523e2194c3ef22c6115c53addf6bb25fb61b9b9e52515f9f6d0cc07812f9425`
由同仓库并行交付流程在本批收尾期间完成备份与优雅重启；已核验其备份receipt、新进程与一致的构建标识。
本批新建真实浏览器页面打开正式频道的现有Markdown附件，验证174px按钮内宽（176px卡片）、
全屏预览、评论按钮、完整320px展开栏、可见且启用的输入框及Escape关闭；没有发送正式评论。
本机、LAN与Tailscale正式入口的新页面构建一致。未运行付费CLI，未宣称实际模型已回答测试问题，
也未宣称完成同视口在线Raft双边像素验收。
