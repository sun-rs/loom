// Isolated use of an unchanged, pinned MIT upstream parser. Not product code.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [source, file, output] = process.argv.slice(2);
assert.equal(
  execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  "29885e06a33695f666be3e2fcfd92760c8e0448b",
);
const { projectAgentTrajectory } = await import(
  pathToFileURL(source + "/server/src/agent/session-trajectory.ts").href
);
const records = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const projected = projectAgentTrajectory(
  "pi",
  { path: file, mtimeMs: statSync(file).mtimeMs },
  records,
);
assert.equal(projected.session_id, records[0].id);
const users = records.filter((x) => x.message?.role === "user");
const finals = records.filter(
  (x) => x.message?.role === "assistant" && x.message.stopReason === "stop",
);
assert.equal(
  projected.steps.filter((x) => x.source === "user").length,
  users.length,
);
assert.equal(
  projected.steps.filter(
    (x) => x.source === "agent" && x.message === "Fixture task completed.",
  ).length,
  finals.length,
);
writeFileSync(
  output,
  JSON.stringify(
    {
      sourceRevision: "29885e06a33695f666be3e2fcfd92760c8e0448b",
      license: "MIT",
      sourceUnmodified: true,
      agent: "pi",
      nativeSessionId: records[0].id,
      userCount: users.length,
      finalCount: finals.length,
      projection: projected,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    session: projected.session_id,
    users: users.length,
    finals: finals.length,
  }),
);
