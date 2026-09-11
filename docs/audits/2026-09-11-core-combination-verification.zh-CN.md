# 多 Agent 核心组合验收：当前证据与未收口项

本轮依据用户要求继续验证双 Thread、新会话跨 Room/DM 记忆、配置切换与断线/重启，并追查本地追加 191.764 秒相对 Raft 约22–23秒的原因。所有真实 CLI 使用授权绑定；临时状态与正式4173分开，没有提交、推送或替换正式产品。

## 追加延迟

[分段根因与 Raft 源码位置](./2026-09-11-busy-latency-root-cause.zh-CN.md)已经确认：132.445秒等待旧运行退出，启动/领取不到1秒；sync已返回的同一消息又触发hold。后者有不使用模型的真实Kernel/HTTP复现，但官网check后同样hold；已撤回将sync直接视为target read的修复方案。Raft Kimi使用SDK steer，本地ACP拒绝busy第二prompt。根因已定位，产品修复尚未实施，不能把本批验收说成延迟修复。

## 双 Thread

[双Thread门禁](./2026-09-11-dual-thread-combination-gate.zh-CN.md)记录本地两线程交叉执行/审计，七条业务回复的发送者、目标、顺序与结果均正确，八个Run退出、Activation完成。原付费门禁因验证器把PASS里引用的DONE当成DONE而失败；修正验证器后，只对保留账本进行了离线重放。门禁尾部20秒自然静默未运行，不能宣布原付费门禁整项通过。

官网也看到七条正确的Thread业务回复。但A第一次点击未提交，B实际先完成；A追加又晚于计算与审计。该官网样本证明Thread寻址与回复流程，不满足“同条件双线程重叠、同触发点忙时追加”的严格双边条件。此项仍需新的有效组合样本，保留原始操作偏差。

## 新会话记忆

[本地原门禁与checkpoint记录](./2026-09-11-core-chain-fresh-provider-session.zh-CN.md)区分首次失败和续验。原门禁先在共享Room公开S5事实，又同时要求A公开私聊S3、B做“不知道”负对照，因此后面的秘密泄露断言无效；不能当作产品泄露，也不能当作隔离通过。

续验保留同一状态、角色、模型/effort，从更正开始。判据要求Human session reset真实清除continuity、记忆文件不变、新provider sessionId、实际读取私有文件和更正后的回答，不能只以RunAttempt变新或模型自述证明新会话记忆。

官网已另做无污染负对照：新Cypress事实只给A的DM，A实际写自己的MEMORY.md，B在自己的DM先回答PRIVATE:UNKNOWN，然后才允许A公开召回。经网页“重置会话并重启（保留MEMORY.md/notes）”，provider session从1544693f…变为82bf7004…，文件快照保持一致；新会话K3/high先Read自己的MEMORY.md（工具结果含事实），再在另一Room回复正确口令。不是从旧provider上下文或该Room旧消息里获得答案。此轮属于行为隔离证据，不能替代恶意跨目录文件访问的沙箱证明。

官网证据位于 `/Users/sun/Code/reviews/rah_os/2026-09-11-busy-latency/private-memory-control.json`、`raft-private-memory-tools.json`。本地真正新会话的Room B/DM更正召回checkpoint已经683秒独立通过，工具证据含先读自己的MEMORY.md及notes。独立无污染负对照以380秒完成：A文件实际保存Cypress事实，B自己的DM先回复UNKNOWN、其文件无该事实、账本所有其他Room没有提前公开，最后A回读正确。实际B执行deepseek-v4-flash/low且Read自己的MEMORY.md，工具输出未含秘密；两边A/B保存与负对照使用相同文本。此样本本身没有再reset，与683秒的新会话样本分别记账，不套用原失败门禁的通过标签。官网返回DM也已正确回复PRIVATE:DM-RETURN。

## 浏览器断线与服务恢复

真实冻结Web接到隔离真实CLI daemon，浏览器离线8秒后重连，已显示消息ID保持且无重复；截图已检查。首次原门禁提前失败，未到配置切换与计划重启；不能把测试退出造成的offline记录算成重启恢复。配置续验已实际完成Kimi忙时切OpenCode/DeepSeek low的revision/driver核验，随后有序重启；原任务S4 BUSY DONE与追加两条EXISTS、ORIOLE-2最终均在Room A出现且无重复。运行中的Room B背景Activation在取消后由新Run恢复；Human CCG10当时是在Room A排队，重启后执行，不能说正在执行的CCG10被中断并接续。

原付费续验最终exit1：末尾通用断言只允许exited0/orphaned，将有序重启的cancelled也判失败。独立复核还发现业务问题：steady-c的S4 AUDIT DONE发在Room B，而Human CCG9来自Room A。因此不能因为文件正确、进程退出和主Agent追加完成，就宣称配置组合全部通过。原生Codex轨迹确认：Run激活Room A，sync返回CCG9后，模型显式调用message-post到#core-chain-room-b，hold后又向同一错误目标send-draft；不是后端将正确目标重定向。Raft formatMessageLine逐消息带可发送target，本地eventLines/renderSync没有目标头，standing prompt仅给opaque Room UUID。Codex resume确实更新developerInstructions，不能说完全没有更新上下文。可寻址目标缺失是已确认的工具呈现差异，是否单独导致此次模型选错仍需受控复现。

浏览器观察到重启后的最新10条Room消息自动显示且无重复，截图已检查。隔离观察器在daemon更换临时端口时重新绑定临时Gateway；这是冻结Web对真实daemon的恢复证据，不是正式部署的重启链或Raft官方Computer重启对照。

## 验证状态

普通 `npm run check`（含新增脚本后的复跑）、typecheck、format:check、git diff --check均已退出0。新增测试脚本需分别核类型、格式及实际付费结果；普通检查跳过付费门禁，不代表这些组合已验收。正式服务和生产源码未在本批修改；本批不声明正式部署或全部Raft对齐。

原完整门禁的负对照设计已改为先在B独立DM询问仅S3，再让A公开召回；公开Room中的S5不再冒充私有事实。新增私聊负对照门禁还检查账本无提前公开。此次未重跑修改后的完整付费门禁，原失败结论保留。

收件箱check/sync、精确消息ID去重与连续新鲜度边界的进一步来源核对：[边界复核](./2026-09-11-check-read-freshness-boundary.zh-CN.md)。Raft本次首次hold不是关闭所有新鲜度检查的理由；此前直接改sync的建议已撤回。

## 后续施工顺序

1. 先按Raft格式补齐收件箱/历史输出的可发送目标与回复位置证据，并以跨Room旧session、双Thread和DM回归验明；不能通过禁止跨Room发送来遮盖错误。
2. 再移植有能力支持的Runtime忙时通知/steer通道，保留单执行lane、持久follow-up与真实消费/完成边界，量化消除等待旧运行退出的时间。
3. 完成严格同条件双Thread并行与运行中追加、指定Human工作确实在执行时中断/恢复的双边样本。已有排队恢复或背景Activation恢复不能替代这条条件。

本轮定位及实验未修改生产调度或正式服务；不能宣称新增延迟/目标问题已修复。
