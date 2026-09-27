// Pure helpers for the opt-in formal-service end-to-end acceptance
// (scripts/acceptance/real-e2e.mjs): argument parsing, the step plan, the
// ledger-based verdict functions and evidence redaction. Nothing here touches
// the network, the database or a provider; the unit tests cover all of it.
//
// Verdicts only read durable facts (room.db rows and Human API responses).
// Answer quality is never judged here: reply bodies go to the report for a
// human to check.

export const MAX_RUN_ATTEMPTS = 40;

/** Exact models for this acceptance (owner approval 2026-09-25 rows). */
export const E2E_MODELS = Object.freeze({
  codex: Object.freeze({
    provider: "codex",
    offerPrefix: "local-workbench-offer-codex",
    model: "gpt-6-luna",
    effort: "low",
    handle: "e2e-codex",
    displayName: "E2E Codex 审查员",
  }),
  claude: Object.freeze({
    provider: "claude",
    offerPrefix: "local-workbench-offer-claude",
    model: "haiku",
    effort: null,
    handle: "e2e-claude",
    displayName: "E2E Claude 审查员",
  }),
});

export const ROLE_INSTRUCTIONS =
  "你是 Loom 验收频道里的代码审查实例。只读审查本频道附加目录中的项目：不修改、不创建、不删除任何文件，不运行会改动文件或安装依赖的命令。回复用中文，简洁，结论附文件与行号依据。";

