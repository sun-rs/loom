# 同模型双边验证：三轮、返工与忙时追加

本轮推进三轮协作、返工及忙时追加的双边实验，再进入多Thread、跨Room/DM、记忆及恢复组合；未修改产品调度。

## 发现并修正的前置差异

- 官网两名专用测试Agent原先都是OpenCode。本地既有样本是Kimi K3/high + OpenCode DeepSeek V4 Flash/low，不能直接比较。
- 经官网把ParityReviewer0908切为Kimi K3并重置运行时会话，保留文件记忆。实际Kimi SDK wire记录确认K3/high；RAH使用ACP，传输差异作为待评估的实现事实保留。
- Raft的OpenCode UI没有effort选择；环境变量合并支持agent.slock.variant=low。但实际OpenCode 1.18.30选build，首次试跑仍default variant。因此parity-rounds-0911频道的首轮至后续观察全部只计预检，已发Human停止指令，不计同条件通过或性能比较。
- 已经官网将配置改为default_agent=slock、agent.slock.variant=low，并仅重置运行时会话。该配置和模型variant均有源码依据，下一次真实消息还需确认agent=slock、variant=low；不以保存配置代替执行证明。
- 原本本地验收脚本正文提及两名Agent，却只给首位recipients。官网实际识别两个提及。本轮脚本改为两位都收到初始mention，旧样本保留，但不作为完全同条件对照。

证据与精确源码位置见[Runtime双边预检](./2026-09-11-runtime-bilateral-preflight.zh-CN.md)。首次不匹配运行的白名单记录为`/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-preflight/first-raft-run-model-whitelist.json`。

## 运行状态

本地匹配双提及运行日志：`/Users/sun/Code/reviews/rah_os/2026-09-11-bilateral-preflight/rah-both-mentioned-rounds.log`。该次真实运行完整通过，测试全程181.24秒；三轮业务结果1、3、6，三个PASS后GOAL，20秒停止观察，无Human催促。持久消息8条（含1条Human）。消息接受至GOAL为141.743秒，测试总时长另含准备、停止观察与清理，不能混用。

官网已建立独立私密频道parity-rounds-0911-matched，只含Human与两名专用Agent。初始指令仅替换handle，其余文本来自本地门禁常量。双方顺序执行，避免同时运行模型的争用。

此处为运行中的历史记录；三轮、返工与忙时追加的最终结果见下文。多Thread、跨Room/DM及恢复组合仍未在本轮完成双边验证。单样本结果不代表高可用。

## 第二次静态前提遗漏

`parity-rounds-0911-matched` 实际已完成三轮与GOAL，但审计者仍为default variant：OpenCode规定Agent的variant仅在使用该Agent明确配置的model时生效。前置检查只验证了variant字段合法，漏掉model绑定条件；该样本也不计同effort验收。随后通过官网停止专用审计者，保存完整配置并仅重置运行时会话：

```json
{
  "default_agent": "slock",
  "agent": {
    "slock": { "model": "deepseek/deepseek-v4-flash", "variant": "low" }
  }
}
```

完整配置已用不计费的OpenCode debug config/debug agent --pure验证默认Agent、model和variant。两份白名单证据在`/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-preflight/`。新的`parity-rounds-0911-verified`频道只用于完整参数验证；不能用前两次默认variant结果代替它。

## 仍不能作为严格性能结论的条件

两边测试均用临时分工及同一正文（handle替换），但Raft复用专用测试Agent，其私有记忆和Kimi会话有此前实验历史；本地是临时新身份。SDK/ACP与进程生命周期是被测产品差异，既有会话历史则是环境差异。即使模型/effort全部核实，本轮时间也只能作为描述性样本，不能据此宣称某产品更快或定位177秒延迟根因。

## 第三次：同模型/effort三轮业务样本通过

