# 任务操作时间线与初始底部定位续修

## Raft 源码核对

授权发布包 `index-MqTUR4Ez.js` SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
本地分析副本 `reviews/rah_os/2026-09-13-dialog-audit`。
格式化源码 171906–172025 的 spt/ipt/opt 实际支持七类事件，不是只有三类：

| Raft 事件                 | 标题与细节                    | RAH canonical 对应                     |
| ------------------------- | ----------------------------- | -------------------------------------- |
| created                   | 创建任务；任务号和初始状态    | task.created                           |
| amended                   | 更新任务；标题/描述 from → to | task.amended                           |
| status_changed            | 变更状态；前后彩色状态标签    | 实际 workflowStatus 变化               |
| assignee_changed          | 变更负责人；显示名或取消指派  | assigned/unassigned/reassigned/claimed |
| reopened                  | 重新打开任务；前后状态        | task.reopened                          |
| closed                    | 关闭任务；前后状态            | task.cancelled                         |
| resource_receipt_recorded | 记录资源凭据；资源 payload    | 当前无对应业务机制                     |

npt（171554起）继续使用已维护的竖线、圆点、12px 元数据与状态颜色。
本轮结构移植标题/字段细节，不复制发布 bundle 或建立新的事件存储。
资源凭据并非 Agent 回复或 Artifact 附件；RAH 当前没有 Raft creates-resource
合同，不将附件、进度或 Provider 输出伪造成该类记录。此项不宣称对等实现。
不显示任务进度的长回复；讨论内容仍归任务消息列。

## 本地修复

- “历史”改名“操作时间线”，含加载/失败提示；保留分页及原有错误重试。
- actor 和 assignee 都通过共享 WorkspaceEntities 解析当前显示名称，保留 canonical
  Principal ID 作为关联键。不会把 owner handle 当成用户已经设置好的显示名称。
- 独立显示关闭/重开，更新任务展示完整公开字段前后值，取消指派用 Raft 的措辞。
- 原实现只设置一次 scrollTop，后续容器高度变化可能留下底部空隙。复用现有
  Thread scroller，以 useTaskInitialScroll 管理首次定位的 ResizeObserver/
  MutationObserver；可视区域或已渲染正文尺寸变化后在布局帧校正到底部。
  wheel、触摸、pointerdown 或键盘操作后释放跟随，避免拉走用户阅读位置。
  不改写消息分页、正文身份或长期滚动状态；退出任务时清理观察器和帧。

## 回归

单元测试先复现关闭和重开都误显示“变更状态”；浏览器先复现首次定位后
缩小可视高度仍未贴到底部。回归覆盖布局延迟变化、用户操作后停止跟随、
设置改名后的时间线、成员候选过滤、取消指派、所有现有任务状态切换以及字段修改。
资源凭据缺口为后端能力差异，不用 fixture 声称生产支持。

## 交付验证

`npm run check`、补充 typecheck、`npm run format:check`、`git diff --check` 和
正式 Web 构建通过。完整任务详情 gate 在 Chromium/Firefox、1440px/390px
均通过；改名与延迟布局独立回归通过。属性栏创建人及负责人也复用当前显示名称。
正式实例经活跃任务检查、验证备份及安全重启，本机/LAN/Tailnet 新页面验证
窗口缩高及手机重排后底部差值小于 2px，最后一条实际回复完整可见；已查看截图。
时间线 actor 显示 Hakase，不再是 owner，属性栏创建人亦一致。
未修改正式任务/消息/账号配置，未调用付费模型，未提交或推送代码。
本轮是授权源码对照和本地验收，不声明在线 Raft 同条件双边完整验收。
