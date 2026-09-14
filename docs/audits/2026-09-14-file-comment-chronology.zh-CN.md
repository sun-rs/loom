# 文件评论按时间阅读

按用户明确要求，文件评论从早到晚显示，所有文件与章节/行号/区域评论进入同一时间序列。
这替代之前按文件位置分组的呈现规则。

Raft授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`（SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`），
Jw/排序G（pretty 121638–121646）先按anchor位置、再按时间排序；RAH此前沿用此优先级，
导致较新的整份文件回复出现在较早的章节问题前。本项是用户指定差异，不宣称Raft原行为如此。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/source-context-comment-list.tsx:31–35`使用创建时间升序、
再以ID消除平局；未复制代码。本地具有Room序号，因此使用该持久顺序消除同时间平局。

唯一呈现所有者 `orderAttachmentComments` 改为比较实际时间戳，再比较roomSeq，
不修改输入数组，不删除锚点或影响位置跳转。Backend附件评论服务继续按原有游标
获取有界页面，保持权限、历史、投递和分页契约；本项不扩大历史加载范围。
所有文件类型与Human/Agent共用此顺序。

验证先复现后修正：较新整份回复与较旧章节/行号问题的交错、等价时区时间、
同时间的Room序号，以及原输入保持不变。分页浏览器检查去掉原来掩盖顺序的sort，
直接对照后端有序内容，覆盖最新页、早页、早页阅读期间新增评论、返回最新和刷新。

完整 `npm run check`、格式、diff与正式构建通过。Chrome完整附件评论专项通过，
包括115条评论的3页、不重复分页、早页期间新增、返回最新、刷新、定位和失败重试。
Firefox在末次运行通过时间顺序/分页断言，但刷新后重开预览未找到dialog；此前两次
也在打开旧文件预览时未找到评论按钮。未改变产品预览生命周期，也未削弱门禁，
该Firefox重开预览问题作为独立验证缺口保留，不宣称Firefox全门禁通过。
证据 `/tmp/rah-comment-order-firefox-debug.log`、
`/tmp/rah-comment-order-chrome-final.log`。

正式实例空闲校验后备份并优雅重启，备份：
`/Users/sun/.rah/backups/pre-restart-4101b9e6-b92b-4194-b6ea-563b33695050`。
冻结构建 `337598fc54749bc5afa711ded973021330a23981c6e6704cf31f2680077d3b2e`。
新真实浏览器在1440px和390px重新打开用户所示Markdown，确认顺序为
Hakase 01:22（seq301）→ Kimi 01:32（seq337），刷新仍保持。
已检查 `/tmp/rah-comment-order-formal-1440.png`；正式未发表评论、删除记录或运行付费CLI。
本项按用户需求偏离Raft位置排序，不宣称Raft双边顺序相同。