export const STEPS = Object.freeze([
  {
    n: 1,
    key: "project",
    title: "持久验收项目",
    plan: "若 ~/.loom/acceptance/e2e-project 不存在：创建目录，复制 scripts/workbench-launch-receipt.mjs、其测试与依赖 workbench-launch-mode.mjs 到其 scripts/，git init 并以固定验收作者提交；已存在则只核对这三个文件与 git HEAD。",
    rules: ["目录是 git 仓库且 HEAD 存在；两个文件存在；不含任何凭据文件。"],
    paid: false,
  },
  {
    n: 2,
    key: "channel",
    title: "创建频道并附加项目",
    plan: "room.create（kind=channel，名称 e2e-accept-<时间>，additionalDirectories=[项目 realpath]），经 RoomSession + runRoomMutationAtLatest，幂等键持久化后再发送。",
    rules: [
      "返回的 channelWorkspace.primary.state = ready；room.list 复读一致。",
    ],
    paid: false,
  },
  {
    n: 3,
    key: "roles",
    title: "Role 与实例",
    plan: "host.runtime.list 取 codex / claude offer；codex 绑定 gpt-6-luna + low，claude 绑定 haiku（目录不发布 effort）；先经 approved-models 校验，失败即中止。同 handle 的 Role 已存在则复用，但其 runtimeOfferId 与 modelIntent 必须与预期完全一致，否则中止。role.instantiate 两者进频道。",
    rules: [
      "approved-models 接受 (codex, gpt-6-luna, low) 与 (claude, haiku, 无 effort)。",
      "服务端回显 modelIntent 精确：exactBindingIds 单一、fallback=disabled、reasoning 与表一致。",
    ],
    paid: false,
  },
  {
    n: 4,
    key: "review",
    title: "a. 顶层分工审查",
    plan: "Human 顶层发帖同时 @ 两个实例：codex 审 receipt 写入与 PID 校验，claude 审测试覆盖，各回一段结论。",
    rules: [
      "每个被 @ 实例在频道恰好 1 条回复；无错房间、无额外回复。",
      "本步 Activation 全部 completed，且消费者游标 ≥ toSeq（ACK）。",
      "每个 RunAttempt 的 placement resolvedModel 与表一致。",
    ],
    paid: true,
  },
  {
    n: 5,
    key: "followup",
    title: "b. 多轮互相引用",
    plan: "Human 追问一轮（同时 @ 两人），要求各自引用对方结论。",
    rules: [
      "同 a 的交付/ACK/模型规则。",
      "session 代数不变，原生 session 绑定 id 不变（与 a 结束时相同）。",
      "互相引用是否正确写入报告，人工核对。",
    ],
    paid: true,
  },
  {
    n: 6,
    key: "private",
    title: "c. 私聊排队与隔离",
    plan: "先 room.direct.open 打开 codex 私聊（减少竞态窗口），Human 在频道给 codex 发较长任务；观察到其频道 RunAttempt 开始后立即在私聊发一个问题。",
    rules: [
      "场景成立：私聊消息入账时 codex 的频道 RunAttempt 正在运行（否则判“未覆盖”）。",
      "排队：私聊 RunAttempt 开始时刻 ≥ 频道 RunAttempt 结束时刻（不插入频道轮）。",
      "频道 codex 恰好 1 条回复，私聊 codex 恰好 1 条回复；私聊成员只有 Human 与 codex；claude 在私聊无 Inbox、无消息。",
    ],
    paid: true,
  },
  {
    n: 7,
    key: "memory",
    title: "d. 记忆写入与读回",
    plan: "Human 请 codex 用 worker memory write 记一条 project 记忆（PID 校验结论）；完成后请 claude 用 memory search/read 读回并引用。",
    rules: [
      "memory_entries 新增 1 条 active 条目；其 create 修订 actor_kind=instance、instance_id=codex、run_attempt_id 属于本步 codex 的 RunAttempt、via_room_id=频道。",
      "claude 本步 RunAttempt 轨迹中出现 memory read/search/list 命令。",
      "两次交付各恰好 1 条回复；引用内容人工核对。",
    ],
    paid: true,
  },
  {
    n: 8,
    key: "readSwitch",
    title: "e. 读开关拒绝",
    plan: "memory.policy.update 覆盖 claude read=false；请 claude 再读该记忆；回复后恢复为继承。",
    rules: [
      "开关更新后 policy.members 中 claude read=false，库中覆盖 read_enabled=0。",
      "claude 本步轨迹中出现 memory 读命令（否则判“未覆盖”，服务端不记录拒绝本身）。",
      "本步无 memory 修订写入；恢复后 claude read=true；回复是否承认无法读取人工核对。",
    ],
    paid: true,
  },
  {
    n: 9,
    key: "restart",
    title: "f. daemon 重启后续聊",
    plan: "确认全库无排队/租约中的 Activation 与运行中的 RunAttempt、仓库无未提交的已跟踪改动（服务从工作树运行，重启即部署当前 HEAD），备份 room.db 与 runtime-registry.db，launchctl kickstart -k gui/<uid>/com.loom.evo，等待 4176 与 API 恢复且 pid 变化，然后请两人继续上次讨论。",
    rules: [
      "重启前无活动工作（否则中止，不强杀）。",
      "新进程 pid ≠ 旧 pid；重启前后 session 代数与原生绑定 id 不变。",
      "两人各恰好 1 条回复；是否引用重启前内容人工核对。",
    ],
    paid: true,
  },
  {
    n: 10,
    key: "console",
    title: "g. 控制台",
    plan: "curl /_rah/console/；用控制台自身的 model.ts（loadInstanceStatuses、runUsageDetail、loadUsage）经同一 Human API 读实例卡片、RunAttempt 用量与频道用量。",
    rules: [
      "控制台 200 text/html。",
      "两实例卡片存在且为成员；压缩次数为数字或“未知”；用量汇总含两实例。",
    ],
    paid: false,
  },
  {
    n: 11,
    key: "report",
    title: "证据与报告",
    plan: "汇总各步证据，脱敏后写 evidence.json 与中文 report.md，打印 RunAttempt 与生成总数。",
    rules: ["总 RunAttempt ≤ 上限；超出即急停频道并停止。"],
    paid: false,
  },
]);

export function parseArgs(argv) {
  const options = {
    paid: false,
    dry: false,
    step: 1,
    run: undefined,
    maxRuns: MAX_RUN_ATTEMPTS,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--paid") options.paid = true;
    else if (argument === "--dry") options.dry = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--step") options.step = Number(value());
    else if (argument === "--run") options.run = value();
    else if (argument === "--max-runs") options.maxRuns = Number(value());
    else throw new Error(`unknown argument ${argument}`);
  }
  if (
    !Number.isInteger(options.step) ||
    options.step < 1 ||
    options.step > STEPS.length
  )
    throw new Error(`--step must be 1..${STEPS.length}`);
  if (
    !Number.isInteger(options.maxRuns) ||
    options.maxRuns < 1 ||
    options.maxRuns > MAX_RUN_ATTEMPTS
  )
    throw new Error(`--max-runs must be 1..${MAX_RUN_ATTEMPTS}`);
  if (options.run !== undefined && !/^[0-9TZ-]+$/u.test(options.run))
    throw new Error("--run takes a run stamp such as 20260927T101500Z");
  if (options.paid && options.dry)
    throw new Error("--paid and --dry are exclusive");
  return options;
}

