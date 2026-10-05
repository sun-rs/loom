// Frozen read-only workload. Rubric is evaluator-only; never send it to a provider.
// Changes to prompts or fixture require a new workload id and explicit hash update.
export const longWorkload = {
  id: "restart-audit-12/v1",
  sourceRef: "7afe141",
  sourceHashes: {
    "scripts/workbench-launch-receipt.mjs":
      "3a3172ea85a970ff74eb410ef5c8aee4673e2d94037c9d4a77b67a02efbb5059",
    "scripts/workbench-launch-receipt.test.mjs":
      "10bdfcbfe0512dfd9e877d7f0609981cd21131a392a7c9a8853563b00bb12fd2",
    "scripts/restart-local-workbench.mjs":
      "7e954b65a955e92848049141452ee1f58c371acce4387b353948cbd5b34bab9f",
    "scripts/workbench-restart-guard.mjs":
      "6e6ff19f1660e5554c1f537989a58d417cf09067ee0a6e235ad8b8d06e54c5cb",
    "packages/daemon/src/state-backup.ts":
      "061b44268498eac1e3a8587ad3263724bab83a701b9d21039fe860273a929436",
    "packages/daemon/test/workbench-restart-guard.test.ts":
      "f0688cf676099e14d2cadaad96177eacff4feadfc768905d4c3977a1d93f41ab",
  },
  sourceBytes: {
    "scripts/workbench-launch-receipt.mjs": 4237,
    "scripts/workbench-launch-receipt.test.mjs": 6995,
    "scripts/restart-local-workbench.mjs": 6879,
    "scripts/workbench-restart-guard.mjs": 807,
    "packages/daemon/src/state-backup.ts": 19703,
    "packages/daemon/test/workbench-restart-guard.test.ts": 10038,
  },
  totalSourceBytes: 48659,
  instructions:
    "这是一项连续的只读工程审查：同一原生 session 完成12阶段，不替换会话。只使用固定快照列出的文件及已开放的行段；已读内容尽量从上下文复用，若原生compaction等导致必要重读，应标明原因并如实计费，不能用未开放源码补答案。不得读取其他源码、真实服务状态、历史审计或私人资料；不得运行/导入脚本、执行测试、写文件、操作服务、使用记忆或Task。允许只读shell读取指定源文件；未提供的依赖实现标为未验证。每轮仅一次最终答复，以“审查结论：”开头，正文400–600个汉字（统计Unicode Han字符，JSON传输外壳不计），引用文件和行号，区分实现、已有测试、建议、未知。长度合规作为独立指令指标单列，交付完成不等于技术质量通过。不要重复此前全文；仅有真实先前错误才准确纠正，不编造自我撤回。所有阶段题面固定，不以模型表现改题。",
  questions: [
    "阶段1：网络保留契约\n新增读取 scripts/workbench-launch-receipt.mjs 全文。\n建立网络回执的输入/输出契约：分别说明 loopback、tailnet、LAN 的重建行为及环境清理；说明 PID 检查能证明与不能证明什么；列一项尚需调用者或依赖确认的边界。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段2：测试覆盖矩阵\n新增读取 scripts/workbench-launch-receipt.test.mjs 全文。\n把已有测试归为“保留正确配置”“拒绝损坏输入”“回执写入”三组，各给一项精确断言；指出两个未由这些测试证明的边界，并设计其中一个只读审查层面的回归测试规格（前置/输入/断言，不执行）。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段3：实际重启编排\n新增读取 scripts/restart-local-workbench.mjs 与 scripts/workbench-restart-guard.mjs 全文。\n按真实调用顺序给出从候选构建检查到 successor spawn 的简图；解释相较回执 helper 新增哪些 incumbent 身份检查、何时重新检查；判断超时能否强杀/启动 successor。区分调用处可见保证和未提供依赖实现。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段4：备份内容与排除规则\n新增读取 packages/daemon/src/state-backup.ts:1–257。\n制作四类条目的处理表：普通私有/可执行文件、SQLite与WAL、socket、运行期turn凭据目录；说明如何拒绝路径/目标风险。给出备份一致性的准确边界，不把“校验通过”扩大为全状态原子快照。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段5：验证证据与损坏注入\n新增读取 packages/daemon/test/workbench-restart-guard.test.ts 全文。\n用实现和测试区分“数据库自身可读/完整”“数据库字节与receipt相同”“数据库集合相同”“普通文件相同”四种证据。针对合法SQL改写、额外数据库、文件改写各判定会否拒绝；指出一项这里没有覆盖的运维整合行为。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段6：哪些工作允许重启\n新增读取 packages/daemon/src/state-backup.ts:258–309。\n判定五种条件（其他表均静止）：无lease的quarantined、带lease的quarantined、普通queued、同room且operation=stopped的无lease queued、同room operation=resumed的queued。分别给 restartable/idle 结果。说明该检查会否完成/丢弃这些工作，并连接到重启脚本。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段7：迁移前保护\n新增读取 packages/daemon/src/state-backup.ts:310–491。\n整理 no pending、unsupported schema、同版本unexpected drift、pending migration 四条分支；比较 preflightKernelUpgrade 与 protectKernelSchemaMigration 的写入目标。说明备份失败时哪一步不得发生、哪种失败后不能宣称数据已自动回滚。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段8：显式恢复条件\n新增读取 packages/daemon/src/state-backup.ts:492–601。\n按顺序列出恢复前的确认、身份/路径、备份、运行/静止、业务写入和内容检查；解释 staging/两次rename 的失败补救。说明为何“roomSeq未增加”不足以允许恢复，并指出可见代码对并发排除的证明边界。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段9：跨层契约对齐\n无新读取。\n把阶段4的 fileInventory 完整返回对象与阶段3 recheck 实参逐字段对照。对于存在被省略运行期凭据目录、其他一切不变的合法state，推导重启会在哪里停住；如确有问题，给出保留安全检查的最小修改建议和反例，不实施。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段10：竞态与证据上限\n无新读取。\n对三种事件给“必拒绝/条件拒绝/代码不足以证明”及原因：普通文件在备份过程中改变并保持；Room事件在baseline与recheck之间追加并保持；最后一次inspect返回后、SIGTERM前新工作到达。另说明多数据库依次备份是否获得同一事务时点。只讨论可见程序，不发明新调度器。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段11：最小可执行回归计划（只写规格）\n无新读取。\n为阶段9缺口写两个精确测试（稳定目录允许到达stop；目录集合变化仍阻止stop）；再给一个区别“备份内部有效”与“备份不可替代实时状态”的测试。每项含最小fixture、观察点、现代码红点/已绿或未验证状态。不得靠运行真实服务，或把预期fail的功能当既有实现。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
    "阶段12：交接决定\n无新读取。\n交付给维护者一份最终审查备忘录：当前哪些用途有代码/测试支持，哪一项具体缺口建议先修，哪些验证仍缺；给最小修改范围及验收顺序。引用此前证据而不复制全报告；只有真实先前错误才纠正，明确是静态审查而非执行验收。\n沿用统一边界；本轮答复400–600个汉字，以“审查结论：”开头。",
  ],
  checkpoints: [1, 3, 6, 9, 12],
  rubric: [
    {
      stage: 1,
      criteria: [
        "七个 networkKeys 被清除后重建，未称清除整个 env",
        "三种模式正确且 LAN cert/key 非无条件成对必填",
        "PID数值相等不是回执来源真实性/无 PID 重用证明。引用 receipt:15–99。",
      ],
    },
    {
      stage: 2,
      criteria: [
        "tailnet additionalBindHosts 已有 deepEqual，不可称无覆盖",
        "无效写入测试使用新目录，不能推出失败会删除旧回执",
        "未覆盖项及测试前置真实，不能把 PID 真实性编造为已有保证。receipt.test:108–130、180–200。",
      ],
    },
    {
      stage: 3,
      criteria: [
        "validate→inspect→backup→verify→recheck→stop，全部 true 且 await",
        "ps identity/cwd/database/port 检查不等于回执作者认证",
        "SIGTERM30s未退出抛错、不forcekill且未进入后续spawn，不能把spawn等同健康/页面验收。restart:59–104、125–223；guard:18–29。",
      ],
    },
    {
      stage: 4,
      criteria: [
        "online SQLite backup，不复制live WAL",
        "socket省略及精确 warm-runtimes/instrt_UUID/turns 排除，provider-sessions不整体排除",
        "拒绝symlink/已存在目标/嵌套目标，普通文件hash前后比较不证明多DB与其他文件全局原子。state:76–204。",
      ],
    },
    {
      stage: 5,
      criteria: [
        "quick_check/FK与hash不同作用",
        "三种损坏分别digest/dbset/filedigest拒绝，不把合法SQLite改写视作可通过",
        "guard steps注入测试不是实际ps/lsof/SIGTERM/spawn/健康全链验证。state:210–257；test:109–244。",
      ],
    },
    {
      stage: 6,
      criteria: [
        "restartable依次允许/拒绝/拒绝/允许/拒绝，idle五者全部拒绝",
        "Run/runtime/placement/exclusive lease同样阻挡，SOS须room+operation关联且lease全部NULL",
        "纯SELECT+assert不修改/完成状态，实际脚本用restartable而restore用idle。",
      ],
    },
    {
      stage: 7,
      criteria: [
        "nopending不snapshot、unsupported/sameversionunexpected拒绝",
        "preflight在临时copy初始化、protect在snapshot后初始化live",
        "snapshot失败阻止migration，kernel.initialize失败没有自动restore保证。未给Kernel实现不能证明migration本身无bug。state:394–489。",
      ],
    },
    {
      stage: 8,
      criteria: [
        "confirm/path/verifiedsnapshot，runningPid检查是可选，不可断言总自动发现所有进程",
        "idle+hosts offline+writeEvidence+file/dbset/contentdigest多层，roomSeq单独不够",
        "stage先验证且再次verifyUnchanged，第二rename失败尝试改回原目录，不是不可失败事务/全局排他锁。digest具体实现未给出，不猜算法。",
      ],
    },
    {
      stage: 9,
      criteria: [
        "确诊 omittedRuntimeCredentials仅非空时返回，recheck expected漏字段，deepEqual失败于stop前",
        "不误称凭据泄漏/数据损坏",
        "建议比较相同完整manifest（含排除目录名单）而非删除/弱化整个检查，新增目录变化仍应拒绝。state:114–117；restart:152–156。此为固定快照的真实可复现整合缺口，不依赖模型自我纠错。",
      ],
    },
    {
      stage: 10,
      criteria: [
        "持续文件变化在清单复查被拒（避免声称中途改回也必检出）",
        "事件追加由inspect/baseline seq或活动检查拒",
        "最终check→signal没有原子互斥证明，多DB无全局snapshot；可见安全机制与未知的原生drain实现分开。",
      ],
    },
    {
      stage: 11,
      criteria: [
        "同一runtime UUID/turns路径匹配真实regex且虚假credential内容不进入backup",
        "比较前后集合改变拒绝，不以忽略extra字段修复",
        "合法数据库内容改写/新业务写入测试定位正确guard且临时状态/fake steps，不需真实restart，不声称测试已执行。允许等价准确案例。",
      ],
    },
    {
      stage: 12,
      criteria: [
        "保持阶段9实证缺口及安全边界，不用“所有restart不可用”夸大限定触发条件",
        "建议单owner最小整合修复+回归、没有恢复凭据/跳过校验/服务实际操作",
        "不把fixture/staticreview变成实际部署、全链、效率验收，保留依赖和TOCTOU边界。",
      ],
    },
  ],
  questionHashes: [
    "da3a2d53888dcbed014815421dfd0d254f32c00782bdbd3b7228dc3200e8b151",
    "6159ee6e25d039d323130d2aa0a89d577f6809ff9a863d65dfa6774a8ab53669",
    "0f0045a76a7acd65dff82a516369e88f94ce108bad0e5639f2aa8fa1a31de0b5",
    "e041bb4217bff21747a063059b3eb47551b5a0a42c2786e8ec5d37cb2fcfe73a",
    "f7a4a1ec80d6798ffc69be678e5f00dfe3f1b36998709fa0281edc0d84bed275",
    "9e14c6bf8c8111999b112cddbb41a46b0124675c45ef15675e5b803230ae47ec",
    "d491b6ae6e19f3864172474f21cc6409b57b1ed25a62452600b4698440490efc",
    "5eb9b66f3a2a938f531039cd2a713338bd0fd1ccd3fb9937cad0b822b36545d1",
    "9f191bc1af57fa3dfa27563b4f44f0af34a3aea873b4abd2bb83fa179c3644ea",
    "a91b922df2689558fdd5e7de6e7da5a4298b2043aeadfa0f817dd26bc4116db8",
    "a9683ea4d955f79a7871a4b72fd639db4ea8aecdb0f91a0479c54046c0c256a7",
    "5d435d17eafe53463a7522713f9f3fb247a45d991d462d6537eb7baf9f9545b6",
  ],
  promptSetHash:
    "2baafe268994b8a00bfdcae984382974fb073235cbd84b1f83dfa4be84e702a7",
};
