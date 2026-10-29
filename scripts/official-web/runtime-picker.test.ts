import test from "node:test";
import assert from "node:assert/strict";
import { runtimePickerOptions } from "../../frontends/raft/loom/runtime-picker.ts";
test("runtime picker groups only verified Host offers and keeps unavailable rows unselectable", () => {
  const rows: any[] = [
    {
      cliId: "codex",
      displayName: "Codex CLI",
      available: true,
      configured: true,
      runtimeOfferId: "opaque-c",
      modelBindingDescriptors: [{}],
    },
    {
      cliId: "kimi",
      displayName: "Kimi CLI",
      available: false,
      configured: false,
      source: "discovered",
      modelBindingDescriptors: [],
    },
    {
      cliId: "claude",
      displayName: "Claude Code",
      available: true,
      configured: false,
      modelBindingDescriptors: [],
    },
  ];
  const options = runtimePickerOptions(rows, [
    { runtimeOfferId: "opaque-c" },
  ] as any);
  assert.deepEqual(
    options.map((x) => x.group),
    ["此计算机上已就绪", "此计算机上不可用", "此计算机未安装"],
  );
  assert.equal(options[0]?.value, "opaque-c");
  assert.equal(options[0]?.disabled, false);
  assert.ok(options.slice(1).every((x) => x.disabled));
  assert.ok(
    options.every((x) => !JSON.stringify(x).includes("已登录")),
    "PATH/model probing is not authentication proof",
  );
  assert.equal(
    runtimePickerOptions(
      rows,
      [{ runtimeOfferId: "opaque-c" }] as any,
      "opaque-c",
    )[0]?.group,
    "当前运行时",
  );
});
test("configured capability suppresses the unbound discovery duplicate without guessing opaque IDs", () => {
  const rows: any[] = [
    {
      cliId: "codex",
      executable: "codex",
      displayName: "Codex CLI",
      available: true,
      configured: true,
      runtimeOfferId: "opaque",
      modelBindingDescriptors: [{}],
    },
    {
      cliId: "codex",
      executable: "codex",
      displayName: "Codex",
      available: false,
      configured: false,
      source: "discovered",
      modelBindingDescriptors: [],
    },
  ];
  assert.equal(
    runtimePickerOptions(rows, [{ runtimeOfferId: "opaque" }] as any).length,
    1,
  );
});
