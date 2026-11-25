# CLEAN-0 清理结果

收件箱和 relay 改用三个原生适配器的逐行解析。会话级历史解析继续由各适配器现有的解析器处理。移入适配器的代码只提取当前调用者使用的用户消息、助手正文和 Claude 工具调用边界，保留来源注释。对迁移前后的实现使用 460 个合成样例逐项比较，调用者使用的字段及顺序一致。

## 删除与迁移

| 路径 | 处理 |
| --- | --- |
| `drivers/codex-appserver/` | 删除独立客户端、生成类型、夹具和 3 项测试。统一无头入口由 OAR 承接。 |
| `drivers/tui-hooks/codex/`、`drivers/tui-hooks/agy/`、`drivers/claude-tui/` | 删除实验驱动及夹具，分别退役 5、4、8 项驱动测试。生产导入已全部切到 `adapters/`。 |
| `relay/relay.mjs`、`relay/README.md` | 删除独立轮询入口及其启动说明。项目锁、波次处理和来源模块继续由 loomd 和收件箱使用。 |
| `relay/hooks.mjs` | 删除旧的 Codex、agy、Claude hook 注入和捕获脚本，以及 `relay/relay.test.mjs` 中仅运行该脚本的两项测试。现行的适配器 hook 测试继续保留。 |
| `runtimes/oar/node_modules/`、`package.json`、`package-lock.json`、`.gitignore`（后面三个均在 `runtimes/oar/` 内） | 删除子安装、子清单、子锁和重复忽略规则。OAR 从根目录的 `@botiverse/oar@0.130.1` 加载。 |
| `skills/project-hc/`、`skills/project-hc-relay/`、`skills/project-orca/` | 删除三个实验 skill 目录。 |
| `skills/project-loom/` | 移至 `skills/loom/`，把 frontmatter 名称和正文中的 `project-loom` 同步换成 `loom`。只处理仓库内文件。 |

## 保留与边界

从 `bin/loom`、`bin/loomd` 和根测试入口追踪静态导入、动态导入及脚本启动路径，再查找目录测试入口、说明和夹具引用。

- `lib/token-budget.mjs` 由证据卡、交接简报和测试导入。`runtimes/oar/{index,events}.mjs` 仍由 OAR 回归测试导入。
- `adapters/{agy,claude,codex}/index.js` 支持各适配器文档中的 `node --test <目录>`。`adapters/codex/package.json` 暴露适配器入口。`runtimes/claude-tui/package.json` 声明独立的 runtime 入口及测试命令，两份清单均无重复依赖。
- `schema/{index,protocol}.ts` 供 TypeScript 调用者使用。`handover/loom` 和 `watch/cli.mjs` 是各目录文档列出的独立入口，位于本卡写入范围外。
- `runtimes/oar/entry.mjs` 是原子包主入口，移除子清单后未在 CLI 或根测试中找到调用。它和仍载有旧安装命令的 `runtimes/oar/README.md` 均在本卡可写依赖文件范围外。根 README 已给出可用的根安装及定向测试命令。
- 保留测试仍使用的适配器和 runtime 夹具，以及 `tasks/`、`docs/` 中的历史记录。部分历史说明及适配器来源注释仍提及原路径。

## 代码行数

统计 JS、TS、shell 源码和无扩展名的命令入口的物理行，含空行、注释和生成的 TS。排除测试源码、夹具、依赖、清单和文档。清理前快照为 **20,515 行**，其中旧驱动为 10,340 行，含 8,909 行生成类型。本卡删除 10,434 行并迁入 65 行，扣除并行变更后的清理结果为 **10,146 行**，净减 **10,369 行**。

验收时共享工作区含并行变更，共 **10,628 行**。

## 验收

- 根目录 `npm test` 从清理前 **170/170** 项通过变为清理后 **148/148** 项通过，失败、跳过、取消均为零。减少 22 项，分别为旧驱动的 20 项和旧 relay hook 脚本的两项。
- `node bin/loom --help`、`node bin/loomd --help` 和 `node bin/loom send --help` 均正常退出。OAR 定向测试 3/3 通过，`npm ls --depth=0` 和模块解析均确认使用根依赖 `@botiverse/oar@0.130.1`。
- 并行卡修改屏幕分类、Claude 会话控制、daemon 和波次逻辑时，全量测试曾出现失败。相关修改落地后，根测试复跑全绿。收件箱和 relay 来源模块的改动限于替换导入，relay 测试文件只删除旧 hook 专属用例及相关导入。

STATUS: done
