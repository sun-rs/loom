# 搜索原生筛选与结果分组（2026-10-16）

来源：[Raft 官方源码](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2，原始文件和声明保留。

| 官方位置                                    | 本地接线                            | 复用性质                                                                                                                           |
| ------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| MessageSearchPage.tsx 2045–2120、2154–2224  | SearchIdentityFilter.tsx            | 原 From／Channel JSX 结构移植，直接使用 Combobox、PickerTriggerButton、AvatarSlot；保持字号、图标、弹层 portal、清除及输入事件规则 |
| MessageSearchPage.tsx 999–1041、862 附近    | native-search.ts、SearchFilters.tsx | 发件人／范围冲突消解和清除筛选规则移植，Loom 的 scopes 参数使用逗号分隔；清除不重置 query／sort                                    |
| searchGrouping.ts groupMessageSearchResults | native-search.ts groupSearchRows    | 直接调用官方分组函数；只映射消息字段                                                                                               |
| MessageSearchPage.tsx 2540–2580             | SearchMessageGroups.tsx             | 官方线程结果容器、标题、命中数、时间、选中态和嵌套 MessageHitRow 结构移植                                                          |

数据来自已有认证 SDK search 空查询目录及 principal.me；选择后使用 senderIds／roomIds。目录加载中禁用原控件，失败明确提示并可重新读取，取消旧请求后不写入过期结果。查看结果保留 senderId／channelId。没有新增后端接口、业务状态或另一套搜索实现。既有分页保持有界，每页20条，分组仅涵盖当前页。

TDD：先新增筛选映射、冲突／清除语义、分组测试，分别记录缺失参数与未实现函数失败；随后最小接线。71项来源／适配测试、前端独立typecheck、构建通过。1440×1000 与390×844（DPR1）专项通过：选本人、选频道、校验请求ID、打开后保留筛选、分组消息ID与权威搜索页逐项一致；原动态／线程／缩放链路仍通过。首轮浏览器误将20条分页当作同一线程20条，实际一条为非线程命中；修正为校验后端实际ID集合，保留失败记录。未跑全仓检查、未调用付费CLI。

边界：目录接口当前最多100个频道／100个principal，候选仅在这批目录中搜索；服务端目录未提供displayName时沿用handle，未伪造姓名或头像。目录不会因新成员实时变化自动刷新，重进搜索页重新读取。仍欠实体结果、快捷搜索浮层、完整结果键盘导航、原生跨页追加与精确来源返回；本批不是整页字节级复制。
