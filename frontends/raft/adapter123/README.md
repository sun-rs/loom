# 完整 Web1.21.23 的 Loom 适配候选

正式产品目前仍使用上一稳定构建。此目录不是已完成替换的宣称，也不是另一套手绘页面。

- `../upstream/web-1.21.23`：GitHub `db5e399` 的完整 Web 与官方依赖 workspace；原始文件、LICENSE、包清单和 pnpm 锁均不修改。
- `entry.ts`：初始化真实 SDK 身份，再运行官方 `main.tsx`、App 和 MainLayout。
- `api.ts`、`read-bridge.ts`、`read-resources.ts`、`commands.ts`：只做原生 HTTP DTO 与 Loom SDK 之间的转换；未知路由明确拒绝，不能返回假成功。
- `sidebar.ts`：原生侧栏偏好的稀疏DTO转换；复用HumanSidebar版本及WriteIntentSlot。公共频道的置顶、分区增改删、排序和拖放已跑双边及真实Core验收；单聊关闭和tab换序仍只完成映射，不能外推为完整页面验收。
- `agent-facets.ts`：一个原生展示缓存的 Role/Instance 视图，分类来自稳定 ID 的真实目录。没有第二份业务状态。
- `runtime-*`、`avatars.ts`、`presence.ts`：已验证 Host 目录、头像资源兼容和工作状态投影。备注不是提示词，Role 不是有运行 lane 的 Agent。
- `policy.ts`：明确的能力省略点，当前省略不兼容 Agent tab 和 Raft 云账户配额。精确源位置改变即失败，不改官方尺寸、字体、类名或配色。
- `realtime-driver.ts`：可见页面通过 SDK 有界读恢复；只允许按 Room 同步，不模拟原版 Socket.IO 全局序号或业务 ACK。
- `fonts.ts`：原字体的本地传输，字体族、字重和字形不变。

从干净环境安装和构建：

```sh
npm run build:official-web:native123 -- --install --reference
npm run test:official-web:native123
npm run test:official-web:native123:pixel
npm run test:official-web:native123:interactions
LOOM_BROWSER_SLICE=native123 LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=native123-interactions LOOM_BROWSER_STATIC_DIRECTORY=frontends/raft/dist-native123 node scripts/official-web/channel-browser.mjs
```

安装使用官方 pnpm12.11.2 和原始 frozen lock。构建脚本创建被忽略的 `node_modules` 符号链接，确保适配层和原版使用同一依赖实例；不修改正在服务的 UI 依赖。参考版与候选产物分别位于官方目录的 `packages/web/dist` 和 `../dist-native123`；两者不能边构建边截图。

验证与迁移缺口见[本批记录](../../../docs/evo/evidence/2026-10-30-native123-intake/README.md)。未接通的原生界面操作不代表后端缺少相应能力；不为配合原界面重写 Loom 后端。

双边交互的夹具与真实Core证明分列在[交互记录](../../../docs/evo/evidence/2026-10-30-native123-interactions/README.md)。参考版仍是未修改的官方构建，只替换HTTP夹具；这些测试服务器随验收结束关闭，不是正式产品地址。
