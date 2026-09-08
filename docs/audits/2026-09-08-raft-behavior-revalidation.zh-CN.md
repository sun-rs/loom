# 八项反例的 Raft 行为复核与重新分类

2026-09-08。用户要求先核实 Raft 源码及官网行为，再裁决之前八项反例的产品含义。本轮没有修复 RAH 产品；本报告修正[交付后反证审计](./2026-09-08-post-delivery-independent-review.zh-CN.md)的证据分类与施工优先级解释。

## 结论

**八项本地现象仍有复现证据，但不能统称八项 Raft 复刻缺陷，也不能仅凭先前 P1/P2 排序全部插到复刻主线前面。** 本轮完成授权源码核对和官网部分实验；没有完成八项的同条件服务端实验。不能观察的条件列为未知，不以自有合同填补。

Raft 的任务接口、负责人、转换、鉴权请求实际进入服务端；npm Computer 提供运行监督、本地代理及文件处理，不包含所有中央业务处理器。不能以“多数运算在本机”为由预设中央服务只做账单。本地一体化 daemon 可以承接这些责任，但首先应复制经过证实的业务行为，而不是反向要求 Raft 满足 RAH 自增参数。

## 逐项重新裁决

| 原编号                         | Raft 证据与真实实验                                                                                                                                                                                               | 当前裁决                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1 清除负责人后不能接手        | 官方 CLI 明确 unassign 后开放；官网负责人菜单确有“未指派”。官方提供 claim，历史实验任务可见 Agent 改负责人、todo→in_progress→done 的记录。**本轮未执行清除→另一个 Agent 接手的完整链。**                          | 开放任务可接手有上游依据；RAH 自己发唤醒却拒绝 claim 是本地实现缺口。不能宣称已实证官方会自动唤醒哪些 Agent。           |
| A2 撤销后 submit/MCP 仍成功    | 官方 stop 会移除本地代理注册、发起 runner credential 撤销、终止 runtime；但可见 proxy/MCP 也有入口缓存 registration 后 await 的路径。闭源服务端撤销接受点未知；Raft 没有已证明等价于 RAH 冻结证据 submit 的合同。 | RAH 当前撤销承诺的内部问题。**没有证据证明 Raft 在相同等待窗口会拒绝。** 不得当作官方已实现的更强保证。                 |
| A3 LAN 撤销后仍重启            | 官网确有 Computer restart，本轮点击后直接进入重启中，随后刷新显示已连接。官方走 Human 云端请求→Server→Computer；未找到与 RAH LAN 配对 cookie 撤销等价的入口。                                                     | 本地部署认证适配问题；不是已确认的 Raft 差异。官网重启成功不能回答在途请求撤销问题。                                    |
| A4 convert 跨 Run 同键重试失败 | 官方 CLI convert 标准参数只有 channel/message_id；Web 只有 messageId，没有 RAH 的稳定 key、basedOnRoomSeq 或 Run 参数。                                                                                           | 先前引用的是 RAH 自有回执合同。重复同消息究竟返回原 Task 还是冲突仍待官方实验；不要求借“复刻”新增跨 Run 回执体系。      |
| A5 unblock 后回执受改派影响    | 官方公开 Task 五状态为 todo/in_progress/in_review/done/closed；无 Task blocked/unblock 对应接口。官网五列一致。                                                                                                   | 无直接官方对应，应作为 RAH 已有恢复机制单独裁决；从 Raft 必修差异中移出，不自动删除现有机制。                           |
| A6 暂停过渡期仍可上传 Artifact | 官网停止文案表示停止处理消息，实际停止后显示重启前不接收消息；源码有撤销、终止链。普通上传按 channel 绑定，未见 RAH Task Artifact/claim 对应要求。                                                                | 停止必须有效有上游依据；在途上传立即中断还是允许已接受工作收尾，官网本轮未测。不得仅据不同接口的 200/403 决定强制收紧。 |
| A7 Task claim 到期仍可上传     | 官方可见上传请求不带 Task claim；未找到与 RAH claim_until_ms 等价的公开合同。                                                                                                                                     | RAH 额外租约与文件 owner 的一致性问题，不是可直接比较的官方缺口。是否必须绑定上传与 claim，要按当前本地目的最小裁决。   |
| A8 A 迟到响应关闭 B 确认框     | Raft 当前通用确认窗也使用 await onConfirm 后 onClose，未见该处 lifetime guard。官网 GPRS 下停止 A→Back→打开 B 的确认框，本轮保持打开；但 A 已停止，未建立精确迟到前提。                                           | RAH 串窗实证保留；不能说 Raft 已解决，也不能说官网相同竞态不存在。本轮慢网实验不构成排除测试。                          |

