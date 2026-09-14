# 各页面使用当前 Human 显示名称与头像

## 契约和来源

用户要求所有身份展示随设置中的显示名称、头像更新，不再把账号名作为第二行名称。
单一展示解析 owner 仍是 WorkspaceEntities；当前登录 Principal 优先于旧目录读结果，
组件按 principalId 解析当前资料，不建立页面身份缓存，不改写持久消息、转发快照或 handle。
资料页仍先通过原有授权查询，再将已授权 Principal 与当前投影合并，保留异步 observation fence。

Raft 授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
pretty 140879 的回复署名优先 senderDisplayName；146274–146300 的消息身份分支仍有
senderName 回退。本次按用户要求补齐 Human 当前资料，不照搬过时快照回退。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/core/workspace/hooks.ts` 通过当前 members 构建 getActorName。
本次复用本地已存在的身份所有者和提及解析器，是 RAH 展示接线，未复制新的上游资产；
原有 Raft/Multica 许可和 provenance 沿用既有复用台账。

## 去重展示清单

| 入口                                              | 当前资料接线                                              | 验证                                         |
| ------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------- |
| Room、DM、Thread 正文署名/头像/已识别的 Human @   | MessageArticle、HumanIdentity、MessageMarkdown            | 连续两次改名换头像，无刷新，浏览器           |
| Room 回复预览作者/头像/摘要 @                     | ThreadReplyAvatar、WorkspaceEntities、activityDisplayText | 连续更新浏览器                               |
| 文件及章节评论署名/头像/提及                      | 原评论身份接线，保留文件/章节层级                         | 两次改名换头像，桌面/移动浏览器              |
| 动态卡片作者和摘要、消息列标题                    | 原 GlobalActivity、activityDisplayText 当前投影           | 两次改名专项浏览器                           |
| 搜索结果署名/头像/摘要、发送者筛选、导航结果      | 当前实体覆盖旧 senderName，筛选仍用 principalId           | 注入旧作者结果后连续更新浏览器；筛选源码核对 |
| 收藏消息卡片                                      | 当前实体覆盖 sender 快照                                  | 注入旧 sender 后连续更新浏览器               |
| 转发卡片与其中 Human @                            | 当前实体覆盖 actor 展示，快照原文不变                     | 创建转发后连续更新浏览器                     |
| Human 悬浮卡、资料页、设置预览                    | 当前显示名称，不额外显示账户 handle                       | 悬浮卡更新浏览器；资料页源码核对             |
| 频道成员头像、成员角色按钮、关系图 Human 悬浮标签 | 已授权成员当前投影与共享头像组件                          | 源码核对                                     |
| Task 负责人、创建者、操作时间线                   | 既有 WorkspaceEntities 解析                               | 已有 Task 专项覆盖，未新增第二份身份状态     |

本次不改变 Agent 的唯一提及 handle。原始代码、未知/歧义提及、诊断日志和普通自由文本里的
账号字符串是原文，不进行全局字符串替换。已识别 Human @ 的文字使用当前显示名称，
内部身份和投递路由不变；历史消息可以在再次改名后继续正确关联。

## 验证状态

先由扩展 mention 浏览器用例复现回复预览仍显示旧名 sun 的失败，再实施修复。
`test-mention-display-name-browser.mjs` 覆盖两次不同名称/头像、Room/DM/Thread、
预览、旧搜索/收藏数据、转发、悬浮卡、刷新和移动页面；读取原消息验证持久正文不被改写。
`test-file-comment-identity-browser.mjs` 同时验证文件/章节评论头像连续更新。
Chromium 与 Firefox 专项通过，动态名称专项通过。没有运行付费 Provider。

完整 `npm run check`、`npm run format:check`、`git diff --check` 与
`npm run build:web:workbench` 通过；不把源码核对等同于所有页面逐一实机验收。

额外运行 `test-conversation-two-pages-browser.mjs` 通过 Room/DM、Agent/Human、宽窄屏、
替换、草稿与刷新。旧 `test-thread-follower-profile-browser.mjs` 在同批树上有窄屏资料页
宽度断言失败（预期390，读取79.71875）；等待布局稳定后仍复现。本轮未修改该断言或
把它宣布通过，身份专项通过不代表此综合布局用例通过。
完整回归的抽取 callback fixture 另补充了已存在的 setPanelIntent setter，保持原导航失效断言。

正式工作台通过活跃工作检查、持久状态备份和优雅重启。备份：
`/Users/sun/.rah/backups/pre-restart-dd8bc741-7421-4966-a015-dea3f23d267a`。
冻结构建 `36c081642c1b2c8123e08f9daf0ffdd553cfa2f41c84b873faa564bfd821a50a`。
本机、LAN、Tailnet 的新浏览器页面读取当前 Hakase 和真实照片，验证 Room、Thread、
Human 资料页、390×844 和刷新；正式文件评论验证当前作者、Human 提及、头像加载及移动页面。
已查看桌面、移动消息列及文件评论截图。验收期间另一工作流程再次重启了同一冻结构建，
连接恢复后重跑评论验收通过。没有修改正式账号资料、发送消息、调用付费 CLI、提交或推送。
