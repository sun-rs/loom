import { OfficialThemeMode } from "./OfficialRefresh135.generated";
import { useMemo, useState } from "react";
import {
  RadioGroup,
  Switch,
  ListRowGroup,
  ListRow,
  ListRowBody,
  ListRowTitle,
  ListRowDescription,
  Button,
  useTheme,
} from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import {
  WorkspaceThemeSchema,
  type SidebarPatchRequest,
} from "@rah-os/protocol";
import { OfficialThemeOption } from "../upstream/published-2026-10-26/theme-option.js";
import { useSidebarPreferences } from "./useSidebarPreferences";
import { ManagementClient } from "./management-client";
import { OperationStatus, useManagement } from "./ManagementUi";
const themes = [
  ["raft", "Raft 黄"],
  ["boring", "无聊灰"],
  ["bots", "机器人"],
  ["critters", "小动物"],
  ["space", "太空"],
  ["desk", "工位"],
  ["food", "食物"],
  ["quest", "冒险"],
  ["weather", "天气"],
  ["plants", "植物"],
  ["spooky", "怪谈"],
] as const;
/** Structural port of official Ka composition. Kernel owns personal preferences;
 * no billing restriction, no upstream stores, no optimistic success on unknown writes. */
export default function WorkspaceThemeSettings({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const read = useSidebarPreferences(client, workspaceId),
    { resolvedMode } = useTheme();
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  const operation = useManagement(manager),
    [rejected, setRejected] = useState(false);
  const pref = read.preferences,
    theme = pref?.theme ?? "raft",
    decor = pref?.themeDecor !== false;
  const busy =
    operation.state !== "idle" ||
    read.loading ||
    read.error ||
    !pref ||
    rejected;
  const save = (patch: SidebarPatchRequest["patch"]) => {
    if (busy || !pref) return;
    operation.setError("");
    void manager.sidebar(patch, pref.version, (outcome) => {
      if (outcome.kind === "ok") {
        window.dispatchEvent(new Event("loom:sidebar-preferences-changed"));
      } else if (outcome.kind === "rejected") {
        setRejected(true);
        operation.setError("主题未保存，请重新读取后再修改。");
      }
    });
  };
  const select = (value: string) => {
    const parsed = WorkspaceThemeSchema.safeParse(value);
    if (parsed.success && parsed.data !== theme) save({ theme: parsed.data });
  };
  const hasDecor = theme !== "raft" && theme !== "boring";
  const group = (label: string, options: (typeof themes)[number][]) => (
    <section className="mb-6">
      <h3 className="mb-3 text-subhead font-semibold text-foreground">
        {label}
      </h3>
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4">
          {options.map(([id, label]) => (
            <OfficialThemeOption
              key={id}
              theme={id}
              mode={resolvedMode}
              label={label}
              selected={theme === id}
              hint={id === "raft" ? "默认" : null}
              onSelect={select}
            />
          ))}
        </div>
      </div>
    </section>
  );
  return (
    <div className="mb-6 max-w-3xl" data-testid="server-theme-section">
      <p className="mb-6 text-callout text-foreground-muted">
        你在当前工作区看到的样子。只有你看得到。
      </p>
      <OfficialThemeMode />
      <fieldset
        disabled={busy}
        className="min-w-0 border-0 p-0 m-0"
        aria-busy={read.loading || operation.state !== "idle"}
      >
        <RadioGroup
          value={theme}
          onValueChange={(value) => value && select(value)}
          aria-label="主题"
          data-testid="server-theme-picker"
        >
          {group("基础", themes.slice(0, 2))}
          {group("头像系列", themes.slice(2))}
        </RadioGroup>
        <ListRowGroup>
          <ListRow variant="plain" interactive={false}>
            <ListRowBody>
              <ListRowTitle id="server-theme-decor-label">
                边框上的像素画
              </ListRowTitle>
              <ListRowDescription id="server-theme-decor-description" wrap>
                {hasDecor
                  ? "在边框上显示这个主题的像素画。"
                  : "这个主题没有像素画。"}
              </ListRowDescription>
            </ListRowBody>
            <Switch
              checked={hasDecor && decor}
              disabled={!hasDecor || busy}
              onCheckedChange={(value) => save({ themeDecor: value })}
              aria-labelledby="server-theme-decor-label"
              aria-describedby="server-theme-decor-description"
            />
          </ListRow>
        </ListRowGroup>
      </fieldset>
      <OperationStatus manager={manager} error={operation.error} />
      {(read.error || rejected) && (
        <div role="alert">
          无法核实当前偏好。
          <Button
            variant="ghost"
            disabled={operation.state !== "idle"}
            onClick={() => {
              setRejected(false);
              operation.setError("");
              read.reload();
            }}
          >
            重新读取
          </Button>
        </div>
      )}
    </div>
  );
}
