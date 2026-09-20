# 动态卡片身份名称

问题：HumanActivity.list 的 direct 标题使用 rooms.name（可能是创建时的 CLI
名称），senderName 使用 principals.handle，前端又对旧 runtime 名做字符串清理。
因此同一独立身份在正文显示 Gemini，在动态卡片却显示 OpenCode；Kimi 也可能
被会话旧名称 Kimi Code 覆盖。

沿用[删除身份显示合同](2026-09-20-deleted-agent-task-identity.zh-CN.md)及其上游
来源，按 participant ID 读取当前 Agent revision.displayName；无定义显示名时
回退 principal.display_name/handle。direct_room_pairs 确定私聊对方，包括已删除
成员，不能根据旧名称匹配或只查活跃成员。卡片标题、消息列所属私聊名称及摘要
发言人由 Kernel HumanActivity 统一投影，UI 不再把身份名称当 runtime 标签处理。
频道名称和消息列正文标题保持原内容。消息文本不重写、不迁移已有 rooms.name，
不改变权限、排序、未读、目标 ID 或同名身份隔离规则。这是本地投影修复，非
Raft 源码逐字移植；没有新的业务状态或缓存 owner。

测试先复现旧 runtime 标题返回，再验证改名、删除、另建同名 principal 后仍按
旧 participant ID 显示正确名称及保留正文。agent-deletion/global-discovery 共
34 项通过，包括既有权限、分页、未读及长消息列查询门禁。

Web 类型检查、正式 bundle 构建、动态多面板真实浏览器回归及 diff 检查通过。
全仓库 check 仍有既有 worker/message-present 登记阻断；format:check 仍有此前
五文件问题，本批文件格式通过。正式实例已备份并安全重启至构建
`014f07151d01009c92351cbd333d36fdbf00c5f11a08d865eab82f3453a8297c`。
新浏览器核验全部五个私聊动态卡片：Gemini、Claude、Codex、旧 Gemini、Kimi；
标题与各自身份记录及右侧对话标题一致，目标消息正常定位。截图人工检查也确认
频道摘要中的旧 OpenCode 发言人已显示 Gemini。两个 Gemini 保持不同 Room 与
participant ID，不合并记录。正式验收仅读取及既有阅读确认，未调用付费 CLI。
