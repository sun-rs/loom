import test from "node:test";
import assert from "node:assert/strict";
import {
  readRegion,
  saveRegion,
} from "../../frontends/raft/loom/region-preferences.ts";
test("region preferences preserve timezone/time format and reject invalid values", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
  };
  assert.deepEqual(readRegion(storage), { timezone: null, timeFormat: null });
  saveRegion(storage, { timezone: "Asia/Shanghai", timeFormat: "24h" });
  assert.deepEqual(readRegion(storage), {
    timezone: "Asia/Shanghai",
    timeFormat: "24h",
  });
  assert.throws(() =>
    saveRegion(storage, { timezone: "not/a-zone", timeFormat: "24h" }),
  );
  assert.equal(readRegion(storage).timezone, "Asia/Shanghai");
});
test("failed persistence is not reported as a saved preference; corrupt values fall back", () => {
  assert.throws(() =>
    saveRegion(
      {
        setItem() {
          throw Error("quota");
        },
      },
      { timezone: "UTC", timeFormat: "12h" },
    ),
  );
  assert.deepEqual(readRegion({ getItem: () => "{broken" }), {
    timezone: null,
    timeFormat: null,
  });
});
