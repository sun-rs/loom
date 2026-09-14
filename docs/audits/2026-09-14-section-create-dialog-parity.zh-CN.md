# 新建分区弹窗对齐

## 来源和采用范围

Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
授权本地pretty副本的133189–133378：pat表情选择和Z8名称表单；137412–137431：
新建/编辑分区调用；102544–102603：Ei独立portal、16px外间距和居中容器。
Z8为384px上限、20px内边距，标题16px/700、关闭图标18px及4px按钮内边距，
名称标签12px/700，输入16px、80字上限、placeholder“我的项目”。输入组合框44px表情按钮、
右侧2px分隔、focus-within固定4px阴影；表单间距16px，底部8px间距、14px按钮。

此前RAH复用了归档确认框：520px、标题横线、没有关闭/表情、空白名称框和“确认”按钮。
本次SectionCreateDialog独立承接新建分区，归档确认框保持既有行为。关闭/焦点继续使用共享
useDialogProtocol，表情弹层使用InteractivePopover；Portal挂到body，避免移动侧栏隐藏时
连同弹窗被隐藏。嵌套弹层在modal之上，打开时Escape只关闭表情层。

沿用Raft的emoji-picker-react库及width=min(340px,100vw-48px)、height=360、lazyLoadEmojis、
隐藏preview配置，按需加载，有加载失败/重试。安装版本固定4.22.2，来源与MIT许可见
[上游仓库](https://github.com/ealush/emoji-picker-react)及
`apps/web/public/legal/section-emoji-picker-notices.txt`（含shipstyles许可）。
Raft发布分块未提供可验证的包版本，因此是同库配置移植，不声称该第三方选择器与其发布分块
逐字节一致。表情使用该库原生Unicode模式（下文记录默认图源的正式环境修复）；
原弹窗中的选择结果仍是Unicode字符串。
没有把发布bundle作为生产依赖。既有共享图标沿用内部库许可和provenance。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/modals/create-issue-dialog.tsx` 提供统一Dialog外壳，但无同义自定义频道分区
表单优势；本次未复制Multica代码或建立其Issue状态路径。

## 唯一业务owner

分区仍是Human × Workspace的侧栏偏好。protocol CustomSections新增可选nullable emoji，
非空值trim后最长64字符；旧记录不要求迁移。Kernel humanSidebar的原JSON投影、版本围栏、
ACL和幂等更新共同保存name/emoji/items，没有新建本地存储或第二条写入路径。
从频道菜单创建分区继续原子移动对应条目；空白区域创建无成员分区。侧栏标题和“移动到分区”
菜单展示所选emoji，修改/移动保留其他字段。无emoji不显示占位图。

## 验证

先由协议测试复现emoji未知字段被拒绝；浏览器复现520px而非384px。协议测试覆盖emoji
保留和超限拒绝；Kernel既有幂等/权限测试加入emoji round-trip。浏览器实际创建后刷新
验证emoji和名称保留；创建失败保留草稿，选择/移除/搜索表情，Escape不误关外层。
移动测试先复现侧栏隐藏导致弹窗消失，再验证独立portal和紧凑高度。
另由浏览器复现独立portal丢失外层禁用样式（opacity为1），补充分区按钮禁用opacity=0.5的局部样式后通过。
`test-chat-context-browser.mjs` Chromium、Firefox、WebKit通过，已查看桌面和390×844截图。
不运行付费Provider；正式验收不保存测试分区，只打开/关闭及操作未提交的表单。

`npm run check`、`npm run format:check`、`git diff --check`和
`npm run build:web:workbench`通过。正式实例经空闲检查、持久状态备份及校验后优雅重启，
新冻结构建为`8f3b607c07aacc6d3904975b016487231121a754e2588061bae5edd682c497b3`。
新鲜正式浏览器在本机、LAN、Tailnet三个已配置入口验证构建标识、空白区及频道移动菜单的
新建分区入口、384px/20px布局、禁用按钮、关闭和390×844紧凑布局；没有提交测试分区，
没有页面异常。已查看正式桌面和手机截图。未进行同一前提的在线Raft双边操作验收；
这里是源码参数对齐与本地正式浏览器验证，不把第三方表情库版本差异声称为完全相同。

## 正式环境表情不可用修复

正式工作台复现：弹层正常打开，但默认Apple图源请求
`cdn.jsdelivr.net/npm/emoji-datasource-apple` 被本机/LAN网关的
`img-src 'self' data: blob:` 拦截，表情格为空。前次fixture验收没有包含正式CSP，
不能证明外部图源在正式环境可用。

Raft的pat调用未显式设置emojiStyle。emoji-picker-react 4.22.2的
`src/types/exposedTypes.ts` 和 `src/components/emoji/Emoji.tsx` 提供NATIVE模式；
Multica同一修订的 `packages/ui/components/common/emoji-picker.tsx` 也使用
emoji-mart的 `set: "native"`。RAH保留现有库、按需加载、搜索、分类和选择回调，
在按需加载的模块内设置 `EmojiStyle.NATIVE`，无需外部图片、放宽CSP或切换选择器。
唯一展示owner仍是SectionCreateDialog，不改变分区保存协议。原生字形随操作系统字体变化，
属于为本地可用性采用的明确差异，不声称Apple图片像素一致；没有复制Multica代码。

回归先阻断外部CDN并断言可选按钮包含实际Unicode字形，修复前失败（图标按钮消失），
修复后通过，同时断言没有表情CDN请求。沿用创建/刷新保留、搜索、清除、失败保留草稿、
嵌套Escape和390×844布局验收。

本次Chromium、Firefox、WebKit回归均通过；`npm run check`、
`npm run format:check`、`git diff --check`、`npm run build:web:workbench`通过。
正式实例通过空闲复查、状态备份校验后优雅重启，备份为
`pre-restart-38966902-b359-4ab9-af34-abb1b884f01e`，冻结构建
`38544089f064d909483806dc1e998132f787b49870b9418e08c4eaa0379dffdf`。
新鲜正式浏览器验证现有CSP、1440×900及390×844下的可见字形、搜索、选择、清除、
内外层Escape及弹层不越界；表情外部请求为零、无页面异常，未保存测试分区。
已查看正式桌面和手机截图；本次仍不声称同前提Raft在线双边验收。
