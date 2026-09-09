import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  cliPath,
  parseWorkerCliCommands,
  parseWorkerRoutes,
  readRoutePath,
  registryPath,
  routePath,
  validateRegistry,
} from "./raft-parity-registry.mjs";

const repositoryDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (path) => readFileSync(join(repositoryDirectory, path));
const registry = () =>
  JSON.parse(readFileSync(join(repositoryDirectory, registryPath), "utf8"));

// A reader that serves the real tree unless a test overrides one file.
const reader =
  (overrides = {}) =>
  (path) =>
    Object.hasOwn(overrides, path) ? Buffer.from(overrides[path]) : file(path);

const noUpstream = {
  openUpstream: () => {
    throw new Error("absent");
  },
};

test("the committed registry passes on the current tree", () => {
  const result = validateRegistry(registry(), reader());

  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.unjustified, registry().ratchet.unjustified);
  assert.equal(
    result.counts.missingNonDeferred,
    registry().ratchet.missingNonDeferred,
  );
  assert.ok(
    result.judgmentPresent <= registry().ratchet.promptJudgmentParagraphs,
  );
});

test("every worker CLI command and HTTP route is registered", () => {
  const commands = parseWorkerCliCommands(file(cliPath).toString());
  const routes = parseWorkerRoutes(
    file(routePath).toString(),
    file(readRoutePath).toString(),
  );
  const symbols = new Set(
    registry()
      .entries.filter((entry) => entry.rah?.symbol)
      .map((entry) => entry.rah.symbol),
  );

  assert.ok(commands.includes("worker message-post"));
  assert.ok(routes.includes("/v1/worker/messages/post"));
  assert.ok(routes.includes("/v1/worker/tasks/list"));
  for (const surface of [...commands, ...routes])
    assert.ok(symbols.has(surface));
});

test("an unregistered CLI command fails as an undeclared surface", () => {
  const source = file(cliPath)
    .toString()
    .replace('case "sync":', 'case "invented-command":\n    case "sync":');
  const result = validateRegistry(
    registry(),
    reader({ [cliPath]: source }),
    noUpstream,
  );

  assert.ok(
    result.errors.includes(
      "undeclared agent-facing surface: rah worker invented-command",
    ),
    result.errors.join("\n"),
  );
});

test("an unregistered HTTP route fails as an undeclared surface", () => {
  const source = file(routePath)
    .toString()
    .replace(
      '"/v1/worker/sync",',
      '"/v1/worker/invented",\n  "/v1/worker/sync",',
    );
  const result = validateRegistry(
    registry(),
    reader({ [routePath]: source }),
    noUpstream,
  );

  assert.ok(
    result.errors.includes(
      "undeclared agent-facing surface: /v1/worker/invented",
    ),
    result.errors.join("\n"),
  );
});

test("a justified entry without a constraint fails", () => {
  const mutated = registry();
  const entry = mutated.entries.find((row) => row.verdict === "justified");
  delete entry.constraint;
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith(`${entry.id}: justified entry requires a constraint`),
    ),
    result.errors.join("\n"),
  );
});

test("a deferred missing entry without a constraint fails", () => {
  const mutated = registry();
  const entry = mutated.entries.find(
    (row) => row.verdict === "missing" && row.deferred === true,
  );
  delete entry.constraint;
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith(`${entry.id}: deferred missing entry requires`),
    ),
    result.errors.join("\n"),
  );
});

test("a free-text constraint fails", () => {
  const mutated = registry();
  const entry = mutated.entries.find((row) => row.verdict === "justified");
  entry.constraint = "because the agent preferred it";
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith(
        `${entry.id}: constraint "because the agent preferred it" is not one of`,
      ),
    ),
    result.errors.join("\n"),
  );
});

test("exceeding the unjustified ratchet fails", () => {
  const mutated = registry();
  mutated.ratchet.unjustified -= 1;
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith("unjustified divergences rose to"),
    ),
    result.errors.join("\n"),
  );
});

test("exceeding the non-deferred missing ratchet fails", () => {
  const mutated = registry();
  mutated.ratchet.missingNonDeferred -= 1;
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith("non-deferred missing surfaces rose to"),
    ),
    result.errors.join("\n"),
  );
});

test("exceeding the standing prompt judgment ratchet fails", () => {
  const mutated = registry();
  mutated.ratchet.promptJudgmentParagraphs = 1;
  const result = validateRegistry(mutated, reader(), noUpstream);

  assert.ok(
    result.errors.some((message) =>
      message.startsWith("standing prompt judgment paragraphs rose to"),
    ),
    result.errors.join("\n"),
  );
});

test("removing a judgment paragraph lowers the counted total", () => {
  const mutated = registry();
  const entry = mutated.entries.find(
    (row) => row.classification === "judgment",
  );
  const stripped = file("packages/daemon/src/standing-prompt-compiler.ts")
    .toString()
    .replaceAll(entry.rah.needles[0], "");
  const result = validateRegistry(
    mutated,
    reader({ "packages/daemon/src/standing-prompt-compiler.ts": stripped }),
    noUpstream,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(
    result.judgmentPresent,
    validateRegistry(registry(), reader(), noUpstream).judgmentPresent - 1,
  );
});

test("an absent upstream extraction skips anchor verification and still passes", () => {
  const result = validateRegistry(registry(), reader(), noUpstream);

  assert.deepEqual(result.errors, []);
  assert.equal(result.anchorsChecked, 0);
  assert.deepEqual(result.notices, [
    "upstream extraction not available; anchor verification skipped",
  ]);
});

test("a drifted upstream anchor is reported", () => {
  const mutated = registry();
  const entry = mutated.entries.find((row) => row.raft?.region);
  const original = entry.raft.region.sha256;
  entry.raft.region.sha256 = "0".repeat(64);
  const result = validateRegistry(mutated, reader());

  if (result.notices.length) {
    assert.deepEqual(result.errors, []);
    return;
  }
  assert.notEqual(entry.raft.region.sha256, original);
  assert.ok(
    result.errors.some((message) =>
      message.startsWith(`${entry.id}: upstream anchor drift`),
    ),
    result.errors.join("\n"),
  );
});