Raft频道`19f931b0-8dc2-497f-ac16-da0fbb4d3c3e`（parity-rounds-0911-verified）已实际完成：PROPOSE1 SUM1 → REVIEW1 PASS → PROPOSE2 SUM3 → REVIEW2 PASS → PROPOSE3 SUM6 → REVIEW3 PASS → GOAL。每项各一次，发送人轮换正确，无Human中途催促；GOAL后实际再次读取官网页面超过20秒，未出现追加回复。浏览器截图和AX核验与七条真实CLI发送成功回执一致。

第三次实际OpenCode session为`ses_f73668187ffedOOI6ZcBTwJPF1`，session/user/assistant层均为slock、DeepSeek V4 Flash、low。Kimi实际为K3/high。白名单`third-raft-run-model-whitelist.json`与`third-raft-business-receipts.json`保留在上述runtime-preflight证据目录。前三次REVIEW真实经过hold→send-draft成功；这不是单凭退出码推断的完成。

| 业务检查                 | RAH双提及样本             | Raft第三次样本                  |
| ------------------------ | ------------------------- | ------------------------------- |
| 三个计算值               | 1、3、6                   | 1、3、6                         |
| 每轮审计后才能进入下一轮 | 通过                      | 通过                            |
| Agent显式消息            | 7条                       | 7条，均有成功回执ID             |
| 无Human催促完成及停止    | 通过，20秒静止            | 通过，浏览器再次核验超过20秒    |
| 实际模型/effort          | K3/high、DeepSeek/low     | K3/high、DeepSeek/low           |
| 从Human接受到GOAL        | 141.743秒，账本created_at | 未取得精确Human接受时间，不计算 |

Raft首PROPOSE成功回执至GOAL成功回执为92.680秒。这与RAH的Human起点、canonical created_at不同，不能放在同一列判定性能优劣。Raft GOAL回执时间为上海02:36:08.774，ID`635e877d-26b6-4b5f-a261-7f213728d555`。

截至三轮结束时只关闭这一组业务样本；后续返工与忙时结果见下文。真实新provider session的记忆召回、双Thread组合及切换恢复仍未收口；第3项源码审查已完成，调度移植决策仍需忙时结果和分段时间证据。没有修改产品调度、正式数据或重启RAH正式实例；本轮只修改验收脚本与文档，以及Raft专用测试Agent配置/实验频道。

## 返工继续验证

本地双提及返工真实门禁通过，全程217.27秒。错误值5经审计指出、修复为6、再审PASS、GOAL及静止观察均通过。原账本消息与最终文件已另存`rah-rework-messages.json`、`rah-rework-result.txt`。

Raft专用Agent工作目录不同，因此本次仅把同一模板中的文件名和标记转换为共享测试文件的绝对路径，并替换handle。先等本地进程退出，保存SUM6证据，再把该一次性文件恢复SUM5、删除一次性忙时标记，才在Raft独立频道发指令。`rework-shared-file-manifest.json`记录路径与两端初值/终值摘要；没有修改任何Agent私有记忆或用户项目。此路径表达差异显式保留，不声称指令字节完全相同。

全量check曾在旧UI抽取回归脚本失败：新RailButton依赖HintTooltip，而抽取器未提供该真实组件，报ReferenceError。已让抽取器使用真实HintTooltip与Base UI Tooltip，不删断言、不以空stub替代；该回归34项通过，check后续两组也通过。此前check中的类型、后端与Web单元阶段均已通过。format与diff检查通过。该修正仅作用于测试夹具，不需重启不变的产品构建。

Raft返工也已通过：实际REWORK读取SUM5，Kimi修改同一文件至SUM6，OpenCode再次读取并PASS，Kimi发布GOAL。四个成功回执分别为02:42:53.573、02:44:26.317、02:44:36.637、02:44:54.474，均为正确频道。最终文件已保存`raft-rework-result.txt`，与本地最终文件一致。

