# Tab 内容留白与正文提及对齐

最新状态：用户随后明确选择改善黄色自身提及的文字基线。下文原始核对结论
保留为来源事实；当前实现有意不同于 Raft 的 align-bottom，见末尾续修。

再次更新：统一协议覆盖所有正文带框引用，不再仅处理黄色自身提及。

## 来源与边界

Raft v1.16.0 的静态 Web 证据：
`https://app.raft.build/assets/index-CKeqacxz.js`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
来源清单见 `docs/evidence/raft-release-20260916/manifest.json`。
仅解析授权证据，没有执行发布 bundle，也没有新增上游依赖。

`US` tabs brutal 样式使用 shrink-0、gap-1.5、px-4、py-1.5、text-xs、
size-3.5 图标，没有按索引固定宽度。RAH 已有共享 PanelTabs 与 ui-tokens
实现这些参数；本次仅移除 Agent 页重复的固定宽度覆盖。频道和私聊继续复用
同一组件。窄容器保留横向滚动及键盘焦点显露，不挤压单个 tab。

原 Agent 第五项规定 88px，随后 last-child 覆盖成 78px，导致工作区图标左侧
留白 16px、文字右侧仅 6px。移动样式还另设 88/96px，同样偏离内容宽度。
删除这些覆盖后，图标和文字整体两侧均为 16px，中间 gap 6px。

正文提及由上游 `j7` 消费 `Zo`：inline-block、align-bottom、1px 边框、
px-1、0.875em 字号、1.3em 行高、font-bold。黄色自身提及不是正文同字号
的 baseline 对齐；外框底部与行盒底部对齐，文字保持在框内。RAH
`.rah-rich-reference` 的实际计算样式与此一致，故不做猜测性的偏移修正。
这里核对的是正文 `j7/Zo`，不是通用 Reference 组件的另一个样式变体。

## 验证

`scripts/test-tab-content-spacing-browser.mjs` 先测得工作区右侧仅 6px 并失败，
修改后 Chromium/WebKit 在 1440x844、390x844 均通过。覆盖 Agent 与会话
tab 的内容留白、图文间距、键盘激活，以及正文黄色提及的实际计算样式。
截图已检查；该测试入口为 `test:web:tab-spacing`。
没有在线 Raft 同状态双边验收，也不把 WebKit 模拟称为 iPhone 实机验收。

## 交付状态

- `build:web:workbench`、`format:check`、`git diff --check` 和专项浏览器测试通过。
- `npm run check` 未整体通过：本轮测试阶段 1697 通过、17 付费门禁跳过、
  1 失败。失败为已有后台 `room-kernel.ts` 6970 行超过 6925 行限制，
  本批未修改该文件或放宽限制，后续串行门禁未因此声称通过。
- 扩大运行的 `test:web:foundations` 受旧资料页夹具阻塞：空 client 没有
  request；临时补齐失败响应后，又命中已移除的“管理 Agent”按钮断言。
  诊断用夹具改动已撤回，未混入本批修复。专项 tab 测试独立通过。
- 正式重启活动检查、状态备份和升级预检通过，备份为
  `~/.rah/backups/pre-restart-16b81ab6-5e9f-4097-937f-9af03dee1c5f`。
  后继实例使用冻结 Web 制品
  `a2d42a9d15f4db96314546d870d4a2f9abec47ff69aaaf5ccfa95356e0e7e203`，
  build identity 为 `77f918b068c9606f`，原本机、LAN、Tailnet 入口保持不变。
- 正式入口的新浏览器页面在 1440px 和 390px 检查所有 Agent tab 内容左右
  留白均为 16px，截图已检查；只读验收未改变 Room 事件序号。
- 未提交或推送。

## 黄色提及基线续修

用户授权将黄色 @标识内部文字对齐正文基线。原 align-bottom 在独立正文
行复现约 0.8px 的基线差；直接对含 overflow:hidden 的 inline-block 设置
baseline 仍会以外框底部作为基线，因此不采用固定 transform/top 补丁。

MessageMarkdown 为自身 Human 提及增加内部 label，外层采用 inline-flex、
align-items:baseline、vertical-align:baseline；内部 label 拥有 min-width:0、
overflow:hidden 和 ellipsis。保留原 0.875em、1.3em、1px 边框、4px 横向
内边距和黄色。共用正文组件覆盖 Room、DM、Thread、Task 对话，其他任务/
频道标识不改变。该变更是用户明确要求的本地视觉改进，不称为 Raft 原样移植。

专项测试在 Chromium/WebKit、1440x844 和触摸移动 390x844，分别以
14/16/18/20px 正文测量内外零尺寸 baseline 探针，误差要求小于 0.5px；
另核验长名字限制宽度、省略号和换行，截图已检查。先复现基线偏差失败，
再验证修改通过；没有声称真实 iPhone 已验证。

续修交付检查：专项浏览器测试（包含 span 与可点击 button）、消息长历史与
Markdown 稳定性回归、类型检查、Web 构建通过。构建 Web ID 为
`0476faceeae92d1c5b4c34a94186c4e5bfee38c2e7f0d0cc6188e50e80e67d95`。
首次全量检查期间后台并行改动产生 recordPresentedWindow 导出不匹配与
源码行数限制失败；导入恢复后重新检查，又被未登记的
`/v1/worker/message-present` 接口阻断。最后全仓格式检查报告后台
activation-presented-window 实现及测试格式错误，本批未修改这些文件。

因此本次基线续修尚未重启部署，正式实例仍保留上一批版本；上文正式重启
记录仅属于 tab 修复，不属于本次基线续修。新增
`scripts/test-mention-baseline-formal-browser.mjs` 用于部署后的只读实际消息
验收，目前未运行。待后台批次稳定并通过检查后再执行安全重启及正式验收。

## 行内引用统一协议

用户要求统一所有正文带框引用的文字基线。单一 owner 为 MessageMarkdown
的 MessageReferenceToken 及其共享 `.rah-rich-reference` 样式：外层
inline-flex、align-items:baseline、vertical-align:baseline；共同的
`.rah-reference-label` 负责长文本截断。删除自身提及专属对齐规则与专属
label 类。覆盖自身 Human、Task、Room、Thread、Computer、App、Message
和不可解析引用；非带框的 Agent/Human 下划线提及继续自然行内基线。

颜色、任务状态、禁用标记、读回执和点击回调仍归原类型分支；不把侧栏或
独立任务卡片上的状态控件当成正文引用修改。附件评论的无框提及保留原协议。
本次属于用户授权的本地改进，上游来源仍为本报告列明的 Raft j7/Zo。

浏览器门禁遍历真实 MessageMarkdown 中所有带框类型，不仅检查 CSS 值，
还在 Chromium/WebKit、桌面/移动、14/16/18/20px、span/button 形态下
测量文本基线。测试首先在 task 引用的旧底部对齐上失败，统一后通过。

本轮类型检查、专项 Chromium/WebKit 门禁、消息长历史与 Markdown 点击/
稳定性回归、Web 构建通过。最新构建
`1adc9461945db62125751ea4e37ad6fdee15fdbb3591db1fd83bb29f83712e6a`。
全仓检查仍被未登记的 `/v1/worker/message-present` 阻断；后台文件存在
格式问题。未重启正式实例，未宣称部署或真实 iPhone 验收，未提交或推送。