/**
 * Resuming a run (`--step N`): an earlier run's stop reason is history, not
 * this run's verdict, so it moves to `previousStops`.
 */
export function resumeState(saved) {
  const { stoppedReason, ...rest } = saved;
  return stoppedReason === undefined
    ? { ...rest }
    : {
        ...rest,
        previousStops: [...(saved.previousStops ?? []), stoppedReason],
      };
}

/** This run's stop reason: an emergency stop recorded in this run wins. */
export function stopReason({ recordedThisRun, error, isStopError }) {
  return (
    recordedThisRun ?? (isStopError ? error.message : `异常：${error.stack}`)
  );
}

export function runStamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}/u, "");
}

// ---------------------------------------------------------------------------
// Prompts (Human messages). Non-recipient instances are named by display name,
// never by @handle, so a body mention cannot add an unintended recipient.

export function prompts({ codex, claude, memoryName }) {
  return {
    review: `@${codex} @${claude} 请只读审查本频道附加目录中的小项目（不要修改任何文件）。分工：@${codex} 审查 scripts/workbench-launch-receipt.mjs 中 receipt 的写入与 PID 校验逻辑；@${claude} 审查 scripts/workbench-launch-receipt.test.mjs 对这些逻辑的测试覆盖。各自在频道回复一段结论（不超过 200 字，附行号依据）。`,
    followup: `@${codex} @${claude} 追问：请阅读对方刚才在本频道的结论，用一句话引用对方的一个具体发现（注明出自谁），并说明它与你自己的结论是互补还是冲突。不需要再读文件，只回复一段。`,
    longTask: `@${codex} 新任务：请逐一检查 scripts/workbench-launch-receipt.mjs 中每个导出函数的错误处理路径，列出每个 assert/throw 的触发条件，并说明 scripts/workbench-launch-receipt.test.mjs 是否覆盖该条件（给出行号）。完成后在频道回复一段汇总。`,
    privateQuestion:
      "私聊问题：请用一句话说明你认为 PID 校验最大的风险是什么。这条问题只在私聊，请在私聊回复，不要发到频道。",
    memoryWrite: `@${codex} 请用 \`worker memory write\` 记录一条项目记忆（--type project，名称自拟的小写 slug），正文是你对 PID 校验逻辑的结论（含文件与行号）。写完后在频道回复一句，说明你使用的记忆名称。`,
    memoryRead: `@${claude} 请用 memory search 或 memory read 找到并读取 Codex 审查员刚写入的关于 PID 校验的频道记忆，引用其中的结论，并说明该记忆的名称与作者。`,
    memoryDenied: `@${claude} 请再次用 memory read 读取频道记忆${memoryName ? ` ${memoryName}` : ""}的正文，并逐字引用其中的第一句。如果读取失败，请如实说明失败原因，不要凭印象复述。`,
    afterRestart: `@${codex} @${claude} 服务已重启。请继续上次的讨论：不要重新读取文件，各用一两句话复述你在重启前给出的结论，并指出对方结论中你同意或不同意的一点。`,
  };
}

// ---------------------------------------------------------------------------
// Redaction: evidence must carry no credential and no home-path encoding.

const SECRET_KEY =
  /^(authorization|cookie|set-cookie|password|secret|apikey|api_key|token|bearer)$|(access|refresh|bearer|session|auth|host|human|worker|api|id)_?token$|(?:^|_)secret$/iu;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function sanitizeText(text, { home }) {
  let result = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]")
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))=("[^"]*"|'[^']*'|\S+)/gu,
      "$1=[redacted]",
    )
    .replace(/(--turn[ =])("[^"]*"|'[^']*'|\S+)/gu, "$1[redacted]");
  if (typeof home === "string" && home.length > 1) {
    const trimmed = home.replace(/\/+$/u, "");
    // Absolute home path, then the provider project-directory encodings
    // (every "/" -> "-", Claude also maps "." and "_" to "-").
    const encoded = trimmed.replace(/\//gu, "-");
    const encodedLoose = trimmed.replace(/[/._]/gu, "-");
    for (const variant of [`/private${trimmed}`, trimmed])
      result = result.replace(
        new RegExp(`${escapeRegExp(variant)}(?=$|[/"'\\s:;,)\\]}])`, "gu"),
        "~",
      );
    for (const variant of new Set([encodedLoose, encoded]))
      result = result.replace(
        new RegExp(`${escapeRegExp(variant)}(?=$|-|[/"'\\s:;,)\\]}])`, "gu"),
        "~enc",
      );
  }
  return result;
}

export function sanitize(value, options) {
  if (typeof value === "string") return sanitizeText(value, options);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, options));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        sanitizeText(key, options),
        SECRET_KEY.test(key) && item !== null && item !== undefined
          ? "[redacted]"
          : sanitize(item, options),
      ]),
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Verdicts. Each returns { verdict: "pass" | "fail" | "inconclusive", ... }.

