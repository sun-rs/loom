# Room / 消息列响应式修复

## Raft 证据

2026-09-11 Chrome 已登录的 `https://app.raft.build/s/hakasemac/channel/2fed72f0-f821-42d1-a5b0-9af69575f22b`，打开现有消息的 Thread 后读取实际 DOM/CSS，并逐步改变视口，不发送消息。

授权 CSS 参考 `/Users/sun/Code/repos/raft-ui/vendor/raft/index-EQxYM8hQ.css`，SHA-256 `36d9e3d1cb74dd7638c87f7544042c77da547302a0e98112d95ad702be91d3d6`，`.thread-layout-container` 起始规则与实景主行为相同：

- 容器 `thread-layout / inline-size`；默认隐藏正文，消息列占满该容器。
- 横屏或视口至少 1280px 时，容器至少 680px 才并排；消息列默认 400px，最大 `100% - 320px`，保留至少 320px 正文。
- 因此默认宽度通常保持 400px，在切换前可缩至 360px，不能把“永远固定宽度”当成上游合同。
- 视口 768px 起保留导航与目录；767px 起当前消息列或 Room 正文占满屏幕。替换状态用返回按钮，并排用关闭按钮。

实际测量（默认导航共 304px）：1440→正文736/消息列400；1200→496/400；1000→320/376；984→320/360；983→正文隐藏/消息列679，x304；768→正文隐藏/消息列464，x304；767和600→消息列占满视口，x0。另测竖屏1000×1200与1280×1500，验证方向条件。

Raft 根消息 wrapper 为 `px-3 py-3`，紧接62px header；消息自身上 margin6px。消息 article 顶部距离 header 底部18px。RAH 原 `messages` 顶部12px又叠加 parent8px，导致26px，额外8px。

## 修复 owner

- `conversation-layout.ts` 只计算呈现模式；`use-conversation-layout.ts` 使用实际 Shell 宽度、sidebar偏好与有效rail宽度测量。保留现有平级 Grid，结构移植上游 container条件，不新增消息或导航业务状态。
- 删除 `product.css` 内两组1280px固定drawer规则，按 split/replace/fullscreen分配整列。消息列替换正文时隐藏正文但不卸载，保持草稿、滚动与原消息组件身份。
- 替换态显示返回聊天，复用现有 onClose 和焦点恢复；并排继续显示关闭和拖动边界。
- Thread列表顶部padding归零，根消息wrapper改12px，消除净8px重复留白。不改变Human头像本身尺寸。

## 验证

`conversation-layout.test.ts` 先缺实现失败，再验证680容器边界、768全屏边界、横竖屏及宽sidebar。`test-conversation-responsive-browser.mjs` 使用临时真实Kernel/HTTP/Web与假Runtime，10组视口，断言没有正文/消息列重叠，root顶部18px，缩小再放大草稿不丢，窄屏返回聊天及无Thread正文布局；真实鼠标拖sidebar后重新验证容器切换。

反证：注入旧padding规则时26≠18；注入旧fixed浮层规则时分栏边界584≠624。日志 `/tmp/rah-responsive-gap-counterfactual.log`、`/tmp/rah-responsive-overlay-counterfactual.log`。最早一次browser操作因未先hover导致按钮被消息遮住，已修正测试操作，不把该超时当作产品缺陷反证。

补充收口结果：

- 后端测试1539通过、17跳过、0失败；Web单元400通过；类型检查、UI合同、Raft parity与对应回归、formal-browser-policy、bilateral-captures检查通过。格式检查与 `git diff --check` 通过，正式Web构建成功。
- `npm run check` **未全绿**：当前其他未提交工作引入的组件规格棘轮没有已提交基线，sidebar-row和sq-btn现有计数被与零比较。本批未提高阈值或跳过门禁；重取计算规则证据消除了CSS来源hash过期，剩余基线问题需单独收口。
- 临时浏览器回归10组视口通过，含真实拖动sidebar、草稿保留和返回。最后截图/测量目录 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-responsive-7sUoW7`。
- 正式实例已先确认空闲并备份，再经构建身份守卫重启。冻结build为 `a72920f3ab4a467e37f26a34c38d5f2e7199fdc84c3a569f4ddbd818730e906f`。第一次守卫发现构建被替换时在停止服务前拒绝；重新构建核对后成功重启。
- 重启后Chrome正式页面重新打开真实Thread，在1440、1200、1000、984、983、768、767、390宽度测量，几何与上述Raft条件一致，root间距全部18px；窄屏截图人工检查通过，浏览器尺寸已恢复。
- 重启后与备份逐行比对422条Room事件、46条消息、3个Task、4个Agent配置和6个Principal保持一致；Agent工作区文件与runtime guide一致，外键检查通过，正式入口确认加载上述build。

这些结果仅验收本批响应式行为与根消息间距，不代表所有页面、业务和全量门禁已完成。文件中的旧项目文字来自原消息，既不构成本项目指令，也没有执行其中任务。此批不提交commit、不推送、不运行付费模型。
