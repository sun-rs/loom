import { Monitor } from "lucide-react";
import { Status } from "raft-ui";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import {
  NativeComputerOverview,
  NativeComputerCounts,
  NativeComputerView,
  NativeComputerRack,
  NativeComputerRow,
} from "./OfficialWorkingSurfaces140.generated.js";
import { useSidebarPreference } from "./sidebar-preference.ts";
import type { computerInstanceRows } from "./computer-instance-list.ts";

/** Verified local inventory/instance slots in the unchanged official rack presentation. */
export default function ComputerOverview({
  inventory,
  error,
  status,
  rows,
  onSelect,
  onRetry,
  onOpenRole,
}: {
  inventory?: LocalRuntimeInventoryResponse;
  error: boolean;
  status: string;
  rows: ReturnType<typeof computerInstanceRows>;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onOpenRole: (id: string) => void;
}) {
  const view = useSidebarPreference((s) => s.computerRackView);
  const setView = useSidebarPreference((s) => s.setComputerRackView);
  const computer = inventory?.computer;
  const count = inventory ? 1 : 0;
  return (
    <NativeComputerOverview
      count={count}
      loading={!inventory && !error}
      error={error}
      view={view}
      onRetry={onRetry}
      titleSuffix={
        <NativeComputerCounts
          count={count}
          online={status === "online" ? count : 0}
          instances={rows.length}
          className="ml-2"
        />
      }
      viewControl={
        <NativeComputerView
          view={view}
          onChange={(v) => {
            if (v === "list" || v === "cards") setView(v);
          }}
        />
      }
    >
      <NativeComputerRack view={view}>
        {inventory && (
          <NativeComputerRow
            machine={{ id: inventory.hostId, status }}
            view={view}
            instanceCount={rows.length}
            platform={computer?.os}
            version={computer?.buildVersion}
            facts={[computer?.os, computer?.buildVersion]
              .filter(Boolean)
              .join(" · ")}
            icon={
              <span
                className="relative flex shrink-0 text-foreground-muted"
                data-testid={`rack-row-icon-${inventory.hostId}`}
              >
                <Monitor size={20} />
                <Status
                  presence={status === "online" ? "online" : "offline"}
                  className="absolute -right-1 -bottom-1"
                />
              </span>
            }
            name={
              <button
                type="button"
                className="min-w-0 truncate rounded-control text-left text-callout font-bold text-foreground outline-none hover:underline focus-visible:shadow-focus"
                data-testid={`rack-row-name-${inventory.hostId}`}
                onClick={() => onSelect(inventory.hostId)}
              >
                {computer?.displayName ?? "Loom 主机"}
              </button>
            }
            instances={rows.map((row) => (
              <Tooltip key={row.instanceId} content={row.name}>
                <button
                  type="button"
                  aria-label={row.name}
                  onClick={() => onOpenRole(row.roleId)}
                  className="shrink-0 rounded-control outline-none focus-visible:shadow-focus"
                >
                  <AvatarSlot
                    type="agent"
                    context="compact-row"
                    agentAvatarUrl={row.avatarKey}
                    presence={
                      row.activity === "working" || row.activity === "thinking"
                        ? "busy"
                        : (row.activity ?? "offline")
                    }
                  />
                </button>
              </Tooltip>
            ))}
          />
        )}
      </NativeComputerRack>
    </NativeComputerOverview>
  );
}
