# 文件评论输入区移除“打开讨论”

用户要求精简评论输入区，删除“打开讨论”。此前入口会导航到附件绑定的Thread；右上角×的
语义是关闭文件预览并恢复原先页面。从讨论中打开文件时，关闭后仍是该讨论；从其他入口
打开时不强制跳转到附件Thread。本次保留该区别，不新增隐式导航。

AttachmentComments删除链接及其未使用的navigationSearch导入，保留状态提示、发送按钮和
既有自适应输入框。FilePreview继续独占关闭、遮罩、Escape及焦点恢复，未修改后端评论关联。

来源沿用授权Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
pretty Jw 121814之后的紧凑评论composer复用发送入口。本次删除是用户指定的本地精简，
无新资源或代码复制，原来源/notice不变。对照Multica
`11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/source-context-comment-list.tsx`，其来源评论没有可替代本地
FilePreview关闭协议的路径，未复制代码（Apache2及附加条款）。

专项先复现打开讨论链接仍存在的失败，再验证桌面/390px评论加载、发送按钮保留、×关闭后
URL不变且回到原讨论内容。原完整附件门禁去掉对已删除入口的依赖，以×验证关闭，然后
独立通过规范Thread路由核验评论文件引用；未删除评论投递/引用断言。

Chrome/Firefox新专项通过；Chrome完整附件门禁通过，覆盖八种预览、评论投递/引用、失败重试、
重复请求去重、115条评论三页顺序及刷新。完整 `npm run check`、格式/diff检查和正式构建通过。
首次全量检查遇到并行任务历史修改的类型/样式中间状态；其修正后重新执行全量检查通过，
本次未改写任务历史实现，仅同步共享样式匹配证据。

正式工作台通过空闲检查、持久状态备份及优雅重启，备份为
`/Users/sun/.rah/backups/pre-restart-1adad0b4-6938-4d6e-8875-748415662f38`，
冻结构建 `177141ba4afda037d83abc30b782b3d6074584c76667180eeed4c064259086bf`。
新真实浏览器从既有报告讨论打开文件，在1440px/390px核验评论载入、无打开讨论链接、发送
按钮保留，×关闭后URL和原讨论保持，刷新仍可进入原讨论。正式未发送评论或运行付费CLI。
截图 `/tmp/rah-comment-close-formal-1440.png` 与 `/tmp/rah-comment-close-formal-390.png`
已检查；没有新增Raft在线双边像素验收。
