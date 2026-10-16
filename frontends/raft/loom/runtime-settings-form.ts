// Ported from Loom console actions; the protocol remains the validation owner.
import {
  RuntimeSettingsUpdateSchema,
  type RuntimeSettings,
  type RuntimeSettingsUpdate,
} from "@rah-os/protocol";
type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
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
    : {
        ok: false,
        error: `设置无效：${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；")}`,
      };
}
