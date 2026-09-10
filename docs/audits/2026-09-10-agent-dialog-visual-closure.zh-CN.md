# Agent 创建与重置弹窗视觉续批

## 直接来源

授权官网 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。

- 重置的正确调用链是 `Aet → Si`：`maxWidthClass:"max-w-md"`、`plainMessage:true`；Si为`card-brutal p-6`，标题区`mb-4`，内容底间距`mb-5`，操作区`gap-3`。Aet选项`border-2 p-4`，标题`text-sm font-bold`，说明`mt-1 text-xs text-black/60`。
- 创建名称 `create-agent-name` 使用 `Sl/nOe`，描述使用 `dOe/lOe`：`font-heading text-field font-field px-3 py-2`。同版本 `index-D8Neh8lc.css` brutal字段token为16px/24px、weight400。

这补足上一批未找到对应组件的证据，不能拿其他max-w-md调用替代它。

## 采用与本地差异

- 官网实际打开Kimi重置弹窗，测量448px/24px/2px边框/4px阴影，与源码相符；只读关闭未确认。截图 `/Users/sun/Code/reviews/rah_os/2026-09-10-dialog-repair/raft-reset.png`。
- 重置最大宽度448、内边距24、4px阴影、移除标题区分隔线、选项内边距16、14px标题/12px说明；垂直空间不足时整体可滚动。
- 原生radio视觉隐藏，保留label整块点击与方向键选择。Raft使用button，本地这是明确的可访问性保留，不宣称DOM逐字复刻。
- 未改变确认/失败/幂等重试、执行围栏或full能力判断；未执行真实重置，特别是未删除任何工作区。
- 创建文字输入与描述采用16/24和8×12内边距；不改变管理弹窗，不改runtime配置、请求或表单验证。

## 回归

真实组件Chrome fixture 1280和390宽度覆盖创建/重置。先红：520≠448、padding0≠24、创建12px≠16px；修后10个模式/视口组合通过。重置选第二项、方向键返回首项、Escape关闭均验证，未点击真实服务的确认按钮。

完整创建页字段组合、全页面双边验收仍不能仅由此推出。Task历史及submitted改派仍依照[前端续批](2026-09-10-frontend-second-repair.zh-CN.md)的业务合同边界处理。

## 正式构建与验收边界

`npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench`、`npm run test:web:browser` 均通过；真实组件浏览器回归最终10个组合通过。未运行付费模型。

确认空闲并备份原持久状态后，正式工作台已优雅重启。Chrome 正式页面读取的构建标识为 `473f9abf4b23512c1fa73cd4c57d301b0b80c40da4253e922c7ea0c75ebe95ae`，实际打开重置弹窗验证448px宽度、24px内边距与4px阴影，随后关闭，未提交重置。截图 `/Users/sun/Code/reviews/rah_os/2026-09-10-dialog-repair/local-reset.png`。原Room历史、配置及记忆沿用原持久状态；本批未提交Git。

双边截图仍显示操作按钮高度与关闭图标尺寸差异，尚未收口。因此本批只验收上述容器、选项和输入字体修复，不宣称整个弹窗或全部页面视觉一致。下一步先对齐此操作区并复核交互，再继续其他页面族。

## 操作区续修

同一官方bundle的 `Si → dn → yqe/vqe` 明确使用 `sm`：`h-7 px-2.5 text-xs`，图文按钮另有 `gap-1.5`。关闭按钮为 `p-1`、20px的 `yr` 图标和2px边框，即32px外框。原本地操作区继承通用按钮38px高度、关闭按钮使用文字乘号，是这两处差异的直接原因。

本次仅在重置弹窗组合层采用28px操作按钮、10px水平内边距、12px字体与6px图文间距；关闭使用现有共享 `Icon` 的 `x`，尺寸20px、按钮32px。保留原有按钮按压、禁用和焦点行为，不影响其他弹窗。浏览器断言先在两个视口均以 `38 !== 28` 失败，修后10组通过，包括选项点击、方向键和Escape。

这两项参数差异已修复；完整新一轮官网双边交互仍待复验，本轮浏览器连接两次返回request-header policy加载失败，不能把源码对照与本地回归冒充本轮官网实操。

续修后 `npm run check`、格式检查、diff检查、正式Web构建及业务Chrome门禁通过。正式实例经空闲检查、验证备份和优雅重启后，独立Chrome打开真实Kimi资料页与重置弹窗，验证构建 `6bc8922e90b07dbb09e9897cecb7f1d2d8cf4fb8525f30c9fad733fad9f80ef1`、两个操作按钮28px、关闭按钮32px及图标20px，并实际点击关闭成功。截图 `/Users/sun/Code/reviews/rah_os/2026-09-10-dialog-repair/local-reset-actions.png` 已目视检查。未提交重置、未运行付费模型、未提交Git。
