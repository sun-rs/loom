/**
 * Console write layer (no DOM). Every Room write is a WriteIntentSlot intent
 * run through client-core's runRoomMutationAtLatest: `basedOnRoomSeq` comes
 * from the synced RoomSession, a stale_context refusal re-syncs and retries,
 * and one intent keeps one idempotency key and one frozen payload across its
 * stale retries and any verification after an unknown result. Inputs are pre-checked with the
 * protocol schemas; the server stays the only owner of the decision.
 * Throwaway: deleted in phase 4.
 */
import {
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "@rah-os/client-core";
import { RahClientError } from "@rah-os/client-sdk";
import {
  ChannelAttachedDirectoriesSchema,
  RoleConfigurationSchema,
  RuntimeSettingsUpdateSchema,
  type LocalRuntimeInventoryResponse,
  type RoleCreateRequest,
  type RoomEvent,
  type RuntimeSettings,
  type RuntimeSettingsUpdate,
} from "@rah-os/protocol";

/** Total attempts (first try plus stale retries), client-core's default. */
export const STALE_RETRY_ATTEMPTS = 3;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function newIdempotencyKey(action: string): string {
  return `console-${action}-${crypto.randomUUID()}`;
}

/**
 * What one failed request says about itself. A 4xx means this request was
 * refused, so it did not commit; that is proof about the original write only
 * when this request was the first send. Once a send's result was unknown, a
 * later 401/403/404/429 or idempotency conflict (gateway, authentication or a
 * permission check that runs before the Kernel's replay lookup) proves
 * nothing about it. A network error, timeout, 5xx or an unreadable success
 * response leaves this request's own result unknown.
 */
export function classifyWriteFailure(error: unknown): "rejected" | "unknown" {
  return error instanceof RahClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
    ? "rejected"
    : "unknown";
}

function isStaleContext(error: unknown): boolean {
  return (
    error instanceof RahClientError &&
    error.status === 409 &&
    error.code === "stale_context"
  );
}

/**
 * Console actions whose Kernel handler looks up the idempotency key (replay
 * or conflict) before its freshness check, in one transaction. For these
 * only, `stale_context` on an identical replay (same key, payload and basis)
 * proves the original send never committed. Audited at evo HEAD c5cbf98;
 * every other action keeps an unverified result unknown after a stale
 * replay. Evidence (packages/kernel/src; replay line -> freshness line):
 */
export const REPLAY_BEFORE_FRESHNESS: Readonly<Record<string, string>> = {
  "task-policy":
    "room.update: replay before assertFreshContext in collaboration-service",
  "task-create": "task.create/convert: task-intent replay before freshness",
  "activation-abandon":
    "instance.activation.abandon: role-catalog.ts abandonBlockedActivation replay :540-554 -> fresh :555 (added 2026-09-27, D2-2)",
  "channel-create":
    "room.create: collaboration-service.ts createWorkspaceRoomAtomically replay :479-503 -> basedOnControlRoomSeq check :504-508",
  "direct-open":
    "room.direct.open: collaboration-service.ts replay :987-999 -> basedOnControlRoomSeq check :1022-1026",
  instantiate:
    "role.instantiate: role-catalog.ts replay :267-291 -> fresh :292",
  "instance-remove":
    "room.member.remove: collaboration-service.ts replay :1316-1333 -> fresh :1340",
  message:
    "message.post: collaboration-service.ts postMessage replay :1840-1858 -> #assertFreshContext :1871",
  "role-delete": "role.delete: replay before revision and freshness checks",
  "role-create": "role.create: role-catalog.ts replay :202-213 -> fresh :215",
  "role-revise":
    "role.revise: role-catalog.ts replay :85-96 -> revision check :98, fresh :100",
  "session-reset":
    "instance.session.reset: role-catalog.ts replay :401-415 -> fresh :416",
  "sos-resume":
    "room.sos.resume: room-agent-sos-service.ts replay :332-347 -> fresh :369",
  "sos-stop":
    "room.sos.stop: room-agent-sos-service.ts replay :59-76 -> fresh :94/:122",
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export type IntentState = "idle" | "pending" | "unknown";

export type IntentOutcome<Result> =
  | { kind: "ok"; result: Result }
  | { kind: "rejected"; error: unknown }
  | {
      kind: "unknown";
      error: unknown;
      /**
       * True when an earlier send's result is still unverified and this
       * attempt was refused (e.g. 401 after a cookie renewal, 403, 404, 429,
       * idempotency conflict, or an unconfirmed stale replay): only this
       * verification failed; the original key, payload and basis are kept.
       */
      verificationFailed: boolean;
    }
  | { kind: "busy"; state: IntentState };

export type IntentSpec<Payload, Result> = {
  action: string;
  /** Called for the submit and for every retry of this same intent. */
  onSettled?: (outcome: IntentOutcome<Result>) => void;
  /** Copied and frozen at submit; every attempt sends exactly this. */
  payload: Payload;
  send: (
    payload: Readonly<Payload>,
    basedOnRoomSeq: number,
    idempotencyKey: string,
  ) => Promise<Result>;
  session: RoomMutationSequenceSession;
};

/**
 * For revision-checked writes: no Room basis is read or sent. These
 * endpoints never answer `stale_context`, so the stale retry loop never
 * repeats a send.
 */
const NO_ROOM_BASIS: RoomMutationSequenceSession = {
  syncUntilCurrent: () =>
    Promise.resolve({ caughtUp: true, state: { latestRoomSeq: 0 } }),
};

type Intent = {
  action: string;
  execute: () => Promise<IntentOutcome<unknown>>;
  key: string;
  payload: unknown;
};

/** Slots with a pending or unknown intent, for the leave-page warning. */
const unresolved = new Set<WriteIntentSlot>();

export function hasUnresolvedIntents(): boolean {
  return unresolved.size > 0;
}

/**
 * The Human confirmed leaving: forget the warning for every current slot
 * (their views are unmounted with them; nothing is sent or abandoned).
 */
export function discardUnresolvedIntents(): void {
  for (const slot of unresolved) slot.discard();
  unresolved.clear();
}

/**
 * One submitted write intent per surface (form-level, in memory only). It
 * keeps the frozen payload, the idempotency key and, separately, whether an
 * earlier send is still unverified (`unverified`, with the basis it was sent
 * on) and what the latest request returned (the settled outcome).
 *
 * - First send: success ends the intent; a refusal (4xx) of that very
 *   request, or a failure before anything was sent, returns to idle; any
 *   other failure makes the result unknown.
 * - Unknown: the only ways out are a same-key success (a replay of the
 *   committed write, or its first commit), a `stale_context` on the
 *   identical replay for an action in REPLAY_BEFORE_FRESHNESS (proof it never
 *   committed; it is then re-sent at the current head under the same key),
 *   or an explicit abandon. Any other refusal only fails this verification.
 * A page reload drops the record; the idempotency key goes with it.
 */
export class WriteIntentSlot {
  #discarded = false;
  #intent: Intent | undefined;
  #state: IntentState = "idle";
  #unverified = false;
  readonly #listeners = new Set<(state: IntentState) => void>();

  get state(): IntentState {
    return this.#state;
  }

  /** An earlier send of the current intent may have committed. */
  get unverified(): boolean {
    return this.#unverified;
  }

  /** The submitted intent while pending or unknown. */
  get current(): { action: string; key: string; payload: unknown } | undefined {
    const intent = this.#intent;
    return intent === undefined
      ? undefined
      : { action: intent.action, key: intent.key, payload: intent.payload };
  }

  onChange(listener: (state: IntentState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async submit<Payload, Result>(
    spec: IntentSpec<Payload, Result>,
  ): Promise<IntentOutcome<Result>> {
    if (this.#state !== "idle") return { kind: "busy", state: this.#state };
    const payload = deepFreeze(structuredClone(spec.payload));
    const key = newIdempotencyKey(spec.action);
    const staleProvesUncommitted =
      REPLAY_BEFORE_FRESHNESS[spec.action] !== undefined;
    // Basis of the send whose result is unverified; replays use exactly it.
    let unverifiedSeq: number | undefined;
    const attempt = async (basedOnRoomSeq: number): Promise<Result> => {
      try {
        return await spec.send(payload, basedOnRoomSeq, key);
      } catch (error) {
        if (!this.#unverified && classifyWriteFailure(error) === "unknown") {
          this.#unverified = true;
          unverifiedSeq = basedOnRoomSeq;
        }
        throw error;
      }
    };
    const run = async (): Promise<Result> => {
      if (this.#unverified && unverifiedSeq !== undefined) {
        // Replay the identical request first: a committed write returns its
        // recorded result.
        try {
          return await spec.send(payload, unverifiedSeq, key);
        } catch (error) {
          if (!isStaleContext(error) || !staleProvesUncommitted) throw error;
          // Replay-before-freshness: the original never committed.
          this.#unverified = false;
          unverifiedSeq = undefined;
        }
      }
      return await runRoomMutationAtLatest({
        maxAttempts: STALE_RETRY_ATTEMPTS,
        mutate: attempt,
        session: spec.session,
      });
    };
    const execute = async (): Promise<IntentOutcome<Result>> => {
      const verifying = this.#unverified;
      this.#set("pending");
      let outcome: IntentOutcome<Result>;
      try {
        outcome = { kind: "ok", result: await run() };
        this.#unverified = false;
      } catch (error) {
        outcome = this.#unverified
          ? {
              error,
              kind: "unknown",
              verificationFailed:
                verifying &&
                (classifyWriteFailure(error) === "rejected" ||
                  isStaleContext(error)),
            }
          : { kind: "rejected", error };
      }
      if (outcome.kind === "unknown") this.#set("unknown");
      else {
        this.#intent = undefined;
        this.#set("idle");
      }
      spec.onSettled?.(outcome);
      return outcome;
    };
    this.#intent = { action: spec.action, execute, key, payload };
    return await execute();
  }

  /**
   * An intent whose freshness is an `expectedRevision` inside the frozen
   * payload instead of a Room basis (channel memory changes and switches).
   * Same slot semantics: one key and payload across verification; a first
   * send's 4xx (a revision mismatch is 409) is a refusal, anything else
   * leaves the result unknown until a same-key success or an abandon.
   */
  async submitRevisioned<Payload, Result>(spec: {
    action: string;
    onSettled?: (outcome: IntentOutcome<Result>) => void;
    payload: Payload;
    send: (
      payload: Readonly<Payload>,
      idempotencyKey: string,
    ) => Promise<Result>;
  }): Promise<IntentOutcome<Result>> {
    return await this.submit({
      action: spec.action,
      ...(spec.onSettled === undefined ? {} : { onSettled: spec.onSettled }),
      payload: spec.payload,
      send: (payload, _basedOnRoomSeq, idempotencyKey) =>
        spec.send(payload, idempotencyKey),
      session: NO_ROOM_BASIS,
    });
  }

  /** Re-sends the unknown intent unchanged (verification). */
  async retry(): Promise<IntentOutcome<unknown>> {
    const intent = this.#intent;
    if (this.#state !== "unknown" || intent === undefined) {
      return { kind: "busy", state: this.#state };
    }
    return await intent.execute();
  }

  /** The Human gives up verifying an unknown intent. */
  abandon(): boolean {
    if (this.#state !== "unknown") return false;
    this.#intent = undefined;
    this.#unverified = false;
    this.#set("idle");
    return true;
  }

  /** Leaves the leave-page registry for good (its view is gone). */
  discard(): void {
    this.#discarded = true;
    unresolved.delete(this);
  }

  #set(state: IntentState): void {
    this.#state = state;
    if (state === "idle" || this.#discarded) unresolved.delete(this);
    else unresolved.add(this);
    for (const listener of this.#listeners) listener(state);
  }
}

/**
 * One in-flight action per surface. Buttons and keyboard submission both go
 * through `run`, so a pending action refuses either path equally.
 */
export class ActionGate {
  #pending = false;
  readonly #listeners = new Set<(pending: boolean) => void>();

  get pending(): boolean {
    return this.#pending;
  }

  onChange(listener: (pending: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async run<Result>(task: () => Promise<Result>): Promise<Result | undefined> {
    if (this.#pending) return undefined;
    this.#set(true);
    try {
      return await task();
    } finally {
      this.#set(false);
    }
  }

  #set(pending: boolean): void {
    this.#pending = pending;
    for (const listener of this.#listeners) listener(pending);
  }
}

/** Room composer: Enter sends, Shift+Enter is a newline, IME never sends. */
export function composerKeyAction(event: {
  isComposing: boolean;
  key: string;
  keyCode: number;
  shiftKey: boolean;
}): "submit" | "newline" | "ignore" {
  if (event.key !== "Enter") return "ignore";
  if (event.isComposing || event.keyCode === 229) return "ignore";
  return event.shiftKey ? "newline" : "submit";
}

type SchemaIssues = {
  issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>;
};

function issues(error: SchemaIssues): string {
  return error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join(".")}: ${issue.message}`,
    )
    .join("；");
}

export function parseAttachedDirectoryLines(text: string): Checked<string[]> {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed = ChannelAttachedDirectoriesSchema.safeParse(lines);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `附加目录无效：${issues(parsed.error)}` };
}

export type MentionTarget = { handle: string; participantId: string };

export function buildMessagePost(
  text: string,
  mention: MentionTarget | undefined,
): Checked<{
  body: string;
  recipients: Array<{ participantId: string; reason: "mention" }>;
}> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: "消息不能为空" };
  if (mention === undefined) {
    return { ok: true, value: { body: trimmed, recipients: [] } };
  }
  const token = `@${mention.handle}`;
  const mentioned = new RegExp(
    `(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[\\s,.!?:;，。！？：；])`,
    "u",
  ).test(trimmed);
  return {
    ok: true,
    value: {
      body: mentioned ? trimmed : `${token} ${trimmed}`,
      recipients: [{ participantId: mention.participantId, reason: "mention" }],
    },
  };
}

export type BindingChoice = {
  label: string;
  modelBindingId: string;
  reasoning: string[];
};

export type RuntimeChoice = {
  bindings: BindingChoice[];
  label: string;
  runtimeOfferId: string;
};

/** Only offers the Host published, with the bindings it published for them. */
export function runtimeChoices(
  inventory: LocalRuntimeInventoryResponse,
): RuntimeChoice[] {
  return inventory.runtimes.flatMap((runtime) =>
    runtime.available && runtime.runtimeOfferId !== undefined
      ? [
          {
            bindings: runtime.modelBindingDescriptors.map((binding) => ({
              label: `${binding.displayName ?? binding.modelId}（${binding.modelBindingId}）`,
              modelBindingId: binding.modelBindingId,
              reasoning: [...binding.supportedReasoning],
            })),
            label: `${runtime.displayName}${runtime.version === undefined ? "" : ` ${runtime.version}`}（${runtime.runtimeOfferId}）`,
            runtimeOfferId: runtime.runtimeOfferId,
          },
        ]
      : [],
  );
}

export type RoleForm = {
  displayName: string;
  handle: string;
  instructions: string;
  modelBindingId: string;
  reasoning: string;
  role: string;
  runtimeOfferId: string;
};

type RoleConfiguration = RoleCreateRequest["configuration"];

/** The editable fields of an existing Role configuration (for role.revise). */
export function roleFormFrom(configuration: RoleConfiguration): RoleForm {
  return {
    displayName: configuration.displayName,
    handle: configuration.handle,
    instructions:
      configuration.role === configuration.displayName ||
      configuration.role === configuration.instructions
        ? configuration.instructions
        : `${configuration.role}\n\n${configuration.instructions}`,
    modelBindingId: configuration.modelIntent.exactBindingIds?.[0] ?? "",
    reasoning: configuration.modelIntent.reasoning ?? "",
    role: configuration.displayName,
    runtimeOfferId: configuration.runtimeOfferId,
  };
}

/**
 * `base` (a revision) keeps every configuration field the console does not
 * edit; the model intent is replaced by the exact published binding.
 */
export function buildRoleConfiguration(
  form: RoleForm,
  choices: readonly RuntimeChoice[],
  base?: RoleConfiguration,
): Checked<RoleConfiguration> {
  const runtime = choices.find(
    ({ runtimeOfferId }) => runtimeOfferId === form.runtimeOfferId,
  );
  if (runtime === undefined) {
    return { ok: false, error: "请选择 Host 已发布的 CLI" };
  }
  const binding = runtime.bindings.find(
    ({ modelBindingId }) => modelBindingId === form.modelBindingId,
  );
  if (binding === undefined) {
    return { ok: false, error: "请选择该 CLI 目录中已发布的模型" };
  }
  if (
    binding.reasoning.length > 0 &&
    !binding.reasoning.includes(form.reasoning)
  ) {
    return { ok: false, error: "请选择该模型发布的推理强度" };
  }
  const parsed = RoleConfigurationSchema.safeParse({
    ...base,
    displayName: form.displayName.trim(),
    handle: form.handle.trim(),
    instructions: form.instructions.trim(),
    modelIntent: {
      exactBindingIds: [binding.modelBindingId],
      fallback: "disabled",
      ...(binding.reasoning.length === 0 ? {} : { reasoning: form.reasoning }),
    },
    role: form.displayName.trim(),
    runtimeOfferId: runtime.runtimeOfferId,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `Role 配置无效：${issues(parsed.error)}` };
}

export function activeWorkHint(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("active collaboration work")
    ? "该实例在本频道或其私聊里仍有未结束的工作（排队或运行中的激活、未完成的任务、待回答的输入或定时提醒）。可先等它完成，或使用频道急停后再移除；任务需先完成或取消。"
    : null;
}

export type SettingsForm = {
  maxConcurrentRuns: string;
  maxConcurrentStarts: string;
  maxRunMinutes: string;
  minStartIntervalMs: string;
  noProgressWarnMinutes: string;
  queuedStallTerminateMinutes: string;
  /** Owner 2026-09-27: "1" prewarm on instance creation, "0" off. */
  prewarmEnabled: string;
  /** Daemon-start prewarm window in hours (0: none). */
  prewarmRecentHours: string;
  /** runtimeProfileId -> per-CLI run cap. */
  runtimes: Record<string, string>;
  wakeChainLimit: string;
};

const MINUTE_MS = 60_000;

/**
 * When a saved value takes effect (daemon-runtime-settings apply +
 * agent-host run-watchdog): concurrency, start pacing and the wake-chain
 * limit only steer later scheduling; watchdog thresholds are read on every
 * supervision tick, so they apply to runs already in progress.
 */
export function settingScope(key: keyof SettingsForm): "future" | "immediate" {
  return key === "noProgressWarnMinutes" ||
    key === "queuedStallTerminateMinutes" ||
    key === "maxRunMinutes"
    ? "immediate"
    : "future";
}

export const SETTINGS_SCOPE_NOTES = {
  future:
    "并发上限、启动限流与唤醒上限只影响之后的调度决定；已开始的运行照常进行（调低并发上限不会中断它们，只是之后少放行）。",
  immediate:
    "看门狗阈值保存后立即适用于正在运行的工作：调低单次运行时长上限或排队时无进展终止阈值，已超过新阈值的运行会在下一次看门狗检查时被终止（有终止证明），并在同一 session 上续接这一轮；告警阈值只影响告警。",
} as const;

export function settingsFormFrom(settings: RuntimeSettings): SettingsForm {
  return {
    maxConcurrentRuns: String(settings.maxConcurrentRuns),
    maxConcurrentStarts: String(settings.maxConcurrentStarts),
    maxRunMinutes: String(settings.watchdog.maxRunMs / MINUTE_MS),
    minStartIntervalMs: String(settings.minStartIntervalMs),
    noProgressWarnMinutes: String(
      settings.watchdog.noProgressWarnMs / MINUTE_MS,
    ),
    queuedStallTerminateMinutes: String(
      settings.watchdog.queuedStallTerminateMs / MINUTE_MS,
    ),
    prewarmEnabled: settings.prewarm.enabled ? "1" : "0",
    prewarmRecentHours: String(settings.prewarm.recentActiveHours),
    runtimes: Object.fromEntries(
      settings.runtimes.map((runtime) => [
        runtime.runtimeProfileId,
        String(runtime.maxConcurrentRuns),
      ]),
    ),
    wakeChainLimit: String(settings.wakeGuard.instanceChainLimit),
  };
}

/**
 * Sends only the fields that differ from the revision the form was built
 * from, with that revision as `expectedRevision`; a newer server revision is
 * a conflict the Human resolves by re-reading.
 */
export function buildSettingsUpdate(
  base: RuntimeSettings,
  form: SettingsForm,
): Checked<RuntimeSettingsUpdate> {
  const numbers: string[] = [];
  const number = (label: string, value: string, scale = 1): number => {
    const trimmed = value.trim();
    const parsed = /^\d+(\.\d+)?$/u.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isFinite(parsed)) numbers.push(label);
    return Math.round(parsed * scale * 1_000) / 1_000;
  };
  const update: RuntimeSettingsUpdate = { expectedRevision: base.revision };
  const maxConcurrentRuns = number("本机同时运行上限", form.maxConcurrentRuns);
  if (maxConcurrentRuns !== base.maxConcurrentRuns) {
    update.maxConcurrentRuns = maxConcurrentRuns;
  }
  const maxConcurrentStarts = number("同时启动上限", form.maxConcurrentStarts);
  if (maxConcurrentStarts !== base.maxConcurrentStarts) {
    update.maxConcurrentStarts = maxConcurrentStarts;
  }
  const minStartIntervalMs = number("启动最小间隔", form.minStartIntervalMs);
  if (minStartIntervalMs !== base.minStartIntervalMs) {
    update.minStartIntervalMs = minStartIntervalMs;
  }
  const runtimes = base.runtimes.flatMap((runtime) => {
    const value = number(
      `CLI ${runtime.runtimeProfileId} 同时运行上限`,
      form.runtimes[runtime.runtimeProfileId] ?? "",
    );
    return value === runtime.maxConcurrentRuns
      ? []
      : [
          {
            maxConcurrentRuns: value,
            runtimeProfileId: runtime.runtimeProfileId,
          },
        ];
  });
  if (runtimes.length > 0) update.runtimes = runtimes;
  const chain = number("实例互相唤醒上限", form.wakeChainLimit);
  if (chain !== base.wakeGuard.instanceChainLimit) {
    update.wakeGuard = { instanceChainLimit: chain };
  }
  const watchdog: NonNullable<RuntimeSettingsUpdate["watchdog"]> = {};
  const warn = number("无进展告警阈值", form.noProgressWarnMinutes, MINUTE_MS);
  if (warn !== base.watchdog.noProgressWarnMs) watchdog.noProgressWarnMs = warn;
  const stall = number(
    "排队时无进展终止阈值",
    form.queuedStallTerminateMinutes,
    MINUTE_MS,
  );
  if (stall !== base.watchdog.queuedStallTerminateMs) {
    watchdog.queuedStallTerminateMs = stall;
  }
  const maxRun = number("单次运行时长上限", form.maxRunMinutes, MINUTE_MS);
  if (maxRun !== base.watchdog.maxRunMs) watchdog.maxRunMs = maxRun;
  if (Object.keys(watchdog).length > 0) update.watchdog = watchdog;
  const prewarm: NonNullable<RuntimeSettingsUpdate["prewarm"]> = {};
  const enabledText = form.prewarmEnabled.trim();
  if (enabledText !== "0" && enabledText !== "1")
    numbers.push("实例创建即预热（1 开，0 关）");
  const enabled = enabledText === "1";
  if (enabled !== base.prewarm.enabled) prewarm.enabled = enabled;
  const recent = number("启动后预热窗口", form.prewarmRecentHours);
  if (recent !== base.prewarm.recentActiveHours)
    prewarm.recentActiveHours = recent;
  if (Object.keys(prewarm).length > 0) update.prewarm = prewarm;
  if (numbers.length > 0) {
    return { ok: false, error: `不是有效数字：${numbers.join("、")}` };
  }
  if (Object.keys(update).length === 1) {
    return { ok: false, error: "没有修改" };
  }
  const parsed = RuntimeSettingsUpdateSchema.safeParse(update);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `设置无效：${issues(parsed.error)}` };
}

export function isSettingsConflict(error: unknown): boolean {
  return error instanceof RahClientError && error.status === 409;
}

export type SosState =
  | { kind: "unknown"; label: string }
  | {
      kind: "stopping" | "stopped" | "running";
      label: string;
      roomSeq: number;
    };

/** Newest SOS fact in the synced event window decides the Channel's state. */
export function sosState(events: readonly RoomEvent[]): SosState {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    switch (event.type) {
      case "room.agent_sos_requested":
        return {
          kind: "stopping",
          label: "急停中（等待运行终止证明）",
          roomSeq: event.roomSeq,
        };
      case "room.agent_sos_stopped":
        return { kind: "stopped", label: "已急停", roomSeq: event.roomSeq };
      case "room.agent_sos_resumed":
        return {
          kind: "running",
          label: "运行中（已恢复）",
          roomSeq: event.roomSeq,
        };
      default:
        break;
    }
  }
  return { kind: "unknown", label: "急停状态未知（当前事件窗口无记录）" };
}

const LIFECYCLE_LABELS: Record<string, string> = {
  "instance.activation_abandoned": "Human 放弃了被阻塞的激活（执行通道已释放）",
  "instance.created": "实例加入频道",
  "instance.session_reset": "实例 session 已重置（之后的运行使用新 session）",
  "membership.added": "成员加入",
  "membership.removed": "成员移出",
  "room.agent_sos_requested": "请求急停",
  "room.agent_sos_resumed": "急停已恢复",
  "room.agent_sos_stopped": "急停完成",
};

export type LifecycleEvent = {
  actorId: string;
  createdAt: string;
  label: string;
  roomSeq: number;
  subject: string | null;
  type: string;
};

export function lifecycleEvents(
  events: readonly RoomEvent[],
  limit = 10,
): LifecycleEvent[] {
  const result: LifecycleEvent[] = [];
  for (
    let index = events.length - 1;
    index >= 0 && result.length < limit;
    index -= 1
  ) {
    const event = events[index]!;
    const label = LIFECYCLE_LABELS[event.type];
    if (label === undefined) continue;
    const payload = event.payload;
    const subject =
      typeof payload.instanceId === "string"
        ? payload.instanceId
        : typeof payload.participantId === "string"
          ? payload.participantId
          : null;
    result.push({
      actorId: event.actorId,
      createdAt: event.createdAt,
      label:
        event.type === "instance.session_reset" &&
        typeof payload.sessionGeneration === "number"
          ? `${label}，session 代数 ${String(payload.sessionGeneration)}`
          : label,
      roomSeq: event.roomSeq,
      subject,
      type: event.type,
    });
  }
  return result;
}
