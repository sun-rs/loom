import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKER_HELP_TOPIC_NAMES,
  runWorkerCliCommand,
  workerHelpTopic,
} from "../src/index.ts";

function runtime() {
  let stdout = "";
  let stderr = "";
  return {
    runtime: {
      env: {},
      fetch: async () => {
        throw new Error("help must not reach the Worker API");
      },
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

test("worker help <topic> prints the on-demand topic without calling the Worker API", async () => {
  for (const topic of WORKER_HELP_TOPIC_NAMES) {
    const state = runtime();
    assert.equal(
      await runWorkerCliCommand(["worker", "help", topic], state.runtime),
      0,
      topic,
    );
    assert.equal(state.stdout(), `${workerHelpTopic(topic)!}\n`);
    assert.equal(state.stderr(), "");
  }
});

test("an unknown help topic is an argument error that lists the topics", async () => {
  const state = runtime();
  assert.equal(
    await runWorkerCliCommand(["worker", "help", "nope"], state.runtime),
    1,
  );
  assert.equal(state.stdout(), "");
  assert.match(state.stderr(), /Code: INVALID_ARG/u);
  for (const topic of WORKER_HELP_TOPIC_NAMES)
    assert.ok(state.stderr().includes(topic), topic);
});

test("bare worker help advertises the topic list", async () => {
  const state = runtime();
  assert.equal(await runWorkerCliCommand(["worker", "help"], state.runtime), 0);
  assert.ok(state.stdout().includes("loom-worker help <topic>"));
  for (const topic of WORKER_HELP_TOPIC_NAMES)
    assert.ok(state.stdout().includes(topic), topic);
});

test("help topics carry no credential transport detail", () => {
  for (const topic of WORKER_HELP_TOPIC_NAMES) {
    const text = workerHelpTopic(topic)!;
    assert.doesNotMatch(text, /RAH_WORKER_TOKEN|RAH_WORKER_API_URL/u, topic);
    assert.doesNotMatch(text, /\/v1\/worker|Authorization/u, topic);
    // The extra-turn drivers removed from the standing prompt do not return
    // through the help surface either.
    assert.doesNotMatch(text, /and then acknowledge/u, topic);
    assert.doesNotMatch(text, /still a separate obligation/u, topic);
    assert.doesNotMatch(text, /inspect every delivered/u, topic);
  }
});

test("D1-E: worker help tasks states the same claim rule as the standing protocol (read-only review/investigation is a reply)", () => {
  const tasks = workerHelpTopic("tasks")!;
  assert.doesNotMatch(tasks, /review a change/u);
  assert.doesNotMatch(tasks, /investigate an issue/u);
  assert.match(
    tasks,
    /Answering a question, brief discussion, searching or reading files is a reply, not a Task/u,
  );
});

test("contract §3: worker help threads states that @all / @所有人 addresses every other Room instance", () => {
  const topic = workerHelpTopic("threads");
  assert.ok(topic);
  assert.match(
    topic,
    /`@all` or `@所有人` addresses every other Agent member/u,
  );
});
