# Loom 采用的官方 UI 分层规则

本规范适用于 evo。它约束如何采用官方代码，不定义另一套组件库、颜色或尺寸。

## 唯一来源与维护入口

- 负责人边界：根目录 AGENTS.md 的 Mandatory Raft UI layering。
- 可检查规则表：[ui-contract.json](../../frontends/raft/loom/ui-contract.json)。记录场景、来源、绑定位置、例外和检查入口。
- 官方页面版本由 frontends/raft/adoption.json 记录；基础组件包版本由实际 raft-ui 依赖与锁文件管理。升级其中之一都应检查对应集成，不假设两者版本一致。
- 字体、尺寸、颜色、边框、阴影与状态规则只维护在官方 recipe/token。这里不复制尺寸常量，不新增万能 LoomButton。

## 每次新增或修改控件的顺序

1. 确认语义：详情关闭、对话框关闭、筛选、表单、消息操作、导航、危险确认等，不能仅按图标形状分类。
2. 读取相应官方页面、外层容器、场景组件、recipe及参数；检查 normal/loading/empty/error/disabled 的组合。
3. 使用规则表已有场景。页面负责 Loom 数据与权限接线，不重新设计基础规格。Loom专属功能先映射现有场景。
4. 没有可用场景时，才增加薄组合并登记来源及原因；偏离保留的官方规则须遵循AGENTS中的owner批准要求。未指定size/variant会采用有定义的官方默认值，不自动算偏离。
5. 如有刻意差异，将其登记为例外，注明适用范围、理由、负责人依据、实现及检查。不允许例外悄悄扩散。
6. 对受影响的规则运行定向检查；需要视觉／交互确认时，检查实际渲染及真实pointer目标，不仅检查class字符串。

## 当前已固化的边界

- 本地详情关闭使用官方CloseButton，涵盖正常、加载、错误分支；明确标记data-loom-control=detail-close。
- 弹窗与抽屉使用DialogClose／DrawerClose，保留原有焦点及关闭阻挡；手机任务返回箭头是登记的独立语义例外。
- 移动紧凑适配识别上述语义标记、panel-back或官方panel-action slot，不从SVG/span层级推断类型。视觉大小与点击区域分开核实，避免侵占相邻控件。
- 筛选与表单分属不同组件族；任务／记忆紧凑筛选的适配不是全局重设所有筛选器。
- 原生树节点、disclosure和消息工具栏不强制改成通用Button。ghost也不能全局替换outline。

## 自动检查与证据

运行 npm run test:official-web:ui-contract。测试还被既有test:official-web:source通配入口包含，无需另外开启第二套总门禁。

0.6 已由负责人授权采用单一 Raft 外观。资源锁定在 `frontends/raft/rui-resources.lock.json`；原始页面哈希不变，移植哈希独立登记在 `rui-v6-ports.json`。外观只保留浅色／深色／系统，旧设备明暗偏好迁移，主题家族不再渲染。官方控件本身拥有点击扩展区域；旧移动关闭伪元素补丁已撤除。

目前检查：注册来源／绑定路径有效性；详情关闭组件来源；本地CloseButton语义标记；已知静态中文关闭标签不得绕过场景owner（有记录的返回例外除外）；移动CSS不再使用失效的SVG/span猜测。动态标签、完整上游子树和全部场景视觉仍须相应定向检查，不声称静态检查覆盖全部UI。

记忆窄浏览器检查验证手机外围点击确实能关闭详情，Side及消息列检查验证对应关闭分支、未决操作与返回行为。测试只覆盖实际改动相关场景，不因小修改启动全盘后端或付费模型验收。

审计盘点可运行 node scripts/official-web/button-inventory.mjs；输出的调用数量不是一致性百分比。历史审查报告是某版本证据，当前规则表与源码才是后续维护入口。

## 已应用的动作参数绑定

`frontends/raft/loom/ui-action-props.ts` 仅组合官方 Button 的 size/variant，并提供可检查的场景标记；不包装组件，不定义 CSS、颜色或尺寸。来源和采用语义登记在规则表的 `actionBindings`：完整表单保存／取消、紧凑提交、删除／变更确认、读取恢复、次级动作和纯图标入口。各页面仍拥有原有回调、权限、pending 和未知结果处理。

本地角色／实例管理、频道操作、记忆／权限表单、收藏、消息列／Side、用量及文件选择中的相应动作采用这些绑定。官方消息工具栏、Composer、PickerTriggerButton、Sidebar、文件树、面板关闭和 Dialog/Drawer 继续使用各自场景 owner，不改成统一按钮。0.6 统一使用原生 32px 常规／图标控件（旧 xs/sm 为兼容别名），不继续维护 24px／28px 的旧版尺寸。

新增场景绑定必须登记上游来源。检查会拒绝绑定上的 size/variant/style 二次覆盖，也检查全部本地 TSX 的语法；动态业务动作仍须定向浏览器验证。此批应用是本地动作参数收敛，不宣称所有主题、全部上游子树已经逐像素验收。
