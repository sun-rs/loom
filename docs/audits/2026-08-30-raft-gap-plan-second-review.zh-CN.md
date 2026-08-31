# 修复方案二次审查

审查对象：[缺口修复方案](../product/raft-gap-repair-plan.zh-CN.md)。这是同一执行者在施工前的反例审查，不冒称独立第三方报告。

## 裁决

允许 A 施工；B–F 仅进入计划，不准以“Raft 也是这样”跳过各自权限/恢复测试。idle wake 保持关闭，直到 lifecycle 专项通过。保留已验证的原版记忆索引与正文布局。

| 反例                                                   | 审查裁决 / 施工要求                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| JSON 原子 rename 是否等于 CAS？                        | 否；两进程仍可同时读旧 revision。采用现有 SQLite 事务，不新增自制文件锁协议。                   |
| 配置 revision 是否能借 AgentDefinition revision？      | 否；人设编辑与 cleaner 是独立变化轴，测试必须证明不会覆盖。                                     |
| enabled=false 能否表示不使用记忆？                     | 否；仅关闭 cleaner，UI 必须明确；不得当作临时对话安全隔离。                                     |
| 读配置是否扫描 notes、创建索引或唤醒模型？             | 都不允许；默认读取不落盘，PATCH 只配置 timer，不主动运行模型。                                  |
| reset memory 是否删除 cleaner 设置？                   | 不应；配置在 Agent home 外，清空内容和重置配置是不同操作。                                      |
| PATCH 成功前/后进程退出？                              | 提交前事务回滚；提交后重开读到新 revision。内存应用不能反向覆盖已提交版本。                     |
| reset 与配置 PATCH 并发会否复活 timer？                | reset 期间只能持久更新，不重装运行态；下次合法 activation 恢复最新配置。                        |
| Client 传另一个 Agent ID 或 Agent CLI 猜 participant？ | Human 走现有管理权限；CLI owner 绑定 capability，接口不允许传 owner。                           |
| 同 revision 覆盖与非法 set/unset？                     | 明确冲突，整次不写；schema 严格拒绝，禁止自动重试覆盖用户选择。                                 |
| 文件树显示阈值与 timer 不一致？                        | Coordinator 统一从持久配置获得 effective threshold；UI 不另存一份业务状态。                     |
| 新增 SQLite 是否在魔改记忆系统？                       | 只保存三字段配置，不读写索引/notes，也不增模型上下文。属 CAS 的本地持久化适配，不是新记忆算法。 |
| 一批通过是否等于与 Raft 全等？                         | 否；上游 server 未提供、官方离线运行等证据边界必须保留。                                        |

## 仍需运行时证明

以上是设计裁决，不是测试结果。必须看到红测试、绿测试和真实浏览器保存结果后，才允许把 A 标为已完成。尤其不能将自测 mock 的成功声明为真实模型已做自动维护。
