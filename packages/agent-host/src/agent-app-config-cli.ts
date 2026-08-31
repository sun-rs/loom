import {
  AgentMemoryConfigPatchSchema,
  type AgentMemoryConfigPatch,
} from "@rah-os/protocol";

/** Port of Raft's app config argument contract; only installed system.cleaner. */
export function parseAgentAppConfig(
  arguments_: readonly string[],
): Omit<AgentMemoryConfigPatch, "expectedRevision"> | undefined {
  if (arguments_[1] !== "config" || arguments_.length > 16)
    throw new Error(
      "usage: rah app config --app system.cleaner [--set key=value] [--unset key]",
    );
  let app: string | undefined;
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (let i = 2; i < arguments_.length; i += 2) {
    const flag = arguments_[i];
    const value = arguments_[i + 1];
    if (value === undefined || value.length > 128)
      throw new Error("Invalid app config argument");
    if (flag === "--app" && app === undefined) app = value;
    else if (flag === "--set") {
      const match =
        /^(enabled|threshold_bytes|interval_ms)=(true|false|[0-9]+)$/.exec(
          value,
        );
      if (!match || Object.hasOwn(set, match[1]!))
        throw new Error("Invalid or duplicate cleaner setting");
      set[match[1]!] =
        match[2] === "true"
          ? true
          : match[2] === "false"
            ? false
            : Number(match[2]);
    } else if (flag === "--unset") unset.push(value);
    else throw new Error("Unknown app config option");
  }
  if (app !== "system.cleaner")
    throw new Error("Only system.cleaner configuration is available");
  if (Object.keys(set).length === 0 && unset.length === 0) return undefined;
  const parsed = AgentMemoryConfigPatchSchema.parse({
    expectedRevision: 0,
    set,
    unset,
  });
  return { set: parsed.set!, unset: parsed.unset! };
}
