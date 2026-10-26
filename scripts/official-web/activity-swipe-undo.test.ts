import test from "node:test";
import assert from "node:assert/strict";
import { ActivitySwipeUndo } from "../../frontends/raft/loom/activity-swipe-undo.ts";
test("undo cancels before any durable action; stale toast cannot submit a replacement", () => {
  const sent: string[] = [];
  const pending = new ActivitySwipeUndo<string>(
    (x) => sent.push(x),
    () => {},
  );
  const a = pending.stage("a");
  pending.finish(a, false);
  assert.deepEqual(sent, []);
  const b = pending.stage("b");
  const c = pending.stage("c");
  assert.deepEqual(sent, ["b"]);
  pending.finish(b, true);
  assert.deepEqual(sent, ["b"]);
  pending.finish(c, true);
  pending.finish(c, true);
  assert.deepEqual(sent, ["b", "c"]);
});
test("new activity invalidates pending completion instead of completing the fresh row", () => {
  const sent: number[] = [];
  const pending = new ActivitySwipeUndo<number>(
    (x) => sent.push(x),
    () => {},
  );
  const token = pending.stage(40);
  pending.reconcile((x) => x === 41);
  pending.finish(token, true);
  assert.deepEqual(sent, []);
  const next = pending.stage(42);
  pending.flush();
  pending.finish(next, true);
  assert.deepEqual(sent, [42]);
});
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
test("toast binding defers the request, undo restores the row, and close submits once", () => {
  const text = readFileSync(
    "frontends/raft/loom/useActivitySwipeUndo.ts",
    "utf8",
  );
  const code = ts
    .transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/^import .*$/gm, "")
    .replace(
      "export function useActivitySwipeUndo",
      "function useActivitySwipeUndo",
    );
  const notices: any[] = [],
    sent: any[] = [],
    hidden: any[] = [],
    listeners = new Map();
  const scope = {
    ActivitySwipeUndo,
    useRef: (x: any) => ({ current: x }),
    useState: () => [undefined, (x: any) => hidden.push(x)],
    useCallback: (f: any) => f,
    useEffect: (f: any) => f(),
    document: {
      visibilityState: "visible",
      addEventListener: (k: any, v: any) => listeners.set(k, v),
      removeEventListener() {},
    },
    window: {
      addEventListener: (k: any, v: any) => listeners.set(k, v),
      removeEventListener() {},
    },
    toast: {
      success: (label: any, options: any) => {
        notices.push({ label, ...options });
        return String(notices.length);
      },
      dismiss() {},
    },
  };
  vm.createContext(scope);
  vm.runInContext(code + "\nthis.hook=useActivitySwipeUndo;", scope);
  const row = { id: "r", activityFrontier: { throughSeq: 10 } };
  const hook = (scope as any).hook([row], (x: any) => sent.push(x));
  hook.done(row);
  assert.equal(sent.length, 0);
  assert.equal(hidden.at(-1), "r");
  notices[0].action.onClick();
  notices[0].onClose();
  assert.equal(sent.length, 0);
  assert.equal(hidden.at(-1), undefined);
  hook.done(row);
  notices[1].onClose();
  notices[1].onClose();
  assert.deepEqual(sent, [row]);
  hook.done(row);
  scope.document.visibilityState = "hidden";
  listeners.get("visibilitychange")();
  notices[2].onClose();
  assert.equal(sent.length, 2);
});
