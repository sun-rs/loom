import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerReadCommand } from "../src/worker-read-cli.ts";
import { runWorkerCliCommand } from "../src/worker-cli.ts";

test("the capability CLI exposes only an empty read command and advertises it in help", async () => {
  assert.deepEqual(parseWorkerReadCommand("attachment-capabilities", {}), {
    path: "/v1/worker/attachments/capabilities",
    body: {},
  });
  for (const options of [
    { "room-id": "other" },
    { "actor-id": "human" },
    { "max-bytes": "999" },
  ])
    assert.throws(
      () => parseWorkerReadCommand("attachment-capabilities", options),
      /unknown/u,
    );
  let output = "";
  assert.equal(
    await runWorkerCliCommand(["worker", "help"], {
      env: {},
      fetch: () => {
        throw new Error("help must not fetch");
      },
      stdout: {
        write(value: string) {
          output += value;
        },
      },
      stderr: { write() {} },
    }),
    0,
  );
  assert.match(output, /"\$RAH_WORKER_CLI" worker attachment-capabilities/u);
});
