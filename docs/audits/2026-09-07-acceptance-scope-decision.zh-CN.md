# 首版验收阶段与对齐判定

审查基线：Git `1dbb354`。本批仅调整范围与交付口径，没有改产品代码或运行新付费测试。

用户已将大文件流式、添加远程其他 Computer 与多 Human 一同延期为未来扩展；
详见[范围 owner](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)。
完整 PDF 工具栏也不再作为已证实的必做差距：授权 Raft 前端 `A7e` PDF 分支调用 `oz`
iframe，`xle` 获取 inline URL，没有自身分页/缩放控件，且 PDF 分支不传附件 comments。
直接 URL 和 native media preload 不证明远端支持 Range/206。来源为
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，hash 与来源沿用媒体审计。

## 当前可以与不能宣布的内容

- 核心配置/运行、Room 多 Agent、Task/Review 已有本地与指定真实 CLI 证据，
  见[四家模型审计](2026-09-07-real-cli-and-computer-closure.zh-CN.md)。
  后续 Computer 批量 reset 与媒体/PDF 的完成见 docs/README 顶部新审计，
  旧五项审计中的“真实 CLI 未跑”“媒体缺失”“批量 reset 缺失”不再是最新状态。
- 不能宣布与 npm 提取的 Computer 功能全面对等：复用账本不是所有适用行为逐行验收清单。
  本机服务重启/升级的产品入口、孤儿/已删除工作区清理仍待适用性与接线裁决；
  现有终端恢复指南不能冒充同等 Web 操作。不能把这些自动归入远程 Computer 延期。
- Settings 中 `apps/web/src/components/settings-pages.tsx` 明确显示消息翻译未接入，
  关闭以外模式不可选。其是否为首版适用项要有明确裁决，不能因页面存在而当作完成。
- 前端已做源码移植、共享组件和多批浏览器门禁，但没有全适用行为同 viewport/DPR/zoom、
  同数据前置的官网逐项对照证据。不能宣布全面视觉/交互对齐。
- 官网交互可验证 Server 的可观察效果，无法单独证明并发、幂等、崩溃恢复、权限与执行围栏。
  这些仍须由本地后端测试证明，不能从 UI 正常反推所有内部实现一致。

## 执行顺序

1. 冻结适用清单：已有登记逐行拆分本机适用、未来扩展、明确本地改造与待判定；
   不用历史缺失标签或回调计数计算完成率。
2. Agent/Computer：源码动作映射 → 页面真实结果 → 错误/恢复；发现一个适用缺口就修复并验收。
3. Room/消息/Search/Task/Review：逐旅程官网与本地对照，查持久数据和刷新结果。
4. 文件与 Settings：限定类型与保留功能的视觉、鼠标、键盘、失败/禁用状态对照。
5. 冻结发布候选：跨流程回归、长期运行/恢复与实体设备 PWA/通知；分别记录证据。

这是验收驱动的收口阶段，不是新的整轮重构，也不是“所有功能已齐、只需跑测试”的完成声明。
每个行为一事一闭；没有源码/可观察行为依据，不新增功能施工。
