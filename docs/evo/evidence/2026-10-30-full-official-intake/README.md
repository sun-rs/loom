# Web1.21.40整版提取与原版独立启动

Owner要求完整Web1.21.40＋UI0.52.2，随后明确允许直接提取部署代码。本批完成**整版依赖取得和隔离启动**；没有把旧页面继续拼补为新版，也没有宣布正式产品整体迁移完成。

## 取得与完整性

- 固定官方HTML release：`a7bb80017084e766d68b8a1d7c6377496a16fbaa`，`release/v1.21.40`，build `2026-10-29T17:16:56Z`。
- [完整归档与来源](../../../../frontends/raft/upstream/releases/README.md)：Web316资源、219第一方JS模块、19538241字节；归档5753170字节，SHA256 `68095d3eed26816b8d042654ebcabc20884c7b6ded4539efbc77fcd4f7a9093b`。
- [完整性结果](integrity.json)：所有文件原字节、静态依赖重新解析、316文件均从HTML根可达，无缺边或额外未登记文件；唯一非字面量import单独记录为React Router通用运行时`import(e.module)`。这是完整第一方**可执行发布图**，不是恢复的原始TSX／原项目构建工程。
- UI完整Git树来自`botiverse/raft-design v0.52.2`，commit `3c992b50d747cf00b022d8b1c1817a6aca3626b6`；[独立Git树核验](ui-source-tree-integrity.json)确认1839个文件／3个符号链接的内容均与官方Git blob一致，无漏名、无LFS指针，许可证保留。
- 外部Cloudflare遥测不纳入UI依赖；业务API、WebSocket和用户内容不在静态资源图内。单个bundle或目录中选出的文件不再作为整版取得证明。

## 原版隔离运行

[浏览器报告](native-release-browser.json)使用虚构Human／workspace和显式fixture API；**无Loom生产请求，无真实provider调用**。Playwright拦截全部HTTP请求，WebSocket关闭，Service Worker禁止，不把合成token发送到外部。

- 桌面Chromium1440×1000：聊天、动态、任务、成员、计算机、账户。
- 手机尺寸Chromium与WebKit390×844：聊天、动态、任务、外观。
- 共14个页面状态，均等待该页面原生内容标记出现后截图，不能只用“没有异常／有body文字”把加载画面当作通过。
- 3个环境请求到的第一方资源均在完整归档中；无pageerror，导航保持同一个document。实际加载26／26／27资源，保持原版lazy导入，**219模块并非首屏一次下载**。
- 此层验证原版可执行依赖，不验证业务正确性、实体PWA系统状态栏或所有运行时分支。未接的API明确501并留在[接口需求清单](native-api-intake.json)，没有通用200空成功替代。

代表截图：[桌面动态](chromium-desktop-activity.png)、[桌面任务](chromium-desktop-tasks.png)、[桌面成员](chromium-desktop-members.png)、[手机外观](chromium-mobile-appearance.png)、[WebKit外观](webkit-mobile-appearance.png)。页面中的名称与账户均为fixture，不能用作用户产品入口。

## 发现的真实接线差异

[UI实现指纹](ui-runtime-fingerprints.json)：官网内嵌vendor已有0.52.1的PanelAction hit inset，却没有0.52.2 Badge的`anchor-scope`规则；完整npm0.52.2有这两项。没有证据断言官网vendor的精确完整包版本。后续须整包单运行时接线，不改几段vendor字符串或更换版本标签来冒充0.52.2。

原生Agent配置／频道成员共用Agent概念，而Loom必须保持Role配置与Instance身份分离。接口、资料路由、操作能力和已批准Loom专属功能需要显式适配；不能用官方store／server替代Kernel、AgentHost与SDK。生产入口仍为此前已部署版本，未重启／未改生产数据。

## 检查与余项

[16项定向回归](focused-checks.txt)通过：依赖发现、原件／图完整性、锁外候选／混版本拒绝、UI全树归档与历史计划／新目标区分。相应初始失败保留在`*-red.txt`中；另一次原生截图过早抓到loading的问题已通过页面专属ready标记修正，保留此事实，不把早期截图当作页面通过。

当前余项是**完整UI0.52.2单运行时接线 → 真实临时Core纵向业务适配 → 保留能力与桌面／移动页面验收 → 备份和平滑切换正式服务**。本批无产品入口／业务行为改动，因此不运行旧全站／后端／付费CLI大套验收，也不无意义重启正式服务。当前合同与具体次序见[完整基线方案](../../../design/full-official-frontend-baseline.zh-CN.md)。
