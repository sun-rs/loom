import { RuntimeLaunchEnvironmentSchema } from "@rah-os/protocol";
import type { EnvironmentRow } from "./components/runtime-environment-editor.tsx";

export function parseAgentEnvironment(rows: EnvironmentRow[]) {
  const environment: Record<string, string> = Object.create(null);
  for (const row of rows) {
    if (!row.key && !row.value) continue;
    if (Object.hasOwn(environment, row.key))
      throw new Error("环境变量名称重复：" + row.key);
    environment[row.key] = row.value;
  }
  return RuntimeLaunchEnvironmentSchema.parse(environment);
}
