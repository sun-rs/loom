import { z } from "zod";
import { ConflictError } from "@rah-os/kernel";
import { RuntimeLaunchEnvironmentSchema } from "@rah-os/protocol";
import { validateProviderLaunchArgs } from "@rah-os/agent-host";

export const AgentLaunchOverlaySchema = z
  .object({
    additionalArgs: z.array(z.string()).default([]),
    environment: RuntimeLaunchEnvironmentSchema.default({}),
  })
  .strict();
export const LaunchOverlaysSchema = z.record(
  z.string(),
  z.record(z.string(), AgentLaunchOverlaySchema),
);

/** Only exact option groups deduplicate across scopes. Ambiguous value conflicts are rejected. */
export function mergeLaunchArguments(
  globalArgs: string[],
  agentArgs: string[],
): string[] {
  const groups = (args: string[]) => {
    validateProviderLaunchArgs(args);
    const result: string[][] = [];
    for (const token of args) {
      if (token.startsWith("-") && !/^-[0-9]/u.test(token))
        result.push([token]);
      else result.at(-1)!.push(token);
    }
    return result;
  };
  const inherited = groups(globalArgs),
    local = groups(agentArgs),
    result = [...inherited];
  const key = (group: string[]) => group[0]!.split("=")[0]!;
  for (const group of local) {
    const matches = inherited.filter((item) => key(item) === key(group));
    if (matches.some((item) => JSON.stringify(item) === JSON.stringify(group)))
      continue;
    if (matches.length)
      throw new ConflictError(
        "Conflicting global and Agent CLI option: " + key(group),
      );
    result.push(group);
  }
  return validateProviderLaunchArgs(result.flat());
}
