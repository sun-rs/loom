import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectInteractionSource } from "../../../scripts/inspect-raft-interactions.mjs";

test("source inventory records event expressions and exact locations, not a regex count or business proof", () => {
  const source =
    'import Panel from "./Panel-a.js";function Avatar(){return jsx("button",{onClick:()=>openPanel("activity"),onMouseEnter:show, onOpenChange:setOpen, title:"onClick: is not a handler"})}window.addEventListener("keydown",shortcut);';
  const result = inspectInteractionSource("fixture.js", source);
  assert.equal(result.events.length, 4);
  assert.deepEqual(
    result.events.map((e) => e.event),
    ["onClick", "onMouseEnter", "onOpenChange", "keydown"],
  );
  assert.equal(result.events[0].owner, "Avatar");
  assert.equal(result.events[0].handler, '()=>openPanel("activity")');
  assert.equal(
    result.events[0].source,
    source.slice(result.events[0].startUtf16, result.events[0].endUtf16),
  );
  assert.equal(result.events[0].line, 1);
  assert.deepEqual(result.assetReferences, ["./Panel-a.js"]);
  assert.equal(result.semanticCoverage, "not-evaluated");
});
test("inventory includes deferred chunks without claiming they are locally available", () => {
  const result = inspectInteractionSource(
    "entry.js",
    'const chunks=["assets/AgentDetail-123.js","assets/entry.css"];const labels=[".js","config.js"];const load=()=>import("./lazy.js");const x={"onContextMenu":menu,onKeyDown:key};',
  );
  assert.deepEqual(result.assetReferences, [
    "./lazy.js",
    "assets/AgentDetail-123.js",
    "assets/entry.css",
  ]);
  assert.equal(result.events.length, 2);
});

test("inventory CLI distinguishes missing chunks and refuses to overwrite frozen evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-interaction-inventory-"));
  try {
    await writeFile(
      join(directory, "entry.js"),
      'const deps=["assets/AgentDetail-abc.js"];const button={onClick:open};',
    );
    const output = join(directory, "evidence.json");
    const args = [
      fileURLToPath(
        new URL(
          "../../../scripts/inspect-raft-interactions.mjs",
          import.meta.url,
        ),
      ),
      directory,
      output,
    ];
    execFileSync(process.execPath, args, { stdio: "pipe" });
    const evidence = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(evidence.summary.missingReferencedJs, [
      "AgentDetail-abc.js",
    ]);
    assert.equal(evidence.summary.eventSites, 1);
    assert.throws(() =>
      execFileSync(process.execPath, args, { stdio: "pipe" }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
