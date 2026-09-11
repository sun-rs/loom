# Search 首页与结果卡片修复

## 来源与边界

用户截图指出搜索首页横向分区与结果卡片不一致。2026-09-12 实操 Chrome 的 Raft `/s/hakasemac/search`，点击已有历史词 ParityAuditorA，确认历史在上、常用实体在下；目录结果有头像/名称/类型/副标题，消息结果有来源/头像/作者/相对时间与摘要，Thread 为粉色标题区加命中列表。未发送消息或运行模型。浏览器扩展的 request-header policy 加载失败，改用原生窗口的可访问树与截图；本轮没有伪称已取新的同视口 computed-style 双边数据。

授权参考 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA-256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。位置：`search-home`、`fn`、`ft`、`Pa.map`；频率算法 `mdt/pdt/fdt`、常量 Qct/edt/tdt/Vde/ndt；star 几何 vHe/yHe。结构移植，非整段原样复制；star 路径原样采用现有授权图标来源。

## 根因与 owner

1. `readFrequentSearches` 把重复查询当常用。新 Search entity usage 只记录搜索打开的目标键与时间，常用卡片从当前授权目录重新解析，不保存业务正文；90天窗口、7天半衰期、24次/实体、64实体读取上限、10张卡片按上游。单Human产品以 Workspace/Human 隔离偏好。旧查询记录不转换为伪造的频道访问。
2. `SearchSuggestions` 原为两个并列文本列表，现拆到 `search-cards.tsx`，历史词条在前、常用实体两列卡片在后；小屏单列；清历史不清实体使用记录。单条历史删除保留原历史存储格式兼容。
3. 目录结果复用同一实体卡片布局，消息结果改成元数据一行、两行正文摘要、相对时间及真实身份头像。保持原 typed navigation、分页与失败/加载 owner。
4. Kernel Search 原来只提供根消息ID，没有Thread标题来源。`SearchHit.rootMessagePreview` 为可选有界160字符投影，查询仅关联同一已授权Room的根消息。不存在根消息时不伪造正文，用中性“消息列讨论”。不新增写路径、权限或数据库迁移。

## 验证状态

- 新常用实体排序/跨Workspace/过期测试先缺模块失败，再通过。
- 搜索首页浏览器测试先在“打开目标后没有常用卡片”失败；修复后验证历史在上、清历史保留常用、390px无横向溢出、消息元数据头像/相对时间、两行截断及点击跳转。最初 Fixture 查询无目录命中导致超时不是产品反证，已改用真实夹具频道名 Council。
- Kernel的Thread限定搜索测试先因缺根摘要失败，修复后19项通过，含权限和有界大历史回归。
- Chrome/Firefox搜索计数、空结果、重载，桌面/手机共8场景通过。
- Web单元402项通过。全量检查和正式部署记录见本轮末补充。组件规格棘轮基线未提交的问题属于已有阻塞，不提升预算。

本批不提交、不推送、不运行付费CLI；不将不同内容的截图当同内容逐像素验收。仍需区分源码结构与本地回归通过、官网实景确认、同条件双边几何验收。

## 正式页面复查补强

- 正式数据暴露出私信仍被显示为频道的缺口：Search directory 的 Room 查询没有 JOIN `direct_room_pairs`。先补失败测试（双方ID缺失），再沿用 `roomProjectionFromRow` 还原 canonical 双方身份；Global Search 消费完整授权目录，并由现有 Workspace entity owner 解析头像。Kernel定向20项全部通过。
- 搜索卡片复用了18px sidebar头像，实测18≠Raft32。增加明确32px卡片头像规则与浏览器断言，消息元数据mini头像仍为14px。
- 全量后端第一次1556项中1537通过、17跳过、2个图标断言失败：新增star改变了冻结sprite，及改变Icon列表的前缀。保持旧sprite hash，剥离并单独精确验证新增star；保持原列表前缀。受影响图标11项重跑全部通过，未宣称再次全量重跑。
- Web先前402全通过；末次当前工作树400通过、2失败，均在本批未修改的WorkspaceScreen组合及Room通知/长消息文案断言。搜索专项继续通过。总门禁仍受未提交组件规格基线阻塞；全仓格式检查还发现7个其他在途文件格式问题，未把这些失败描述为通过。
- 源码结构、独立浏览器回归、正式真实数据验收分别记录，不据此宣称全站1:1完成。正式版清空历史后不应立刻出现预造常用频道；用户需从搜索打开一次实体，才会形成常用记录。

