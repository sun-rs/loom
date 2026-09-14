# 删除 Agent 弹窗、关闭图标与服务重启确认

## 来源与边界

Raft 当前发布前端 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
展开副本位于 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。
主 bundle 的 `Ki`（107310 行）为真实确认组件；AgentDetailPanel-CVJr5D-b.js
（SHA256 `e42e78339874cc0d43165b1005d8c246824c399d394eec826492abbe73615afb`）
8612–8628 行的删除入口使用该组件，7557–7564 行定义资料面板关闭按钮。
发布 bundle 只作分析证据，未加入生产依赖；此次为规格的结构移植，沿用内部组件、Icon、焦点和异步所有权。

在 Chrome 的 Raft 正式成员页打开 Alice 删除弹窗后仅取消，未执行删除。
当前测量视口 1098×1172、DPR 2：宽384px、padding24px、标题18/28px 700且uppercase、
关闭按钮32px/图标20px、取消和删除按钮高28px、文字12/12px、padding0 10px。
本地测试另外覆盖1440×900及390×844；不冒充所有内容相同的双边业务验收。

## 根因与修复

1. `AgentStateDialog` 只有停止分支使用紧凑确认规格，删除仍使用520px通用壳及无内距内容区。
   删除现复用既有 `rah-channel-confirmation` CSS，标题没有分隔线，按钮右对齐、间距12px。
   保留必须先停止的已有执行安全边界，故忙碌/启用状态的提示与 Raft 文案不完全相同。
   不复制“删除所有关联数据”的承诺：RAH tombstone 保留账本的既有语义没有改变。
2. 资料面板关闭外框本已28px，内部却是12px文字“×”；替换为共享14px SVG，符合 Raft size-7 + size14。
3. 服务重启由用户明确要求增加确认。Raft MachineDetailPanel-Ci0L3yl4.js（SHA256
   `c4230d33b84462be6118ab74e5a0d74fca59768bf31c63d5e7ad2e4a48f8dde2`）1917行直接 `We("restart")`，
   因此确认是本地明确的交互调整，不称为上游原有功能。复用现有确认样式与 `useDialogProtocol`。
   取消、Escape、外部点击不发请求；确认才调用原重启函数。原 generation 校验、busy拒绝、断线重连和旧页面处理保持。
4. 成功提示改为“服务已重启，连接已恢复”，无句号。与按钮在同一 flex 行，间距12px，文字12/16px、black/50；窄屏空间不足时允许换行。

## 集成基准修正

之前 sq-btn 登记错误引用了确认弹窗关闭按钮，把环境变量行要求成28px。
当前实际 `EnvironmentVariableRow`（主bundle102821行）调用 icon-xs；49318行规格为24px、p-0，
CSS强制内部SVG12px（覆盖JSX的size14属性）。此次据该来源更新登记，同时把本地padding4px/SVG14px纠正为0/12px。
这不是放松断言接受现状：新的精确断言先失败于4px/14px，再修改实现通过。
重新运行组件浏览器采集，更新CSS哈希、匹配规则收据与内部目录。

## 验证

`scripts/test-agent-delete-service-confirm-browser.mjs` 修复前分别失败于520≠384、无SVG、无重启确认。
修复后验证几何、字号、取消、Escape、焦点返回、删除禁用约束、单次确认请求、成功提示位置与灰色。
追加线上实测按钮行高断言先失败16≠12，再修复为12px。
桌面与窄屏截图已人工查看。

更新现有 `run-service-restart-browser-gate.mjs`，在独立临时状态中实际重启服务，验证打开确认不会切换generation、
确认后才重启、丢失回执恢复、旧页面不触发重复重启、持久账本不变。Chrome/Firefox，1440/390四组通过。
临时Provider均为明确fixture，没有运行真实付费CLI，也没有删除/停止正式Agent。

首次全量检查仅失败于并发测试共用 `busy-hold-host`，触发生产锁的正确拒绝。
`busy-hold-recovery-chain.test.ts` 改为从独立临时目录派生测试身份；未改生产锁。
两份测试同时启动均通过，然后重新运行完整检查。

## 正式交付

`npm run check` 退出0：核心1558通过/17跳过，Web407通过，其余组件、协议、浏览器策略与证据门禁通过。
`npm run format:check`、`git diff --check`、正式Web构建通过。
原Agent状态回归更新窄屏“更多操作”定位后，Chrome成功/失败×1440/390四组通过，未改变异步行为断言。

正式实例空闲检查、数据库在线备份及文件校验后平滑重启。
第一次启动发现未继承原Tailnet入口参数，立即再次经过完整备份/空闲检查，以原绑定配置重启；
最终本机、LAN、Tailnet三地址均恢复。最终备份
`~/.rah/backups/pre-restart-8b6c9774-0716-461f-9f82-46fd4308128e`。
冻结构建 `db876927fef9f2c70008daf19cc75bb93cd5b79289e2ab18e047585261ae2056`。

全新Chrome正式页面验证四个原有Agent、删除确认384px/24px内距/18px标题/28px操作按钮/32px关闭按钮及20px图标，
服务确认同一规格；均取消，没有删除、停止Agent或从浏览器再次重启正式服务。
聊天头像入口这次使用键盘Enter打开后，实测关闭外框28×28、SVG14×14，并用真实点击关闭；
不将这一次正式头像pointer打开尝试未完成，误报为已验收的pointer入口。
成功提示的右侧位置/灰色/无句号与真实服务重启恢复，已在隔离Chrome/Firefox门禁验收。
上一批正文引用CSS随本次正式构建部署，独立同文本回归再次通过。
未提交或推送，未运行付费Provider。