对应源码段落、行号、UTF-8 字节偏移及哈希：

- [Task：A1/A4/A5](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/task-upstream-revalidation.zh-CN.md)。
- [Computer/Agent：A3/A8](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/computer-a3-a8/review.zh-CN.md)。
- [Worker 代理、停止和附件：A2/A6/A7](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/raft-a2-a6-a7-revalidation.zh-CN.md)、[来源清单](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/source-evidence.json)及同目录原始源码摘录。

## 官网实操记录

官方站点 `app.raft.build`，已登录 Workspace `hakasemac`；Firefox 响应式视区显示 1440×900、DPR 2。正常网络→一次 GPRS 50/20 Kbps、500ms→恢复不节流。视区参数是浏览器工具显示值，不作为精确截图像素验收。

1. 打开 Task 看板及 `#test #2`，观察五列、状态菜单、负责人“未指派”菜单。没有更改这些既有 Task 的状态或负责人。
2. 查看 `#parity-core-20260829 #2` 的历史：创建为 todo，Alice 改负责人、进入进行中、完成。这是本轮读取到的历史业务记录，不是本轮新执行的 Agent claim。[历史 AX](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/official-task-history.ax.txt)、[截图](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/official-task-history.png)；[负责人菜单](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/official-assignee-menu.png)。
3. 对已有实验 Agent ParityAuditorA 打开停止确认，活动页加载后看到最近空闲。在 GPRS 下确认停止并立即 Back 至 Cindy，再打开 Cindy 停止框；框保持打开，**没有停止 Cindy**。A 的停止已先完成，不能把这次当作精准延迟响应实验。随后启动 A 恢复实验前 enabled/online；启动时曾短暂显示 working，不能声称绝未触发模型活动或零费用。本轮没有发送新讨论消息、任务指令，也没有直接运行付费 CLI 测试脚本。
4. 点击 Computer 重启入口时，原本拟查看确认语义，但官网**没有二次确认，立即发出真实重启**。主审即时告知用户，观察重启中、按钮恢复；随后刷新再次确认已连接，五个 Agent 均在线。[刷新后 AX](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/official-computer-after-reload.ax.txt)、[截图](/Users/sun/Code/reviews/rah_os/2026-09-08-raft-behavior-revalidation/official-computer-after-reload.png)。没有读取进程代际或核对 requestId，故仅声明页面接受及恢复显示，不冒充底层重启完整证明。

停止/启动及重启中的即时原始截图在本对话工具记录中；并非所有中间状态都另存文件。上列持久文件保存的是任务菜单/历史与最终恢复态。浏览器实验会写官方控制操作记录，不能说“本轮完全只读”。RAH 正式服务及业务数据没有被操作，产品代码未改。

## 策略与下一步边界

- **保留事实，撤回过度归类。** 原反例不删除，原严重性是相对于 RAH 当前合同；不把它转换为 Raft 复刻优先级。
- **A1 按已证实目标继续验证。** 专用 todo 的分配→清除→另一合法 Agent 接手才是终点。Human 在浏览器接手不能替代 Agent 身份验证；自动唤醒策略必须单独记录。
- **A2/A3 是已有本地能力的正确性问题。** 可以在既有 owner 内做最小修复，但不能以它们为理由新建更复杂的权限、队列或中央服务，也不能宣传为已照搬官方算法。
- **A4/A5/A7 先做本地合同裁决；A6 补停止与在途上传的证据。** 当前不把更强的回执或 lease 语义新增为“完美复刻”阻塞项。保持已验证的认证和执行围栏，不因缺官方源码而删掉。
- **A8 保留为局部界面可靠性问题。** 精确的双边实验还需保持 A 响应在途再切 B；本轮未完成，不伪造官方已通过。即使上游存在同类 bug，也没有必要回退 RAH 已经验证的保护。

因此，本轮所得是八项的证据重新分类和部分真实实验，而非“八项官网全通过”。余下未知项应按对应的真实请求和 actor 条件继续验证；没有对应概念的项目不强行拼出同条件实验。
