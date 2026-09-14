# 创建频道弹窗对齐

## 来源和归属

聊天侧栏加号和空白区域右键菜单均进入 App 的同一 RoomCreateDialog。本次只调整此组件
及其限定样式，Room 创建、初始 Agent 成员、权限、归档名称冲突仍由原应用服务与 Kernel 负责。

Raft 授权发布源码 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`：
pretty 129141–129425 的创建频道表单；102604–102638 的 _h 卡片；95542 的 mr 字段；
54472 的可见性 segmented-control；97765 的分组标识。CSS 为同批 index-DPaRRgFJ.css。
成员头像 sidebar-list 的18px/1px边框来自已冻结内部 avatar-pack。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/modals/create-issue-dialog.tsx` 核对了共用外层 Dialog 的模式，但没有频道创建
视觉规格的额外优势。本次为 Raft 结构移植与 RAH 样式接线，没有复制新图片、字体或整段发布包；
共享图标和头像沿用内部库原有许可及 provenance。

## 差异与实现

通用 `.rah-dialog form:not(...)` 比旧局部表单规则优先级更高，实际输入仍为12px monospace。
必填星号作为 grid label 的独立子项换行；旧卡片固定高度、分隔标题及 sticky footer
导致滚动条和边框层级与 Raft 不同。

现统一为448px上限、24px卡片内边距、2px黑框和4px固定阴影；标题18px/700，标题与表单
间距16px，取消标题及底部横线。字段标签14px/700、名称与星号同行，输入16px、描述rows=2，
底部正常文档流、按钮14px并相隔12px。可见性使用共享hash/lock图标；搜索14px图标位于左侧。
成员列表独立最大192px滚动，行间距与padding按源码，18px像素头像无状态点，单行14px/500
显示名，不附带账号名；hover使用Raft未降透明度的soft-signal（#FFD440）、选中使用pink20%和粉色对勾。

保留已有必填校验、空名称禁用提交、当前Dialog的遮罩关闭/Escape/焦点协议以及本地归档冲突恢复。
这两处交互是明确本地差异：Raft该表单空名称依靠原生required校验，_h默认不点遮罩关闭。
不引入中央账号/计费以及多Human成员选择；当前Human创建者仍由认证上下文自动加入。
提交入口补充pending判定，不产生第二个创建业务路径。

## 验证

先运行 `test-room-create-parity-browser.mjs`，复现padding0、标题边框2、输入12、sticky footer。
修复后 Chromium/Firefox 验证两个真实鼠标入口、源码尺寸、星号同行、图标、成员选择/取消、搜索
空态、Escape、失败后保留输入并成功创建，以及390×844；已查看桌面和移动截图。
关闭按钮复用既有32px卡片关闭变体，未增加UI例外预算；原Agent重置弹窗在
Chrome/Firefox、1440/390四组回归均通过。底部按钮间距另先复现通用规则覆盖为9px，
修正后按源码保持12px，纳入两个入口的浏览器断言。
正式环境只读打开与关闭弹窗，不提交频道，不运行付费 Provider。

完整 `npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 通过，匹配规则与内部catalog已更新。
正式工作台经过空闲检查、验证备份和优雅重启；备份为
`/Users/sun/.rah/backups/pre-restart-005213cc-a236-419e-8f3f-ba1f080103b5`，
冻结构建 `d0158bac9cf4d74a4b05ca9711f8cc0aa0176a6763cfe52925aa7a4e78b4af27`。
本机、LAN、Tailnet新浏览器均通过两入口和390px布局；已查看正式桌面和移动截图，
四位真实Agent像素头像、单行名称、必填星号、搜索/可见性图标及卡片间距正常。
本次是授权源码对齐与本地正式验收，不宣称同条件Raft双边实机验收。
未在正式状态创建频道，未调用付费CLI，未提交或推送。

## 成员行hover颜色修正

用户截图复核发现此前使用本地`--soft-signal`，实际是30%透明黄。
Raft pretty129325的`hover:bg-soft-signal`没有`/30`后缀；同批CSS
`index-DPaRRgFJ.css`（SHA256 `0d658697e96e6569a8a9d29279e0765da20517a7133a2facf708f45af39afbf0`）
明确`--color-soft-signal:var(--color-brutal-yellow)`、`--color-brutal-yellow:#ffd440`。
本地`--soft-signal`历史上对应工具条的`hover:bg-soft-signal/30`，不能直接视为同名等价。
创建频道成员行因此改用已有不透明`--yellow`，不修改全局token及其他页面的浅黄hover。
此处owner仍为RoomCreateDialog限定的product.css；选中粉色、取消选择与提交路径不变。

浏览器新增精确颜色、指针移出恢复透明、选中时悬停仍为粉色的断言。先复现期望
`rgb(255, 212, 64)`、实际`rgba(255, 212, 64, 0.3)`后修改。
本批Chromium/Firefox的两入口、hover/移出/选中、失败恢复及390px场景均通过，已复核
`/tmp/rah-room-create-chromium-plus-hover.png`。完整`npm run check`、格式/diff检查和正式build通过；
sidebar-row/sq-btn匹配规则及catalog已刷新。
正式实例由重启守卫完成空闲检查、验证备份及优雅重启，备份为
`/Users/sun/.rah/backups/pre-restart-a8b0a0d1-83a3-4b2a-bfce-86552bdf7caa`。
重启实际使用冻结构建`ff826358e603c515929233c70a043896bab61476603e28db56f06c240835a0b4`。
本机、LAN、Tailnet新浏览器均验证该构建及精确hover颜色；加号/右键两入口、粉色选中行与
黄色未选中悬停行、390px布局通过。已复核正式截图
`/tmp/rah-room-create-formal-127.0.0.1-plus.png`。正式验收拦截rooms/create，未提交频道。
该修正仍属于授权源码对照与正式本地验收，不扩大为Raft同条件在线双边验收。
