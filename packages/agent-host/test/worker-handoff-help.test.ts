import assert from "node:assert/strict";
import test from "node:test";

import { runWorkerCliCommand } from "../src/index.ts";

test("ordinary message help and protocol explain explicit peer wake without a mandatory readback", async () => {
  for (const topic of ["messages", "protocol"]) {
    let output = "";
    const code = await runWorkerCliCommand(["worker", "help", topic], {
      env: {},
      fetch: async () => {
        throw new Error("static help must not call the API");
      },
      stdout: {
        write: (value: string) => {
          output += value;
        },
      },
      stderr: {
        write: (value: string) => {
          throw new Error(value);
        },
      },
    });
    assert.equal(code, 0);
    if (topic === "messages") {
      assert.match(output, /bare `@<handle>` in body/u);
      assert.match(output, /Names without @ do not wake/u);
      assert.match(output, /finish other current work, then end this turn/u);
      assert.match(
        output,
        /Addressed replies wake you automatically; do not poll/u,
      );
      assert.match(output, /publishes without ending execution/u);
      assert.ok(output.length < 1_600, "ordinary help stays bounded");
    } else {
      assert.match(
        output,
        /Address members with `@<handle>` in the `message-post` body/u,
      );
    }
    assert.match(output, /mention others, not yourself/iu);
    assert.doesNotMatch(output, /verify the handoff with message-check/u);
  }
});
