import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
for (const [file, hook, args] of [
  [
    "RolePresence.tsx",
    "useRolePresence",
    [
      [
        { instanceId: "a", channelId: "room" },
        { instanceId: "b", channelId: "room" },
      ],
      true,
    ],
  ],
  ["InstancePresence.tsx", "useInstancePresence", ["control", true]],
])
  test(
    file +
      " suspends background polling, aborts stale reads and refreshes on return",
    async () => {
      let visible = true,
        effect,
        cleanup,
        timers = new Set(),
        published = [];
      const calls = [];
      const client = {
        request: (_name, _input, { signal }) => {
          let resolve;
          const promise = new Promise((r) => (resolve = r));
          calls.push({ signal, resolve });
          return promise;
        },
      };
      const exports = {};
      const code = ts.transpileModule(
        readFileSync("frontends/raft/loom/" + file, "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        },
      ).outputText;
      vm.runInNewContext(code, {
        exports,
        AbortController,
        setTimeout: (f) => {
          timers.add(f);
          return f;
        },
        clearTimeout: (f) => timers.delete(f),
        require: (name) =>
          name === "react"
            ? {
                useEffect: (f) => (effect = f),
                useState: () => [[], (v) => published.push(v)],
              }
            : name.includes("usePageVisible")
              ? { usePageVisible: () => visible }
              : {},
      });
      const render = () => {
        cleanup?.();
        exports[hook](client, ...args);
        cleanup = effect();
      };
      render();
      assert.equal(calls.length, 1); // duplicate room members share one request
      visible = false;
      render();
      assert.equal(calls[0].signal.aborted, true);
      assert.equal(calls.length, 1);
      calls[0].resolve({ agents: [{ participantId: "stale" }] });
      await new Promise((r) => setImmediate(r));
      assert.equal(timers.size, 0);
      assert.ok(
        !published.some((v) => v.some((x) => x.participantId === "stale")),
      );
      visible = true;
      render();
      assert.equal(calls.length, 2);
      calls[1].resolve({ agents: [{ participantId: "fresh" }] });
      await new Promise((r) => setImmediate(r));
      assert.equal(timers.size, 1);
      assert.ok(
        published.some((v) => v.some((x) => x.participantId === "fresh")),
      );
      cleanup();
      assert.equal(timers.size, 0);
    },
  );
