# 现行项目记忆

1. 筛选
2. 格式

## 筛选

仅保存经证实、跨回合有效的约定、环境限制与入口。先搜索同义条目。复用原 ID 更新，过期条目标出替代关系。当前裁决优先。

## 格式

写 `.project/memory/items/<id>.md`，总计 ≤200 tokens。两行 `---` 夹单行 JSON，字段 `id/scope/owner/source/verified`，其中 `scope: project`。可选 `expires/supersededBy/keywords`。再写 `# 标题`、空行及正文。ID 和 owner 用小写字母、数字、连字符或下划线。日期用 YYYY-MM-DD。source 为相对文件或 SHA，keywords 为字符串。正文和标题避免计数斜杠与项目外路径。

<!-- PILOT2-GOAL-8F: 预留跨会话类别、Why / How to apply、去重、修订和候选权限。
只读参照 loom-pilot2@4ddcd51c:memory/prompts.mjs。待适用的 loom mem 接口和角色规则合入。 -->
