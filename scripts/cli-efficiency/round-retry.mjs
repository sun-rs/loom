// Efficiency gate: one human question may take more than one RunAttempt when
// the Kernel retries an Activation (for example a first attempt that answered
// in plain text without posting). Such a round is a visible, counted soft
// item (`retried`): its usage and generations are the sum over every attempt,
// so the retry shows as extra generations / latency over budget, never as a
// harness abort that drops the later rounds. The drift gate's
// `retried → violated` verdict is the same rule. Pure helpers; rah.mjs
// supplies the evidence.

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Verdict of one round's durable evidence.
 * - runs: this round's RunAttempts ({ state, exitCode, succeeded }).
 * - replies: this participant's new Room messages ({ roomId?, threadId? }).
 * - activations: every Activation of the Room ({ state }).
 * - finalInterrupts: product `finalInterrupt` per run (null = no `final`
 *   post, undefined = not collected).
 * - roomId: the round's Channel.
 *
 * A single-run round keeps the historical checks. A retried round is soft
 * only when, after all attempts, there is exactly one reply, on target, it
 * was the `final` reply, every Activation completed (ACK through its head)
 * and nothing was quarantined; otherwise it is a hard failure.
 */
export function roundRunVerdict({
  runs,
  replies,
  activations,
  finalInterrupts,
  roomId,
}) {
  const failures = [];
  const attempts = runs.length;
  const retried = attempts > 1;
  if (attempts === 0) failures.push("runMissing");
  if (activations.some((a) => a.state === "quarantined"))
    failures.push("quarantined");
  if (
    activations.length === 0 ||
    !activations.every((a) => a.state === "completed")
  )
    failures.push("ackIncomplete");
  if (!runs.every((r) => r.succeeded === true)) failures.push("runFailed");
  if (replies.length === 0) failures.push("noReply");
  if (retried) {
    if (replies.length > 1) failures.push("duplicateReply");
    if (
      replies.some(
        (m) =>
          (m.roomId !== undefined && m.roomId !== roomId) ||
          (m.threadId !== undefined && m.threadId !== null),
      )
    )
      failures.push("wrongTarget");
    const finals = finalInterrupts.filter(
      (f) => f !== null && typeof f === "object",
    );
    if (finals.length !== 1) failures.push("finalMissing");
  }
  return { attempts, retried, failures };
}

const COMPLETENESS_ORDER = ["complete", "partial", "unavailable"];

/**
 * The product usage reads of every RunAttempt of one round, merged into one
 * read of the same shape: generations concatenated (oldest first), totals
 * summed (null when any attempt's total is unknown), completeness the worst
 * of them, gaps concatenated. `execution` and `sessionResumeMs` come from the
 * first attempt (the one that started the round's runtime segment); the
 * final interrupt is the single committed one, else null only when every
 * attempt reported none.
 */
export function mergeRoundProductUsage(usages) {
  if (!Array.isArray(usages) || usages.length === 0)
    throw new Error("mergeRoundProductUsage needs at least one usage read");
  if (usages.length === 1) return usages[0];
  const totals = {};
  for (const key of Object.keys(usages[0].totals ?? {})) {
    const values = usages.map((u) => u.totals?.[key]);
    totals[key] = values.every(finite)
      ? values.reduce((a, b) => a + b, 0)
      : null;
  }
  const completeness = usages
    .map((u) => u.completeness ?? "unavailable")
    .reduce((worst, c) =>
      COMPLETENESS_ORDER.indexOf(c) > COMPLETENESS_ORDER.indexOf(worst)
        ? c
        : worst,
    );
  const finals = usages
    .map((u) => u.finalInterrupt)
    .filter((f) => f !== null && typeof f === "object");
  const finalInterrupt =
    finals.length > 0
      ? finals.at(-1)
      : usages.every((u) => u.finalInterrupt === null)
        ? null
        : undefined;
  return {
    runAttemptIds: usages.map((u) => u.runAttemptId),
    completeness,
    gaps: usages.flatMap((u) => u.gaps ?? []),
    generations: usages.flatMap((u) => u.generations ?? []),
    totals,
    truncated: usages.some((u) => u.truncated === true),
    execution: usages[0].execution ?? null,
    sessionResumeMs: usages[0].sessionResumeMs ?? null,
    ...(finalInterrupt === undefined ? {} : { finalInterrupt }),
  };
}
