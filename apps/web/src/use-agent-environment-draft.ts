import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  RuntimeLaunchEnvironmentSchema,
  type RuntimeGuideSettingsView,
} from "@rah-os/protocol";
import type { EnvironmentRow } from "./components/runtime-environment-editor.tsx";

/** Daemon-owned environment preferences; never copied into Room policy or messages. */
export function useAgentEnvironmentDraft(
  client: RahClient,
  agentDefinitionId: string,
  runtimeId: string | undefined,
) {
  const [data, setData] = useState<RuntimeGuideSettingsView>();
  const [drafts, setDrafts] = useState<Record<string, EnvironmentRow[]>>({});
  const [loadError, setLoadError] = useState<string>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setLoadError(undefined);
    setDrafts({});
    client
      .request("runtime.guide.read", { agentDefinitionId })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) setLoadError(String(error));
      });
    return () => {
      active = false;
    };
  }, [client, agentDefinitionId, reload]);
  const row = data?.runtimes.find((item) => item.runtimeId === runtimeId);
  const rows =
    (runtimeId && drafts[runtimeId]) ||
    Object.entries(row?.environment ?? {}).map(([key, value]) => ({
      key,
      value,
    }));
  let environment: Record<string, string> = Object.create(null);
  let validationError: string | undefined;
  try {
    for (const item of rows) {
      if (!item.key && !item.value) continue;
      if (Object.hasOwn(environment, item.key))
        throw new Error("环境变量名称重复：" + item.key);
      environment[item.key] = item.value;
    }
    environment = RuntimeLaunchEnvironmentSchema.parse(environment);
  } catch (error) {
    validationError =
      error instanceof Error ? error.message : "环境变量格式错误";
  }
  const dirty =
    !!row &&
    JSON.stringify(environment) !== JSON.stringify(row.environment ?? {});
  return {
    rows,
    dirty,
    ready: !!row && !validationError,
    error: loadError ?? validationError,
    retry: () => setReload((value) => value + 1),
    setRows: (value: EnvironmentRow[]) => {
      if (runtimeId) setDrafts((old) => ({ ...old, [runtimeId]: value }));
    },
    async save() {
      if (!dirty) return false;
      if (!row || !data || validationError)
        throw new Error("请先检查环境变量配置");
      const result = await client.request("runtime.guide.update", {
        agentDefinitionId,
        runtimeId: row.runtimeId,
        environment,
        expectedRevision: data.revision,
      });
      setData(result);
      return true;
    },
  };
}
