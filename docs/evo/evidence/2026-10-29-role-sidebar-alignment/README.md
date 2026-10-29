# Role 侧栏缩进与运行时简称

根因是版本接线不完整：旧db5e399 Sidebar滚动容器仍带`px-2`，但当前采用的
Raft UI0.52的`list-cell`已在行内定义8px inset＋12px padding，分组标题也自带20px。
这不是需要另造一套小尺寸，而是去掉叠加的旧留白。共享ChatSidebarFrame只移除旧
水平padding，保留滚动/垂直间隔、手机导航留空；官方行、头像、字体、分组按钮及状态不改。
未改不可变源码或生成文件。

直接核对的来源：
- `upstream/raft-web-source/.../layout/Sidebar.tsx`旧容器组合与分组按钮；
- `raft-ui/dist/lib/list-cell.mjs`（8＋12）、`head-edges.mjs`；
- `raft-ui/dist/components/sidebar/sidebar-section.recipe.mjs`（20px）。

修前真实浏览器断言失败并记录：角色头像/“角色”标题28px，计算机分组16px。
修后1440×1000和390×844：角色头像/标题20px，计算机分组8px。
后者保留原分组按钮自己的8px，层级相对关系不变；不宣称整站最新Web视觉完全一致。

Role列表尾部由Host的cliId映射为Codex/Claude/Kimi/OpenCode/Agy/Pi。
旧Host缺cliId时仅兼容已知完整名称，不解析不透明offer ID，不模糊猜测第三方运行时。
完整运行时目录、执行配置、模型、effort和其他页面的名称不变。

验证限本次范围：先失败，再修复；12项定向测试、Loom类型、产品构建，以及上述两个
视口的真实临时Core浏览器测量通过。六种cliId映射及未知offer均有单测。
未运行付费CLI或全量后端测试，截图是模拟尺寸，不等于实体手机。
代码`92bf70c3`推送后已备份并平滑重启，schema91，账本/Role/实例/偏好校验保持，LAN与Tailnet原CA验证均200。正式Chrome新页面视觉核对通过，详情仍使用完整运行时名称；恢复侧栏状态并关闭验收标签。详见deployment.json及formal-page.json。