const PASS = "pass";
const FAIL = "fail";
const INCONCLUSIVE = "inconclusive";

export function combine(verdicts) {
  if (verdicts.some((item) => item === FAIL)) return FAIL;
  if (verdicts.some((item) => item === INCONCLUSIVE)) return INCONCLUSIVE;
  return PASS;
}

/**
 * Exactly one reply per expected (participant, room) after the step's Human
 * message(s); any reply by a watched instance elsewhere, or a second reply,
 * fails. `messages` are ledger rows created during the step window.
 */
export function judgeDelivery({ expected, messages, instanceIds, afterSeq }) {
  const watched = new Set(instanceIds);
  const replies = messages.filter(
    (message) =>
      watched.has(message.actorId) &&
      (afterSeq?.[message.roomId] === undefined ||
        message.roomSeq > afterSeq[message.roomId]),
  );
  const key = (participantId, roomId) => `${participantId}\u0000${roomId}`;
  const wanted = new Set(
    expected.map(({ participantId, roomId }) => key(participantId, roomId)),
  );
  const perTarget = expected.map(({ participantId, roomId, label }) => {
    const matched = replies.filter(
      (message) =>
        message.actorId === participantId && message.roomId === roomId,
    );
    return {
      label: label ?? participantId,
      participantId,
      roomId,
      count: matched.length,
      messageIds: matched.map(({ messageId }) => messageId),
      roomSeqs: matched.map(({ roomSeq }) => roomSeq),
    };
  });
  const unexpected = replies
    .filter((message) => !wanted.has(key(message.actorId, message.roomId)))
    .map(({ messageId, actorId, roomId, roomSeq }) => ({
      messageId,
      actorId,
      roomId,
      roomSeq,
    }));
  const problems = [];
  for (const target of perTarget) {
    if (target.count === 0) problems.push(`${target.label}: 无回复`);
    if (target.count > 1)
      problems.push(`${target.label}: ${target.count} 条回复（重复）`);
  }
  if (unexpected.length > 0)
    problems.push(`${unexpected.length} 条不在预期房间/实例的回复`);
  return {
    verdict: problems.length === 0 ? PASS : FAIL,
    perTarget,
    unexpected,
    problems,
  };
}

/**
 * Every Activation of the step is completed and its runtime consumer's
 * cursor reached toSeq. A cancelled Activation is reported, not failed (the
 * Kernel may fold one into a follow-up); anything still queued/leased or
 * quarantined fails.
 */
export function judgeAck({ activations, cursors }) {
  const cursorMax = new Map();
  for (const cursor of cursors) {
    const key = `${cursor.roomId}\u0000${cursor.participantId}`;
    cursorMax.set(key, Math.max(cursorMax.get(key) ?? 0, cursor.lastSeq));
  }
  const rows = activations.map((activation) => {
    const lastSeq =
      cursorMax.get(`${activation.roomId}\u0000${activation.participantId}`) ??
      null;
    const acked = lastSeq !== null && lastSeq >= activation.toSeq;
    return {
      activationId: activation.activationId,
      roomId: activation.roomId,
      participantId: activation.participantId,
      state: activation.state,
      toSeq: activation.toSeq,
      cursorLastSeq: lastSeq,
      acked,
    };
  });
  const problems = [];
  if (rows.length === 0) problems.push("本步没有 Activation");
  for (const row of rows) {
    if (row.state === "cancelled") continue;
    if (row.state !== "completed")
      problems.push(`${row.activationId}: state=${row.state}`);
    else if (!row.acked)
      problems.push(
        `${row.activationId}: 游标 ${String(row.cursorLastSeq)} < toSeq ${row.toSeq}`,
      );
  }
  return {
    verdict: problems.length === 0 ? PASS : FAIL,
    rows,
    cancelled: rows.filter(({ state }) => state === "cancelled").length,
    problems,
  };
}

/**
 * No implicit session replacement: per participant the session generation is
 * unchanged and at most one native session id was ever bound. `before` may
 * lack a binding (first turn); after a binding exists it must stay the same.
 */
