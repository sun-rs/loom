# 高级运行设置接线

使用既有 runtime.settings.read/update，所有字段共用一份读取修订与写意图。只提交实际修改字段；数值由协议 schema 校验，分钟转换为毫秒。不新增后端能力或改变默认值。

## 来源与交互

官方来源沿用 adoption.json：Raft a98ae003246a0360872a77d76dec2fccd0347ef7（https://github.com/botiverse/raft-source）、FSL-1.1-ALv2、raft-ui 0.5.64。SettingsPage → RuntimeSettings 保持现有页容器；高级表单为 Loom 本地组合，使用官方 components/ui/FormField.tsx → raft-ui Field/Input 和 Switch（参照 components/settings/ServerLabRow.tsx 的 checked/disabled/onCheckedChange），不是官方整页复制。官方原始源码与许可不变。

总并发仍在基础区；高级区默认折叠，包含同时启动数、启动间隔、各CLI并发、唤醒上限、预热及watchdog。表单转换逻辑由已有控制台 actions.ts 结构移植到独立 runtime-settings-form.ts，产品不依赖控制台。预热使用 Switch；供给上限只提示，不冒充实际可调度数量。watchdog 明示立即适用于进行中的运行，其他调度参数只影响后续决定。

加载失败禁止保存；轮询不替换草稿；修订冲突保留草稿并要求显式重新读取。此API无幂等键，未知结果不提供自动重发；用户放弃核实后只读现值。保存期间控件禁用。高级区重新读取时保持展开，避免用户重新寻找编辑位置。

## 验证与范围

单测先失败后实现，覆盖最小差量、修订、分钟转换及非法边界。7项定向单测（含官方源摘要和既有控制操作）通过；前端类型、产品构建、格式及diff检查通过。真实临时daemon、无付费CLI，在1440×1000与390×844/DPR1验证保存、并发冲突、草稿保留、未知响应仅提交一次、重新读取与无横向溢出。首次浏览器检查发现重读后折叠区关闭，修复后通过；没有削弱断言。构建保留上游既有大chunk/动态导入提示。

安全备份并优雅重启本地服务后，18张业务投影不变；真实LAN双尺寸页面只读查看高级区，未修改用户运行参数。见[证据](../evo/evidence/2026-10-17-runtime-settings/summary.json)。

## 控制台收拢

前两批已补记忆管理、任务权限、用量与运行诊断，本批补齐高级运行参数编辑。此前列出的用户能力缺口已逐项接线；不代表本批重验全部历史能力。下一步按status §5清单删除控制台工作区、网关静态路由、启动环境与专属测试/构建引用，并做相应部署兼容检查。此次保留控制台，不把“入口已补齐”写成“控制台已退役”。