## 最后部署回执

正式冻结build `2fcb91706020ded4d0c5827363789a5891e915f54ec4c618a12372dcde21c64e` 已经空闲检查、备份、精确进程正常停止与重新启动；正式入口仍为 `http://127.0.0.1:4173/`。新Chrome上下文在正式真实数据上验证私信/常用头像32px、真实Thread根标题及消息结果，截图 `/tmp/rah-search-formal-home-complete.png`、`/tmp/rah-search-formal-directory-complete.png`、`/tmp/rah-search-formal-thread-complete.png`，并人工检查截图。

最终搜索专项浏览器通过，包含动态读取夹具真实Agent handle后的头像尺寸断言；先前猜测夹具名称导致的超时不算产品缺陷。正式页面的异步目录需等待身份数据加载后再测头像，已修正过早断言。

与最后备份逐行核对423条Room事件、46条消息、3个Task、4个Agent定义、6个Principal无变化，工作区记忆文件与runtime guide一致，外键检查通过。相关修改文件格式及diff检查通过；没有提交或推送。前述总门禁/其他在途失败边界仍保留，本批不宣称全仓绿灯或完整搜索交互1:1验收。

## 窄屏续验

用户追加的第二张截图仍为旧搜索词列表结构。正式入口实测现有清除字体已经是11px/black45%，但确实漏了Raft的窄屏编辑模式。来源同一bundle：jdt为`(max-width: 767px)`，gdt/hdt决定编辑与单项删除显示；filter外层`px-4 py-3`，内部`flex-wrap gap-2`，并非窄屏强制单行。增加编辑/完成切换，窄屏仅编辑时显示删除按钮；将筛选区窄屏padding统一为官方12px/16px。

新增浏览器先因缺“编辑”失败，修复后通过；正式615/560/390/768px实测字体11px、rgba(0,0,0,0.45)，615五项同排、560自然换行，767以下有编辑而768无。源码参数与本地实测分别成立，本轮未新增官网同宽运行时尺寸测量。截图`/tmp/rah-search-narrow-formal-560.png`人工检查通过。

正式build `91b156609d31df7e16f7d33ec5b6ff09200ae28af0195020347a069d251b91ad` 已备份重启，原Room/Message/Task/Agent/Principal和记忆逐项核对保留。构建替换曾触发守卫在停止前拒绝，之后按实际冻结构建重新验证。窄屏专项、类型和diff通过；总检查此次还受其他在途Computer CSS `--lime`及两个Computer静态断言阻塞；全仓格式存在两个非本批文件问题，没有宣称全仓通过。

### 历史词条双色悬停修复

Raft 的 search-history-tag 由父元素统一提供 3% hover 背景，查询按钮透明；
仅删除按钮自身 hover 才加 10% 背景。本地查询按钮继承通用
rah-interaction-flat 的 5% hover，叠加父背景导致文字与 X 区域双色。
搜索专属样式覆盖该叠加，保留上游删除按钮独立 hover 与图标颜色。
浏览器回归先实测 5% 背景失败，修复后透明查询区与 10% 删除 hover 均通过，
615/560/390 相关窄屏覆盖仍沿用本文件记录的范围。

本轮正式构建 d12286ec3fdde2aa20dae824e3fa44cae64e75c437aae78bc15207070c8fc3fe
已备份并重启。类型检查、构建和搜索浏览器测试通过。
全仓 check 被组件规格未提交基线及过期 matched-rules 阻断；
format:check 仍报告 ui-catalog.html 和 build-ui-catalog.test.mjs。
不将这些未通过项记为通过。
