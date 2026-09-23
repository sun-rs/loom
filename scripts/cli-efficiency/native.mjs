import { isEffectiveAnswer } from "./metrics.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { model, effort, measure } from "./common.mjs";
// Installed CLI directly; no RAH worker, scheduler or runtime adapter in this arm.
export async function nativeRound({ cwd, sessionId, prompt, save, round }) {
  round.startedAt = new Date().toISOString();
  let buf = "",
    finalAt,
    answer,
    seenId = sessionId,
    stderr = "";
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-c",
    "features.memories=false",
    "-c",
    "memories.generate_memories=false",
    "-c",
    "memories.use_memories=false",
    ...(sessionId ? ["resume", sessionId] : []),
    prompt,
  ];
  const child = spawn("codex", args, {
    cwd,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("RAH_")),
    ),
    stdio: ["ignore", "pipe", "pipe"],
  });
  round.pid = child.pid;
  save();
  const timer = setTimeout(() => {
    round.timeout = true;
    child.kill("SIGTERM");
  }, 240000);
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 250000);
  child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-1500)));
  child.stdout.on("data", (b) => {
    buf += b;
    let n;
    while ((n = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, n);
      buf = buf.slice(n + 1);
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.thread_id) {
        if (seenId) assert.equal(e.thread_id, seenId);
        seenId = e.thread_id;
      }
      if (e.type === "item.completed" && e.item.type === "agent_message") {
        answer = e.item.text;
        finalAt = Date.now();
      }
    }
  });
  try {
    round.exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    round.finishedAt = new Date().toISOString();
    round.sessionId = seenId;
    round.answer = answer;
    round.stderr = stderr;
    save();
  }
  assert.equal(round.exit, 0, "Native CLI failed");
  assert.ok(answer && finalAt, "Missing final answer");
  round.replySeconds = (finalAt - Date.parse(round.startedAt)) / 1000;
  round.metrics = measure(seenId, round);
  save();
  assert.ok(
    isEffectiveAnswer(answer),
    "Missing effective final answer; retain cost evidence",
  );
  save();
  return seenId;
}
