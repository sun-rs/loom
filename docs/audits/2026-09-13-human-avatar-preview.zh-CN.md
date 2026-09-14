# Human 头像悬浮资料卡尺寸修复

## 来源与根因

Raft 官方发布源 `https://app.raft.build/` 的冻结证据
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：
`Q2` 触发后的 `RO` Human 分支使用 280px 卡宽、12px 内边距与间距，
`Bn` 的 `mention-card` context 使用 48px 头像；姓名 14/20px，账号 12/16px。
可选描述有 2px 顶边框、8px/12px 内边距和单行省略。发布 bundle 仅作分析证据，
本次为样式参数的结构移植及 RAH glue，不是整段源码复制。

原 HumanPreview 误复用完整资料页排版，导致头像 64px、内边距 20px、间距
16px、姓名 18px、账号 14px。卡片宽度原本已经正确，过大来自内部布局。

同时检查 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/ui/components/ui/hover-card.tsx`：通用浮层使用 256px 宽和圆角，
不符合此次 Raft 资料卡目标，因此不引入该实现。

## 本地归属

`packages/ui-tokens/src/neo-brutalist/profile.css` 为唯一尺寸样式归属，
限定 `.rah-human-preview` 范围，完整 Human 资料页保持原有尺寸。
`apps/web/src/components/human-identity.tsx` 为可选描述补上 title。
现有 PreviewCard 继续负责悬停、移出、焦点、Escape 和点击关闭；没有新增状态路径。
头像图案沿用本地身份数据，不声称与 Raft 账户素材一致。

## 验证

`scripts/test-human-avatar-preview-browser.mjs` 先以旧实现运行，确认尺寸断言失败
（64/20/16/18/14），修复后通过。真实 Chromium 在隔离 fixture 中检查
280px 卡宽、48px 头像、12px 内边距/间距和 14px/12px 字号，
鼠标移出关闭、焦点打开、Escape 关闭、点击打开 Human 右侧栏。
390×844 下检查左右边界，无横向溢出。截图已检查。

此为冻结 Raft 源码参数对照，不是同条件在线 Raft 双边验收；未运行付费 CLI。

完整检查第一次在旧测试定位器读取 `apps/web/src/activity.css` 时失败；
文件现归属 ui-tokens。修正 `apps/web/test/ui-source.ts` 的路径映射，
保留原交互断言，定向 5 项测试通过。该修正不改变产品样式。

最终 `npm run check`、`npm run format:check`、`git diff --check` 与
`npm run build:web:workbench` 通过。正式版本
`602927b930079ed7cea1a9460f29520059390c329b48b4ec3b9261c7ee3f94e6`
已在空闲检查及持久状态备份后优雅重启，备份收据
`pre-restart-13a4a975-db06-4928-b725-0a57b4d42ae1`。

使用原有 Council 对话，通过本机、物理局域网和 Tailnet 三个入口的新 Chromium 页面，
确认 48px 头像、280px 卡片，移出关闭、点击 Human 侧栏、刷新和 390×844 边界均通过，
并检查正式截图。首次验证碰到服务尚未监听，等待启动后重跑；窄屏视口切换中的
悬停等待也曾超时，使用刷新后的页面重新验证通过，未把首次失败记作通过。
原有四个 Agent 和持久对话仍由同一状态目录提供。没有运行真实 CLI 推理或提交 Git。
