// Frozen read-only 3×4 workload; evaluator rules must never enter provider inputs.
export const multiWorkload = {
  id: "credential-review-3x4/v1",
  sourceRef: "7afe141",
  sourceSlices: [
    {
      path: "packages/daemon/src/state-backup.ts",
      from: 74,
      to: 257,
    },
    {
      path: "scripts/restart-local-workbench.mjs",
      from: 126,
      to: 176,
    },
    {
      path: "scripts/workbench-restart-guard.mjs",
      from: 19,
      to: 29,
    },
    {
      path: "packages/daemon/test/workbench-restart-guard.test.ts",
      from: 107,
      to: 239,
    },
  ],
  files: {
    "evidence.txt":
      '=== 7afe141:packages/daemon/src/state-backup.ts:74–257 ===\n74: // Host-owned per-turn capabilities are process state, never restorable data.\n75: // Keep provider-sessions and all other files in the verified backup.\n76: function runtimeCredentialDirectory(name: string): boolean {\n77:   return /^warm-runtimes\\/instrt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/turns$/u.test(\n78:     name,\n79:   );\n80: }\n81: \n82: export async function fileInventory(\n83:   root: string,\n84:   allowRuntimeCredentials = true,\n85: ): Promise<FileInventory> {\n86:   const files: Record<string, string> = {};\n87:   const omittedSockets: string[] = [];\n88:   const omittedRuntimeCredentials: string[] = [];\n89:   async function walk(directory: string, prefix = ""): Promise<void> {\n90:     for (const entry of (await readdir(directory)).sort()) {\n91:       const name = prefix + entry,\n92:         path = join(directory, entry);\n93:       const stat = await lstat(path);\n94:       assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);\n95:       if (runtimeCredentialDirectory(name)) {\n96:         assert.ok(\n97:           stat.isDirectory() && allowRuntimeCredentials,\n98:           "Runtime credentials must not be restored from backup",\n99:         );\n100:         omittedRuntimeCredentials.push(name);\n101:         continue;\n102:       }\n103:       if (stat.isDirectory()) await walk(path, `${name}/`);\n104:       else if (stat.isSocket()) omittedSockets.push(name);\n105:       else {\n106:         assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);\n107:         if (!/\\.db(?:-wal|-shm|-journal)?$/.test(name))\n108:           files[name] = await hashFile(path);\n109:       }\n110:     }\n111:   }\n112:   await walk(root);\n113:   return {\n114:     files,\n115:     omittedSockets,\n116:     ...(omittedRuntimeCredentials.length ? { omittedRuntimeCredentials } : {}),\n117:   };\n118: }\n119: \n120: async function databaseInventory(root: string): Promise<string[]> {\n121:   const databases: string[] = [];\n122:   async function walk(directory: string, prefix = ""): Promise<void> {\n123:     for (const entry of (await readdir(directory)).sort()) {\n124:       const name = prefix + entry,\n125:         path = join(directory, entry);\n126:       const stat = await lstat(path);\n127:       assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);\n128:       if (runtimeCredentialDirectory(name) && stat.isDirectory()) continue;\n129:       if (stat.isDirectory()) await walk(path, `${name}/`);\n130:       else if (stat.isSocket() || /\\.db-(?:wal|shm|journal)$/.test(name)) {\n131:         // Same exclusions as backupState/fileInventory.\n132:       } else if (name.endsWith(".db")) {\n133:         assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);\n134:         databases.push(name);\n135:       }\n136:     }\n137:   }\n138:   await walk(root);\n139:   return databases.sort();\n140: }\n141: \n142: export async function backupState(\n143:   state: string,\n144:   target: string,\n145: ): Promise<BackupReceipt> {\n146:   const nested = relative(resolve(state), resolve(target));\n147:   assert.ok(\n148:     nested.startsWith("..") && nested !== "..",\n149:     "Backup must be outside state",\n150:   );\n151:   assert.ok((await lstat(state)).isDirectory());\n152:   assert.ok(\n153:     !(await lstat(state)).isSymbolicLink(),\n154:     "State root symlink refused",\n155:   );\n156:   await mkdir(target, { mode: 0o700 }); // Exclusive: never reuse/overwrite a backup.\n157:   const before = await fileInventory(state);\n158:   const receipt: BackupReceipt = {\n159:     databaseHashes: {},\n160:     databases: [],\n161:     ...before,\n162:   };\n163:   async function walk(directory: string, prefix = ""): Promise<void> {\n164:     for (const entry of (await readdir(directory)).sort()) {\n165:       const name = prefix + entry,\n166:         source = join(directory, entry),\n167:         dest = join(target, name);\n168:       const stat = await lstat(source);\n169:       assert.ok(!stat.isSymbolicLink(), `State symlink refused: ${name}`);\n170:       if (runtimeCredentialDirectory(name) && stat.isDirectory()) continue;\n171:       if (stat.isDirectory()) {\n172:         await mkdir(dest, { mode: 0o700 });\n173:         await walk(source, `${name}/`);\n174:         await sync(dest);\n175:       } else if (stat.isSocket() || /\\.db-(?:wal|shm|journal)$/.test(name)) {\n176:         // Process endpoints and online SQLite sidecars are never restored.\n177:       } else if (name.endsWith(".db")) {\n178:         const db = new DatabaseSync(source, { readOnly: true });\n179:         try {\n180:           await backup(db, dest);\n181:         } finally {\n182:           db.close();\n183:         }\n184:         await chmod(dest, 0o600);\n185:         verifyDatabase(dest);\n186:         receipt.databases.push(name);\n187:         await sync(dest);\n188:         receipt.databaseHashes[name] = await hashFile(dest);\n189:       } else {\n190:         assert.ok(stat.isFile(), `Unsupported state entry: ${name}`);\n191:         await copyFile(source, dest, 1 /* COPYFILE_EXCL */);\n192:         await chmod(dest, 0o600 | (stat.mode & 0o100));\n193:         await sync(dest);\n194:       }\n195:     }\n196:   }\n197:   await walk(state);\n198:   assert.deepEqual(\n199:     await fileInventory(state),\n200:     before,\n201:     "State files changed during backup",\n202:   );\n203:   await verifyStateBackup(target, receipt);\n204:   await sync(target);\n205:   return receipt;\n206: }\n207: \n208: function verifyDatabase(path: string): void {\n209:   // A WAL-mode backup may need its own sidecars on first open. Verify writable\n210:   // in the private backup directory, never immutable/read-only against live WAL.\n211:   const db = new DatabaseSync(path);\n212:   try {\n213:     assert.deepEqual(\n214:       db\n215:         .prepare("PRAGMA quick_check")\n216:         .all()\n217:         .map((r) => Object.values(r)[0]),\n218:       ["ok"],\n219:     );\n220:     assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);\n221:     db.exec("PRAGMA journal_mode=DELETE;");\n222:   } finally {\n223:     db.close();\n224:   }\n225: }\n226: \n227: export async function verifyStateBackup(\n228:   target: string,\n229:   receipt: BackupReceipt,\n230: ): Promise<true> {\n231:   const databases = await databaseInventory(target);\n232:   assert.deepEqual(\n233:     databases,\n234:     [...receipt.databases].sort(),\n235:     "Backup database set mismatch",\n236:   );\n237:   assert.deepEqual(\n238:     Object.keys(receipt.databaseHashes ?? {}).sort(),\n239:     databases,\n240:     "Backup database digest set mismatch",\n241:   );\n242:   for (const name of databases) {\n243:     const path = join(target, name);\n244:     verifyDatabase(path);\n245:     assert.equal(\n246:       await hashFile(path),\n247:       receipt.databaseHashes[name],\n248:       `Backup database digest mismatch: ${name}`,\n249:     );\n250:   }\n251:   assert.deepEqual(\n252:     (await fileInventory(target, false)).files,\n253:     receipt.files,\n254:     "Backup file digest mismatch",\n255:   );\n256:   return true;\n257: }\n\n=== 7afe141:scripts/restart-local-workbench.mjs:126–176 ===\n126: await guardedStop({\n127:   async validate() {\n128:     staticDirectory = await snapshotWorkbenchAssets(repo);\n129:     const metadata = JSON.parse(\n130:       await readFile(join(staticDirectory, ".rah-web-build.json"), "utf8"),\n131:     );\n132:     assert.equal(\n133:       metadata.webBuildId,\n134:       values.build,\n135:       "Unexpected candidate build",\n136:     );\n137:     return true;\n138:   },\n139:   async inspect() {\n140:     baseline = inspect();\n141:     return true;\n142:   },\n143:   async backup() {\n144:     receipt = await backupState(state, target);\n145:     return true;\n146:   },\n147:   async verify() {\n148:     await verifyStateBackup(target, receipt);\n149:     await preflightKernelUpgrade(join(target, "room.db"));\n150:     return true;\n151:   },\n152:   async recheck() {\n153:     assert.deepEqual(await fileInventory(state), {\n154:       files: receipt.files,\n155:       omittedSockets: receipt.omittedSockets,\n156:     });\n157:     assert.deepEqual(\n158:       inspect(),\n159:       baseline,\n160:       "Canonical events changed during backup; retry when idle",\n161:     );\n162:     // Keep a private receipt outside the backed-up state tree.\n163:     await writeFile(\n164:       `${target}.receipt.json`,\n165:       JSON.stringify(\n166:         { schemaVersion: 1, pid, initial, state, build: values.build, receipt },\n167:         null,\n168:         2,\n169:       ),\n170:       { flag: "wx", mode: 0o600 },\n171:     );\n172:     return true;\n173:   },\n174:   async stop() {\n175:     assert.deepEqual(inspect(), baseline);\n176:     process.kill(pid, "SIGTERM");\n\n=== 7afe141:scripts/workbench-restart-guard.mjs:19–29 ===\n19: export async function guardedStop(steps) {\n20:   for (const name of [\n21:     "validate",\n22:     "inspect",\n23:     "backup",\n24:     "verify",\n25:     "recheck",\n26:     "stop",\n27:   ])\n28:     assert.equal(await steps[name](), true, `Restart blocked at ${name}`);\n29: }\n\n=== 7afe141:packages/daemon/test/workbench-restart-guard.test.ts:107–239 ===\n107: test("every failed pre-stop step blocks stop, including an explicit false receipt", async () => {\n108:   for (const failed of stages.slice(0, -1)) {\n109:     for (const failure of ["throw", "false"]) {\n110:       const calls: string[] = [];\n111:       const steps = Object.fromEntries(\n112:         stages.map((name) => [\n113:           name,\n114:           async () => {\n115:             calls.push(name);\n116:             if (name === failed) {\n117:               if (failure === "throw") throw new Error(name);\n118:               return false;\n119:             }\n120:             return true;\n121:           },\n122:         ]),\n123:       );\n124:       await assert.rejects(guardedStop(steps));\n125:       assert.deepEqual(calls, stages.slice(0, stages.indexOf(failed) + 1));\n126:       assert.equal(calls.includes("stop"), false);\n127:     }\n128:   }\n129: });\n130: \n131: test("stop is awaited exactly once after all positive receipts; stop failure propagates", async () => {\n132:   const calls: string[] = [];\n133:   const steps = Object.fromEntries(\n134:     stages.map((name) => [\n135:       name,\n136:       async () => {\n137:         calls.push(name);\n138:         return true;\n139:       },\n140:     ]),\n141:   );\n142:   await guardedStop(steps);\n143:   assert.deepEqual(calls, stages);\n144:   await assert.rejects(\n145:     guardedStop({\n146:       ...steps,\n147:       stop: async () => {\n148:         throw new Error("stop timeout");\n149:       },\n150:     }),\n151:     /stop timeout/,\n152:   );\n153: });\n154: \n155: test("online WAL backup contains committed data, nested memory, private files and no stale WAL", async () => {\n156:   const root = await mkdtemp(join(tmpdir(), "rah-restart-backup-test-"));\n157:   const state = join(root, "state"),\n158:     target = join(root, "backup");\n159:   await mkdir(state, { mode: 0o700 });\n160:   const db = new DatabaseSync(join(state, "room.db"));\n161:   try {\n162:     db.exec(\n163:       "PRAGMA journal_mode=WAL; CREATE TABLE sample (v TEXT); INSERT INTO sample VALUES (\'committed\');",\n164:     );\n165:     await mkdir(join(state, "memory"));\n166:     await writeFile(join(state, "memory/MEMORY.md"), "index", { mode: 0o600 });\n167:     await writeFile(join(state, "human.token"), "private-fixture-token", {\n168:       mode: 0o600,\n169:     });\n170:     const receipt = await backupState(state, target);\n171:     assert.equal(receipt.databases.length, 1);\n172:     const copy = new DatabaseSync(join(target, "room.db"));\n173:     assert.equal(copy.prepare("SELECT v FROM sample").get()?.v, "committed");\n174:     copy.close();\n175:     assert.equal(\n176:       await readFile(join(target, "memory/MEMORY.md"), "utf8"),\n177:       "index",\n178:     );\n179:     await assert.rejects(readFile(join(target, "room.db-wal")), /ENOENT/);\n180:     await assert.rejects(backupState(state, target), /EEXIST/);\n181:   } finally {\n182:     db.close();\n183:   }\n184: });\n185: \n186: test("backup refuses symlinks rather than silently following outside state", async () => {\n187:   const root = await mkdtemp(join(tmpdir(), "rah-restart-symlink-test-"));\n188:   const state = join(root, "state");\n189:   await mkdir(state);\n190:   await symlink(root, join(state, "escape"));\n191:   await assert.rejects(backupState(state, join(root, "backup")), /symlink/);\n192: });\n193: \n194: test("corrupt database and post-backup file damage cannot produce a verified receipt", async () => {\n195:   const root = await mkdtemp(join(tmpdir(), "rah-restart-damage-test-"));\n196:   const state = join(root, "state");\n197:   await mkdir(state);\n198:   await writeFile(join(state, "memory.md"), "private index");\n199:   const target = join(root, "backup");\n200:   const receipt = await backupState(state, target);\n201:   await writeFile(join(target, "memory.md"), "damaged");\n202:   await assert.rejects(verifyStateBackup(target, receipt), /digest mismatch/);\n203:   await writeFile(join(state, "corrupt.db"), "not SQLite");\n204:   await assert.rejects(backupState(state, join(root, "backup2")));\n205:   await assert.rejects(\n206:     backupState(state, join(state, "nested")),\n207:     /outside state/,\n208:   );\n209: });\n210: \n211: test("a valid SQLite rewrite or changed database set invalidates the backup receipt", async () => {\n212:   const root = await mkdtemp(join(tmpdir(), "rah-restart-db-digest-test-"));\n213:   const state = join(root, "state"),\n214:     target = join(root, "backup");\n215:   await mkdir(state);\n216:   const source = new DatabaseSync(join(state, "room.db"));\n217:   source.exec(\n218:     "CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES (\'original\')",\n219:   );\n220:   source.close();\n221: \n222:   const receipt = await backupState(state, target);\n223:   const databaseHashes = receipt.databaseHashes;\n224:   assert.match(databaseHashes["room.db"] ?? "", /^[a-f0-9]{64}$/);\n225:   const copy = new DatabaseSync(join(target, "room.db"));\n226:   copy.prepare("UPDATE sample SET value=\'different\' WHERE id=1").run();\n227:   copy.close();\n228:   await assert.rejects(verifyStateBackup(target, receipt), /digest mismatch/);\n229: \n230:   const cleanTarget = join(root, "clean-backup");\n231:   const cleanReceipt = await backupState(state, cleanTarget);\n232:   const extra = new DatabaseSync(join(cleanTarget, "extra.db"));\n233:   extra.exec("CREATE TABLE unexpected (value TEXT)");\n234:   extra.close();\n235:   await assert.rejects(\n236:     verifyStateBackup(cleanTarget, cleanReceipt),\n237:     /database set mismatch/,\n238:   );\n239: });\n',
  },
  fileHashes: {
    "evidence.txt":
      "6ae369899978d878a1b11182a9675fbff7aef2a6955ce747d524011c7bca6204",
  },
  instructions:
    "这是三个审查者各四轮的固定次序只读工程审查。你在四轮中保持同一原生session，不更换会话。唯一可读文件是当前工作区evidence.txt，包含固定快照的源码及测试片段，标注原路径和行号；每个实例仅在自己的第一轮读取该文件一次，须读取完整正文，此后不再读取文件或调用业务工具。回复交付仅按运行环境指定的方式进行；交付入口不授权读取更多资料或执行其他业务操作。只根据该文件和已交付的真实对话审查；未提供的依赖保持未知。不得读取其他文件或真实服务状态，不得运行/导入脚本、测试、写文件、操作服务、使用记忆或Task。每轮仅一次最终回答，以“审查结论：”开头，正文不超过800个Unicode Han汉字，不设最低字数；JSON传输外壳不计。不用工具计算字数。不得@任何人，后续发言由Human固定编排。引用原文件和行号，区分现代码、已有测试、建议与未知；不声称执行了未执行的验证。根据实际前文互审，不迎合或制造分歧，不编造自我撤回；只有真实错误才纠正。必要证据已不在上下文时明确无法核实，不越界重读。",
  steps: [
    {
      speaker: "a",
      round: 1,
      body: "第1轮：独立核实。只读一次evidence.txt全文。审查运行期turn凭据目录的备份排除规则及重启前状态复查：对一个合法且稳定存在的目录、其他状态不变的情况，按实际对象和调用顺序判断能否到达stop。给出最短源码依据及尚未提供的依赖边界；不要先假定有或没有缺陷。",
    },
    {
      speaker: "b",
      round: 1,
      body: "第1轮：独立核实。只读一次evidence.txt全文。审查运行期turn凭据目录的备份排除规则及重启前状态复查：对一个合法且稳定存在的目录、其他状态不变的情况，按实际对象和调用顺序判断能否到达stop。给出最短源码依据及尚未提供的依赖边界；不要先假定有或没有缺陷。",
    },
    {
      speaker: "c",
      round: 1,
      body: "第1轮：独立核实。只读一次evidence.txt全文。审查运行期turn凭据目录的备份排除规则及重启前状态复查：对一个合法且稳定存在的目录、其他状态不变的情况，按实际对象和调用顺序判断能否到达stop。给出最短源码依据及尚未提供的依赖边界；不要先假定有或没有缺陷。",
    },
    {
      speaker: "a",
      round: 2,
      body: "第2轮：互审与最小修复。不再读取文件或调用业务工具。核对已经收到的其他审查者实际结论，明确同意或不同意的具体事实及依据；若没有可核对的同伴结论，直接说明。给出你认为必要的最小修复或无须修复的理由，说明如何保留文件、socket、运行期凭据排除目录集合的检查和凭据内容不备份/不恢复。不要为了达成共识而忽略证据。",
    },
    {
      speaker: "b",
      round: 2,
      body: "第2轮：互审与最小修复。不再读取文件或调用业务工具。核对已经收到的其他审查者实际结论，明确同意或不同意的具体事实及依据；若没有可核对的同伴结论，直接说明。给出你认为必要的最小修复或无须修复的理由，说明如何保留文件、socket、运行期凭据排除目录集合的检查和凭据内容不备份/不恢复。不要为了达成共识而忽略证据。",
    },
    {
      speaker: "c",
      round: 2,
      body: "第2轮：互审与最小修复。不再读取文件或调用业务工具。核对已经收到的其他审查者实际结论，明确同意或不同意的具体事实及依据；若没有可核对的同伴结论，直接说明。给出你认为必要的最小修复或无须修复的理由，说明如何保留文件、socket、运行期凭据排除目录集合的检查和凭据内容不备份/不恢复。不要为了达成共识而忽略证据。",
    },
    {
      speaker: "a",
      round: 3,
      body: "第3轮：有效红绿测试规格。不再读取文件或调用业务工具。为稳定合法目录允许到达stop、备份后目录集合改变仍阻止stop分别写最小fixture、真实被测比较、观察点和现代码红/绿判断；明确修复后的期望，不能把被测比较直接mock为成功。保持凭据内容排除；再给一项证明备份自身有效并不代表live状态未变化的隔离测试规格。只写规格，不执行；缺少依赖就说明限制。",
    },
    {
      speaker: "b",
      round: 3,
      body: "第3轮：有效红绿测试规格。不再读取文件或调用业务工具。为稳定合法目录允许到达stop、备份后目录集合改变仍阻止stop分别写最小fixture、真实被测比较、观察点和现代码红/绿判断；明确修复后的期望，不能把被测比较直接mock为成功。保持凭据内容排除；再给一项证明备份自身有效并不代表live状态未变化的隔离测试规格。只写规格，不执行；缺少依赖就说明限制。",
    },
    {
      speaker: "c",
      round: 3,
      body: "第3轮：有效红绿测试规格。不再读取文件或调用业务工具。为稳定合法目录允许到达stop、备份后目录集合改变仍阻止stop分别写最小fixture、真实被测比较、观察点和现代码红/绿判断；明确修复后的期望，不能把被测比较直接mock为成功。保持凭据内容排除；再给一项证明备份自身有效并不代表live状态未变化的隔离测试规格。只写规格，不执行；缺少依赖就说明限制。",
    },
    {
      speaker: "a",
      round: 4,
      body: "第4轮：各自交接结论。不再读取文件或调用业务工具。结合实际收到的前文，独立给出最终诊断、最小修改及验收顺序，列出仍未解决的分歧或未知。准确指出你修正了哪个实际先前断言，若无则无需制造撤回。不能把他人的发言、静默、测试规格或静态阅读当作执行通过或全员同意。",
    },
    {
      speaker: "b",
      round: 4,
      body: "第4轮：各自交接结论。不再读取文件或调用业务工具。结合实际收到的前文，独立给出最终诊断、最小修改及验收顺序，列出仍未解决的分歧或未知。准确指出你修正了哪个实际先前断言，若无则无需制造撤回。不能把他人的发言、静默、测试规格或静态阅读当作执行通过或全员同意。",
    },
    {
      speaker: "c",
      round: 4,
      body: "第4轮：各自交接结论。不再读取文件或调用业务工具。结合实际收到的前文，独立给出最终诊断、最小修改及验收顺序，列出仍未解决的分歧或未知。准确指出你修正了哪个实际先前断言，若无则无需制造撤回。不能把他人的发言、静默、测试规格或静态阅读当作执行通过或全员同意。",
    },
  ],
  promptSetHash:
    "192dfb2135085d914ccf425a720a721741848da172bcb6a30859a8b50539c36f",
  identityHash:
    "4ae87620e3143a1ca2895d71863014d8c58426f59ea1c669c5102d25f86622c4",
};