export function judgeSession({ before, after, participants }) {
  const problems = [];
  const rows = participants.map(({ participantId, label }) => {
    const b = before[participantId] ?? {};
    const a = after[participantId] ?? {};
    const beforeIds = new Set(b.providerSessionIds ?? []);
    const afterIds = new Set(a.providerSessionIds ?? []);
    const union = new Set([...beforeIds, ...afterIds]);
    const row = {
      label: label ?? participantId,
      participantId,
      generationBefore: b.generation ?? null,
      generationAfter: a.generation ?? null,
      providerSessionIdsBefore: [...beforeIds],
      providerSessionIdsAfter: [...afterIds],
    };
    if (
      b.generation !== undefined &&
      b.generation !== null &&
      a.generation !== b.generation
    )
      problems.push(
        `${row.label}: session 代数 ${b.generation} -> ${String(a.generation)}`,
      );
    if (union.size > 1)
      problems.push(`${row.label}: 出现 ${union.size} 个原生 session id`);
    if (afterIds.size === 0 && (a.bound ?? false))
      problems.push(`${row.label}: Kernel 标记已绑定但 Host 无绑定记录`);
    if (beforeIds.size > 0 && afterIds.size === 0)
      problems.push(`${row.label}: 原生 session 绑定消失`);
    return row;
  });
  return { verdict: problems.length === 0 ? PASS : FAIL, rows, problems };
}

/**
 * Private box: the question must arrive while the channel RunAttempt runs
 * (else the queue path was not exercised), its RunAttempt must start only
 * after the channel run finished, and only the Human and the instance are
 * members; the other instance gets no Inbox item or message there.
 */
export function judgePrivateBox({
  channelRun,
  privateRun,
  privateMessageAt,
  members,
  humanId,
  instanceId,
  otherInstanceId,
  otherInboxCount,
  otherMessageCount,
}) {
  const problems = [];
  const notes = [];
  let exercised = false;
  if (channelRun === undefined || privateMessageAt === undefined) {
    notes.push("缺少频道 RunAttempt 或私聊消息");
  } else {
    exercised =
      channelRun.startedAt <= privateMessageAt &&
      (channelRun.finishedAt === null ||
        privateMessageAt < channelRun.finishedAt);
    if (!exercised) notes.push("私聊消息入账时频道轮未在运行：排队场景未覆盖");
  }
  if (privateRun === undefined) problems.push("私聊没有 RunAttempt");
  else if (channelRun !== undefined) {
    if (channelRun.finishedAt === null) problems.push("频道 RunAttempt 未结束");
    else if (privateRun.startedAt < channelRun.finishedAt)
      problems.push(
        `私聊 RunAttempt 在频道轮结束前开始（${privateRun.startedAt} < ${channelRun.finishedAt}）`,
      );
  }
  const memberSet = new Set(members);
  if (
    memberSet.size !== 2 ||
    !memberSet.has(humanId) ||
    !memberSet.has(instanceId)
  )
    problems.push(`私聊成员异常：${[...memberSet].join(",")}`);
  if (memberSet.has(otherInstanceId)) problems.push("另一实例是私聊成员");
  if (otherInboxCount > 0)
    problems.push(`另一实例在私聊有 ${otherInboxCount} 条 Inbox`);
  if (otherMessageCount > 0)
    problems.push(`另一实例在私聊有 ${otherMessageCount} 条消息`);
  const verdict = problems.length > 0 ? FAIL : exercised ? PASS : INCONCLUSIVE;
  return { verdict, exercised, problems, notes };
}

/** One new active entry whose create revision proves the writer instance. */
export function judgeMemoryWrite({
  entries,
  revisions,
  writerInstanceId,
  writerRunIds,
  channelId,
}) {
  const problems = [];
  const created = revisions.filter((revision) => revision.op === "create");
  if (entries.length !== 1)
    problems.push(`本步新增记忆条目 ${entries.length} 条（期望 1）`);
  const entry = entries[0];
  const create =
    entry === undefined
      ? undefined
      : created.find((revision) => revision.entryId === entry.entryId);
  if (entry !== undefined) {
    if (entry.state !== "active") problems.push(`条目状态 ${entry.state}`);
    if (entry.scopeRoomId !== channelId) problems.push("条目不在本频道");
    if (create === undefined) problems.push("缺少 create 修订");
    else {
      if (create.actorKind !== "instance")
        problems.push(`作者类型 ${create.actorKind}`);
      if (create.instanceId !== writerInstanceId)
        problems.push("作者实例不是 codex");
      if (!writerRunIds.includes(create.runAttemptId))
        problems.push("出处 RunAttempt 不属于本步 codex 运行");
      if (create.viaRoomId !== channelId) problems.push("出处房间不是本频道");
    }
  }
  return {
    verdict: problems.length === 0 ? PASS : FAIL,
    entryId: entry?.entryId ?? null,
    name: entry?.name ?? null,
    provenance: create ?? null,
    problems,
  };
}

