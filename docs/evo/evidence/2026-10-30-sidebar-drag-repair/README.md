# 空置顶与实际拖动：修复和验收

本批纠正上轮“侧栏已经对齐”的过度结论。不是用户需要继续逐条发现原生功能缺漏；此前的静态检查遗漏了空状态和真实交互。

## 已复现的根因

- 正式旧服务只读检查：空置顶没有提示，列表高度16px；完整官方Web1.21.40原样运行的空置顶为56px。漏掉的是36px提示块及4px下外边距，另有列表上下各8px。缺少40px直接造成下方分组提前出现。`formal-before.json`／`formal-before.png`和`native-empty.json`是独立证据。
- 原本地替身仅注册整个分组和简化行排序，没有官方独立放置区、实时跨容器投影、浮层、几何保留及重测。最近／字母排序还被误用为“来源整行禁拖”，而官方允许从这类来源移入有效的手动排序目标。
- 上轮验收只测有内容的静态间距，并没有验收空置顶、按住鼠标拖出、松手写入和取消，因此结论不能外推。

## 代码复用及边界

`generate-sidebar-drag140.mjs` 从本地完整、不可变的Web1.21.40归档提取，锁定实际 app-shell 模块和中文资源散列。原始归档不改动。生成文件包含：

| 官方声明                  | 当前用途                                       |
| ------------------------- | ---------------------------------------------- |
| `Oit`                     | 可拖行；原生监听器、拖中透明度与布局处理       |
| `R5`／`kit`／几何辅助函数 | 独立放置区、空区最小尺寸、拖动时保留高度和重测 |
| `z5`／`H5`                | 整组排序和标题激活柄                           |
| `Ya`／`Qa`                | 原样提取的碰撞检测与实时跨容器投影算法         |
| `Fit`                     | 原生持续测量策略                               |
| 原生空置顶及浮层表达式    | 相同的提示、颜色、尺寸、间距和浮层结构         |

生成器同时提取“已置顶”和空提示中文；函数体／表达式直接来自归档，重绑库导入和必要的数据参数，生成结果可重复校验。并复用官方UI包的鼠标／触控传感器，不再保留简化的本地行／分组排序实现。现有空分组可见性函数已包含原生拖动参数；本次补上调用端遗漏的拖动中显示／保留来源逻辑。

Loom适配层仍负责 Room／独立单聊身份到容器的映射，以及调用既有 ManagementClient→WriteIntent→Kernel 偏好写入。只维护一次手势的临时预览；确认结果直接回到原本的数据所有者，失败恢复、Esc不写入，未知结果仍由既有WriteIntent核实。延迟回包时预览不回弹，pending提示保留无障碍播报并不再挤动整列。没有新后端能力、持久队列、调度器或模型调用。

这证明本次聊天侧栏交互切片，**不证明完整官方Web业务适配已经完成**。旧侧栏报告增加纠正说明并保留失败历史。测试选择器改为官方的 section／drag-item 属性，行投放目标改为官方列表放置区；没有通过放松排序／持久化断言来迎合实现。

## 定向验收

先新增真实鼠标流程，旧实现分别因缺少空提示、最近排序来源无法激活拖动而失败。修复后，Chromium／Firefox／WebKit在临时真实Core、假运行时下验证：

- 空置顶展开／折叠、原生36px提示和56px放置区。
- 按住频道拖出，原生浮层和跨组预览，最近排序来源能移入手动置顶。
- 松手后一次写入，刷新保留；延迟回包期间不回弹、不新增状态行挤动列表。
- Esc取消不写入；真实协议拒绝恢复原位。
- 同组排序、空自定义分组投放、标题柄拖动整组，及其持久结果。
- 独立单聊在私聊分区与置顶间往返；右键菜单仍可用。
- 隐藏空分组时，拖动临时显示目标，取消后恢复隐藏。

源码生成完整性和受影响的侧栏纯逻辑／折叠测试、前端类型检查及工作台构建另行通过。没有运行全量后端或付费模型门禁。`populated-spacing.json`保留有内容情况下的回归量值；`native-empty.json`和三浏览器记录提供新增覆盖。

```sh
node --test scripts/official-web/sidebar-drag140.test.mjs scripts/official-web/sidebar139.test.mjs scripts/official-web/sidebar-state.test.ts scripts/official-web/sidebar-collapse.test.mjs
LOOM_BROWSER_SLICE=sidebar-drag node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=firefox LOOM_BROWSER_SLICE=sidebar-drag node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=webkit LOOM_BROWSER_SLICE=sidebar-drag node scripts/official-web/channel-browser.mjs
LOOM_NATIVE_SIDEBAR_EMPTY=1 LOOM_RELEASE_EVIDENCE=/tmp/native-empty node scripts/official-web/native-sidebar-spacing-browser.mjs
```

正式部署与只读验收以同目录收据为准；正式页面拖动仅执行Esc取消，禁止发送 sidebar.patch，保留真实偏好和频道数据。

## 已推送与部署结果

功能提交`736c8cf8`已推送`origin/main`，推送后重新构建、验证备份和初始化预演，并平滑重启原服务。`deployment.json`确认schema91、14个保护表及原网络／TLS／通知配置保持，原CA验证LAN及Tailnet入口成功。

部署后`formal-after.json`实测提示文字、36px提示块及56px放置区；`formal-after.png`展示恢复后的空置顶和下方频道位置。`formal-drag.png`为正式页面真实鼠标拖出浮层，随后Esc取消；保护表散列保持、sidebar.patch发送数0、页面异常0。对照`formal-before.json`，正式旧实现没有提示且放置区仅16px。19项定向测试及三个浏览器流程均通过；没有写正式测试数据或调用付费模型。
