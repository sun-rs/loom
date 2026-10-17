import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readActivityPosition,
  writeActivityPosition,
} from "../../frontends/raft/loom/activity-position.ts";
const memory = () => {
  const m = new Map();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => m.set(k, v),
  };
};
test("refresh restores bounded depth and offset, isolated by human/workspace/filter, no content", () => {
  const s = memory();
  writeActivityPosition(s, "human/workspace/filter", { depth: 3, top: 840 });
  assert.deepEqual(readActivityPosition(s, "human/workspace/filter"), {
    depth: 3,
    top: 840,
  });
  assert.deepEqual(readActivityPosition(s, "other/workspace/filter"), {
    depth: 1,
    top: 0,
  });
  writeActivityPosition(s, "human/workspace/filter", { depth: 999, top: -1 });
  assert.deepEqual(readActivityPosition(s, "human/workspace/filter"), {
    depth: 10,
    top: 0,
  });
});
test("malformed data or denied storage falls back without blocking activity", () => {
  assert.deepEqual(readActivityPosition({ getItem: () => "{broken" }, "x"), {
    depth: 1,
    top: 0,
  });
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  assert.deepEqual(readActivityPosition(denied, "x"), { depth: 1, top: 0 });
  assert.doesNotThrow(() =>
    writeActivityPosition(denied, "x", { depth: 2, top: 4 }),
  );
});