export const MEMORY_READ_COMMAND = /\bmemory\s+(read|search|list)\b/u;

/** Trajectory tool_start entries that invoke a memory read command. */
export function memoryReadAttempts(trajectory) {
  return trajectory.filter((entry) => {
    if (entry.kind !== "tool_start") return false;
    const input =
      typeof entry.toolInput === "string"
        ? entry.toolInput
        : JSON.stringify(entry.toolInput ?? "");
    return MEMORY_READ_COMMAND.test(input);
  });
}

export function judgeMemoryRead({ trajectory }) {
  const attempts = memoryReadAttempts(trajectory);
  return {
    verdict: attempts.length > 0 ? PASS : FAIL,
    attempts: attempts.length,
    problems: attempts.length > 0 ? [] : ["轨迹中没有 memory read/search/list"],
  };
}

/**
 * Read switch: effective read off for the target while it tried to read, no
 * memory write during the step, and restored afterwards. The Kernel records
 * no denial row, so the refusal text itself is left to the human reviewer.
 */
export function judgeReadSwitch({
  offPolicy,
  overrideRow,
  restoredPolicy,
  instanceId,
  trajectory,
  revisionsDuringStep,
}) {
  const problems = [];
  const notes = [];
  const member = (policy) =>
    policy?.members?.find((item) => item.instanceId === instanceId);
  if (member(offPolicy)?.read !== false)
    problems.push("关闭后 policy.members 中读开关不是 false");
  if (overrideRow?.readEnabled !== 0) problems.push("库中覆盖 read_enabled≠0");
  if (revisionsDuringStep > 0)
    problems.push(`本步出现 ${revisionsDuringStep} 条记忆修订`);
  if (restoredPolicy !== undefined && member(restoredPolicy)?.read !== true)
    problems.push("恢复后读开关不是 true");
  if (restoredPolicy === undefined) problems.push("读开关未恢复");
  const attempts = memoryReadAttempts(trajectory).length;
  if (attempts === 0)
    notes.push("claude 未尝试读取记忆：拒绝路径未覆盖（服务端不记录拒绝）");
  const verdict =
    problems.length > 0 ? FAIL : attempts > 0 ? PASS : INCONCLUSIVE;
  return { verdict, attempts, problems, notes };
}

/** Every RunAttempt ran on the exact approved binding. */
export function judgePlacementModel({ runs, expectedByParticipant }) {
  const problems = [];
  for (const run of runs) {
    const expected = expectedByParticipant[run.participantId];
    if (expected === undefined) continue;
    const resolved = run.resolvedModel;
    if (resolved === null || resolved === undefined) {
      problems.push(`${run.runAttemptId}: 无 placement 模型记录`);
      continue;
    }
    if (resolved.modelBindingId !== expected.bindingId)
      problems.push(
        `${run.runAttemptId}: 绑定 ${resolved.modelBindingId} ≠ ${expected.bindingId}`,
      );
    const reasoning = resolved.reasoning ?? null;
    if (reasoning !== expected.effort)
      problems.push(
        `${run.runAttemptId}: 推理 ${String(reasoning)} ≠ ${String(expected.effort)}`,
      );
  }
  return { verdict: problems.length === 0 ? PASS : FAIL, problems };
}

export function judgeBudget({ runAttempts, maxRuns }) {
  return {
    verdict: runAttempts <= maxRuns ? PASS : FAIL,
    runAttempts,
    maxRuns,
    problems:
      runAttempts <= maxRuns
        ? []
        : [`RunAttempt ${runAttempts} 超过上限 ${maxRuns}`],
  };
}

