# 完整官方1.21.23候选：Role／实例与频道管理接线

本批只更新外部 `adapter123`，官方2463份源文件与原始依赖锁不改。**正式服务未替换、未为候选重启**。当前完整官方基线为Web1.21.23／UI0.7.0；不是混入最新网页片段，也不是整站迁移完成。

## 已接通并验收

- 官方资料页保留，Role描述与可执行prompt使用声明的独立扩展槽；共用原生Dialog、字段和确认弹窗。描述／提示词入口分别聚焦；空prompt可保存。提示词只在私有详情读取，不进入Role列表DTO；旧实例冻结修订不变。
- Role资料中的实例区域复用原版MachineAgentRow和ListRowGroup，一个外框及原生行；从原生Dialog选择频道新建实例，新实例采用当前Role修订。
- 原版生命周期展示缓存只调用既有SDK所有者，读取真实状态，不复制原版乐观working/offline推断。Role启停按真实Instance对应Agent ID执行；删除Role保留实例及历史，恢复保持Role ID并生成修订。
- 保留原生会话的重启经disable／enable执行；显式新会话使用`instance.session.reset`，默认保留冻结配置与现有启用状态。原版重置弹窗保留，说明文字准确表达两者，不开放清空共享工作区。
- 频道名称／描述、静音／折叠长消息经原生设置界面保存。偏好携带实际显示修订、稀疏patch与共享WriteIntentSlot；接受后的完整偏好快照同时更新原生缓存版本，连续操作不拿旧版本提交。
- 成员增加／移除、归档／恢复、永久频道删除已映射既有SDK及Room因果围栏，**这些路径本批仅有单测，尚未完整浏览器验收**。

## 证明与限制

`core-management.json`：真实临时Core、Fake运行时，1440×1000和390×844各执行上述Role编辑、空prompt、焦点、实例创建、批量启停／重启／重置、删除／恢复、频道改名及两项偏好，逐项读取SDK核实，pageerror为空；付费调用0。四张截图为实际临时Core界面，非正式数据；已人工查看桌面／手机实例区域。

`unit.txt`：37项定向测试，含2463原始文件hash、身份／修订／部分失败／错误路由／未知写入既有围栏。候选类型／构建、单React与UI运行时、根类型检查和旧稳定产品兼容构建通过；原版chunk及dynamic import警告保留，未据此宣称性能验收。

`pixel-regression.json`：既有14组原版／候选页面对照均0差异，1px偏移反向校验有效。`interaction-regression.json`：既有21组菜单、指针拖动和分栏对照均0差异。这些证明共同界面未回归；**Role专属扩展槽不伪称与不存在Role语义的原版Agent完全相同**。`core-regression.json`保留基础真实Core两尺寸流程通过。

新测试只清理临时Core明确登记且末级目录名等于Room ID的主目录，先停止Core再删除；不扫描或删除正式频道目录，不删除Human附加目录。

## 验收发现的实际兼容问题

曾把原生Agent重启映射到通用`agent.execution.reset`。Kernel明确禁止Role实例使用该旧接口，原生弹窗无法完成；原失败保留在`failed-generic-reset-before-fix.json`。修复采用既有实例状态控制，重置另走专用接口；红测试与真实Core复验要求不再发送通用execution-reset请求。未放松Kernel围栏。

早期焦点／选择器及等待条件也有测试错误：原生ConfirmDialog使用dialog-content，移动端顶部重启按钮隐藏，字段标签并非Switch本体。修正测试点击可见原生控件，等待实际焦点与SDK结果；不能把这些调试失败写成付费模型或业务缺陷。

## 剩余迁移

实例采用最新Role配置的显式选择、频道成员及删除完整浏览器流程、独立单聊／频道实例私密／线程、其余消息任务文件记忆、通知/PWA、Loom批准的移动政策及不支持入口省略仍待接。没有部署本候选；不能由本批通过宣布全站完成。

```sh
npm run build:official-web:native123
npm run test:official-web:native123
LOOM_BROWSER_SLICE=native123-management LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
```
