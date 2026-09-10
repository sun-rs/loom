# Human 消息头像尺寸修复

## 根因与修改

HumanIdentity 的字母占位头像使用 `.rah-settings-avatar.is-sidebar`，其尺寸是 18px；Agent／上传头像使用 `.rah-agent-avatar`。消息行覆盖原来只命中后者，导致同一消息行的 Human 为 18px、Agent 为 36px，并使正文起点不同。

单一 owner 为 `apps/web/src/identity-interactions.css` 的消息头像规则：两种头像共同使用 36px、2px 边框，字母 16px。侧栏的 18px 规则不变，不改变身份、资料点击与 hover 逻辑。

来源：冻结官网 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js` 的头像 size md 为 `size-9`；内部既有 `packages/ui-tokens/src/neo-brutalist/styles.css` 的 `.msg > .avatar` 及消息 Agent 规则均为 36px。本批为 RAH 样式接线修复，不宣称复制整个上游组件或完成官网双边实操。

## 验证

新增 `node scripts/test-message-avatar-browser.mjs`，Vite 加载真实 HumanIdentity／ProfileImageAvatar 和产品样式，Chrome 测量实际布局。修复前断言失败：Human 18×18，Agent 36×36。修复后在 1280px 与 390px 宽视口均通过：消息两者 36×36，侧栏 Human 保持 18×18。fixture 不连接 daemon／Provider，不能充当正式产品。

`npm run check`、正式 `npm run build:web:workbench` 与 `git diff --check` 通过。全仓 `format:check` 报告 9 个非本批文件的既存／并行施工格式问题（AGENTS.md、7 个历史文档、worker-cli.ts）；本批全部文件单独 Prettier 检查通过，没有为此修改其他施工文件。

正式实例重启前验证无活动工作，经既有 guarded restart 备份并验证 `/Users/sun/.rah/state` 后启动新服务。备份：`/Users/sun/.rah/backups/pre-restart-add2a00a-3092-4e6c-9168-ee12b3971ff3`。冻结 Web build：`fff898e069115aa621b3525f74f29aa703b1d062e4251c4c6bd42c470ab04fe5`。

正式 `http://127.0.0.1:4173/` 重载后的 DOM build 与冻结版本一致，3 个实际 Human 消息头像均为 36×36；截图确认与 Agent 对齐。点击 Human 头像正常打开 owner 资料，之后返回聊天页。未发送消息、未运行付费模型、未提交 commit。