/** Sum per-generation usage rows; absent numbers stay null (unknown). */
export function summarizeUsage(rows) {
  const sum = (field) =>
    rows.length === 0 || rows.some((row) => row[field] === null)
      ? null
      : rows.reduce((total, row) => total + row[field], 0);
  const last = [...rows]
    .reverse()
    .find(
      (row) => row.contextUsedTokens !== null || row.contextWindow !== null,
    );
  return {
    generations: rows.length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningOutputTokens: sum("reasoningOutputTokens"),
    contextUsedTokens: last?.contextUsedTokens ?? null,
    contextWindow: last?.contextWindow ?? null,
  };
}

/** Collapse a polled activity sequence to its state changes. */
export function stateChanges(samples) {
  const changes = [];
  let previous = new Map();
  for (const sample of samples) {
    const next = new Map();
    for (const agent of sample.agents) {
      const key = `${agent.roomId}\u0000${agent.participantId}`;
      const signature = JSON.stringify([
        agent.state,
        agent.queued ?? null,
        agent.activationId ?? null,
        agent.runAttemptId ?? null,
        agent.lastError ?? null,
      ]);
      next.set(key, signature);
      if (previous.get(key) !== signature)
        changes.push({
          at: sample.at,
          roomId: agent.roomId,
          participantId: agent.participantId,
          state: agent.state,
          queued: agent.queued ?? null,
          activationId: agent.activationId ?? null,
          runAttemptId: agent.runAttemptId ?? null,
          lastError: agent.lastError ?? null,
        });
    }
    previous = next;
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Plan and report rendering.

export function renderPlan({ maxRuns }) {
  const lines = [
    "Loom 正式服务真实贯通验收（计划，--dry 不访问网络、不调用模型）",
    "",
    `模型：codex ${E2E_MODELS.codex.model} / ${E2E_MODELS.codex.effort}；claude ${E2E_MODELS.claude.model} / 无 effort（均经 approved-models 校验）`,
    `上限：总 RunAttempt ≤ ${maxRuns}（超出即急停频道并停止）`,
    "预计：最少 11 个 RunAttempt（a 2、b 2、c 2、d 2、e 1、f 2），约 25–45 次模型生成；实例互相 @ 触发的追加轮会增加 RunAttempt 并记为交付失败。",
    "鉴权：网关 trusted-proxy（占位 bearer trusted-proxy-auth + Origin http://127.0.0.1:4176），写操作 RoomSession + runRoomMutationAtLatest，每个意图一个持久化幂等键。",
    "判定：只读 room.db（node:sqlite readOnly）与 Human API；回答质量写入报告待人工核对。",
    "",
  ];
  for (const step of STEPS) {
    lines.push(
      `${step.n}. ${step.title}${step.paid ? "（调用真实模型）" : ""}`,
      `   做法：${step.plan}`,
      ...step.rules.map((rule) => `   判定：${rule}`),
    );
  }
  lines.push(
    "",
    "每个调用模型的步骤共同判定：交付恰好一条/无错房间/无重复（judgeDelivery）、ACK（judgeAck）、session 连续（judgeSession）、placement 模型（judgePlacementModel）、预算（judgeBudget）。",
  );
  return lines.join("\n");
}

const VERDICT_TEXT = { pass: "通过", fail: "失败", inconclusive: "未覆盖" };

export function verdictText(verdict) {
  return VERDICT_TEXT[verdict] ?? String(verdict);
}

function cell(text) {
  return String(text ?? "—")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ");
}

export function renderReport(evidence) {
  const lines = [
    `# 正式服务真实贯通验收报告（${evidence.stamp}）`,
    "",
    `- 服务：${evidence.origin}；部署提交：${evidence.gitHead ?? "未知"}；判定只依据 room.db 与 Human API。`,
    `- 模型：codex ${evidence.models?.codex ?? "—"}；claude ${evidence.models?.claude ?? "—"}。`,
    `- 频道：${evidence.channel?.name ?? "—"}（${evidence.channel?.roomId ?? "—"}）；项目：${evidence.project?.dir ?? "—"}（HEAD ${evidence.project?.head ?? "—"}）。`,
    `- 调用规模：RunAttempt ${evidence.totals?.runAttempts ?? "—"}（上限 ${evidence.totals?.maxRuns ?? "—"}），模型生成 ${evidence.totals?.generations ?? "—"}。`,
    `- 总判定：${verdictText(evidence.overall)}${evidence.stoppedReason ? `；停止原因：${evidence.stoppedReason}` : ""}。`,
    "",
    "“通过”只表示账本与 API 事实满足判定规则，不表示回答正确；“未覆盖”表示该路径本次没有被触发。",
    "",
    "## 各步判定",
    "",
    "| 步骤 | 判定 | 耗时 | RunAttempt | 生成 | 问题 |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const step of evidence.steps ?? []) {
    lines.push(
      `| ${cell(`${step.n}. ${step.title}`)} | ${verdictText(step.verdict)} | ${step.durationMs === undefined ? "—" : `${(step.durationMs / 1000).toFixed(1)} s`} | ${step.runs?.length ?? 0} | ${step.generations ?? 0} | ${cell((step.problems ?? []).join("；") || "—")} |`,
    );
  }
  for (const step of evidence.steps ?? []) {
    lines.push("", `## ${step.n}. ${step.title}`, "");
    for (const [name, judgment] of Object.entries(step.judgments ?? {})) {
      lines.push(
        `- ${name}：${verdictText(judgment.verdict)}${judgment.problems?.length ? `（${judgment.problems.join("；")}）` : ""}${judgment.notes?.length ? `；备注：${judgment.notes.join("；")}` : ""}`,
      );
    }
    for (const message of step.humanMessages ?? [])
      lines.push(
        `- Human #${message.roomSeq}（${message.roomLabel ?? message.roomId}）：${cell(message.body)}`,
      );
    if ((step.runs ?? []).length > 0) {
      lines.push(
        "",
        "| RunAttempt | 实例 | 房间 | 状态 | 模式 | 开始 → 结束 | 生成 | 输入/缓存/输出 | 压缩 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const run of step.runs)
        lines.push(
          `| ${cell(run.runAttemptId)} | ${cell(run.label)} | ${cell(run.roomLabel)} | ${cell(run.state)} | ${cell(run.executionMode)} | ${cell(`${run.startedAt} → ${run.finishedAt ?? "—"}`)} | ${run.usage?.generations ?? 0} | ${cell(`${run.usage?.inputTokens ?? "未知"}/${run.usage?.cachedInputTokens ?? "未知"}/${run.usage?.outputTokens ?? "未知"}`)} | ${cell(run.compactionCount ?? "未知")} |`,
        );
    }
    for (const reply of step.replies ?? [])
      lines.push(
        "",
        `**回复 #${reply.roomSeq}（${reply.label}，${reply.roomLabel}，延迟 ${reply.latencyMs === null ? "—" : `${(reply.latencyMs / 1000).toFixed(1)} s`}）— 质量待人工核对：**`,
        "",
        ...reply.body.split(/\r?\n/u).map((line) => `> ${line}`),
      );
    if (step.extra !== undefined)
      lines.push("", "```json", JSON.stringify(step.extra, null, 2), "```");
  }
  lines.push(
    "",
    "## 人工核对清单",
    "",
    "- a：两段结论是否分别针对 receipt 写入/PID 校验与测试覆盖，行号是否真实。",
    "- b：是否准确引用了对方结论。",
    "- c：私聊回答是否只在私聊；频道汇总是否未提及私聊内容。",
    "- d：记忆正文是否为 PID 校验结论；claude 的引用是否与记忆一致。",
    "- e：claude 是否承认无法读取，而非凭印象复述。",
    "- f：重启后的复述是否与重启前一致（未重读文件）。",
    "",
    "## 已知限制",
    "",
    ...(evidence.limitations ?? []).map((item) => `- ${item}`),
  );
  return `${lines.join("\n")}\n`;
}

export const LIMITATIONS = Object.freeze([
  "读开关拒绝只能由“开关生效 + 轨迹中出现读命令 + 无修订写入”间接证明；Kernel 不记录被拒的读取，回复是否承认失败需人工核对。",
  "记忆读回只证明 claude 调用了读命令；因记忆名称在频道可见，不能自动证明引用内容来自记忆正文。",
  "私聊排队依赖时序：若 codex 频道轮在私聊入账前已结束，判“未覆盖”，需重跑该步（--step 6）。",
  "原生 session id 来自 Host 绑定文件 supervisors/provider-sessions 与 instance_runtimes；只证明 Loom 传给 CLI 的续聊 id 未变，不证明 provider 侧上下文完整。",
  "实例回复中互相 @ 会触发追加轮，按“额外回复”判失败并计入预算；这是产品行为发现，不是脚本错误。",
  "Claude 使用 haiku（负责人 2026-09-25 批准行），不是 AGENTS.md 2026-09-09 矩阵中的 sonnet；Codex 使用 gpt-6-luna。",
  "不是效率门禁：没有原生 CLI 对照，逐轮 usage 只作记录。",
]);