曾遇到原生浏览器采集画面/AX未及时呈现后续消息；逐条核实target和跨Agent收件后排除了错Room，显式Raise Chrome再截图已显示正确四条。不能凭之前滞后的截图宣布Raft串线或实时更新缺陷。该场完成后的页面没有额外业务消息；消息、文件、收件与回执共同确认闭环，不以仅有exit 0为证据。

## 忙时追加：本地新样本通过，官网进行中

双初始提及的本地rework-busy门禁通过，全测试430.96秒。Human追加接受于18:50:13.018Z，独立NOTE:ACK于18:53:24.782Z（191.764秒），GOAL于18:53:34.037Z；原修复和再审先完成，追加没有替代原任务。20秒停止观察通过、最终文件SUM6、无Human催促。追加阶段存在真实工具调用失败后恢复，不以本次通过掩盖这段诊断。完整账本及busy时leased Activation证据保存为`rah-busy-result.json`，原文件保存`rah-busy-final.txt`。

等该测试退出后才重置一次性文件为SUM5并清除marker；随后在官网`parity-busy-rework-0911`发送相同业务指令（handle与绝对文件路径转换）。官网结果尚待采集，不把本地成功计为双边成功。

## 本轮最终业务结果与仍未关闭的范围

Raft忙时频道`f14153a2-4813-47f3-b557-8783d568e90d`实际得到REWORK → NOTE:ACK → REPAIR:DONE → AUDIT:PASS → GOAL:DONE，五条独立Agent消息各一次。主线程显式激活Chrome后目视检查完整页面，超过20秒再取页面，无新增消息且运行提示消失。两端最终文件字节均为`SUM=6\n`，官网文件保存在`raft-busy-final.txt`。这是本轮忙时业务样本通过，不代表所有忙时场景均通过。

触发条件必须保留精度边界：Kimi工具sleep窗口为上海02:57:53.846–02:58:13.882；官网追加消息只有02:58:13的秒级创建时间，daemon接收于02:58:14.226，turn.steer于02:58:17.237。已证明原任务尚在运行时追加，不能严格证明服务器接受发生在sleep结束前，更不能冒称两边以同一毫秒偏移触发。

| 本轮范围                                          | 状态                       | 不应外推的结论                              |
| ------------------------------------------------- | -------------------------- | ------------------------------------------- |
| 三轮执行/审计后停止                               | 两端真实业务样本通过       | 不等于所有模型、多Thread均通过              |
| 发现错误、修复、再审通过                          | 两端真实文件与消息通过     | 文件路径表达有本地适配，非指令字节完全相同  |
| 忙时追加不取消原流程                              | 两端独立确认与原流程均通过 | 确认顺序和时延不同，sleep触发精度未完全一致 |
| Runtime生命周期审查                               | 四类驱动源码核实           | 没有实施常驻进程/steer移植                  |
| 多Thread、跨Room/DM、真实新会话记忆及切换恢复组合 | 已查清现有门禁缺口，待补验 | 旧基本路径成功不能替代该组合                |

下一施工顺序保持单闭环：先补双Thread目标归属的组合验收，再补真实provider新会话的记忆正反对照，最后叠加配置切换与恢复。Runtime优化需先记录队列、启动、模型执行、工具发送各段耗时，再按源码确定最小移植边界；不因单次差距直接重写全部调度。

子代理独立核验五条官网成功回执：REWORK 02:57:36.209、NOTE 02:58:36.057、REPAIR 02:58:58.177、PASS 02:59:08.747、GOAL 02:59:25.967（上海时间）；全部目标为忙时频道、各有独立Message ID。实际K3/high与DeepSeek/low持续成立。官网追加创建秒级时间至NOTE成功回执约22–23秒，本地账本追加至NOTE为191.764秒；终点与精度不同，只作描述性观察，不是严格性能倍率。真实turn.steer证明该次官网原运行接收了追加，仍不能把全部时差归因于进程复用。
