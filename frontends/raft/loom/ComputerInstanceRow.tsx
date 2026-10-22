import InstancePresence from "./InstancePresence.tsx";
// Structural port: db5e399 MachineAgentRow.tsx. Loom supplies instance identity/status.
import {
  CheckboxIndicator,
  ListRow,
  ListRowBody,
  ListRowMeta,
  ListRowTitle,
} from "raft-ui";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import { OfficialAvatarListRow } from "./OfficialListRows.tsx";
import type { computerInstanceRows } from "./computer-instance-list.ts";
export default function ComputerInstanceRow({
  instance,
  selectionMode,
  selected,
  onClick,
}: {
  instance: ReturnType<typeof computerInstanceRows>[number];
  selectionMode: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const avatar = (
    <AvatarSlot
      context="list-row"
      type="agent"
      agentAvatarUrl={instance.avatarKey}
    />
  );
  const status = (
    <InstancePresence
      activity={instance.activity}
      label={instance.stateLabel}
    />
  );
  return selectionMode ? (
    <ListRow
      selected={selected}
      onClick={onClick}
      className="group"
      aria-pressed={selected}
      aria-label={`${selected ? "取消选择" : "选择"} ${instance.name}`}
      data-testid="computer-instance-row"
    >
      <CheckboxIndicator checked={selected} previewOnHover className="mt-0" />
      {avatar}
      <ListRowBody>
        <ListRowTitle>{instance.name}</ListRowTitle>
        <ListRowMeta>{instance.subtitle}</ListRowMeta>
      </ListRowBody>
      <span className="flex shrink-0 items-center gap-1.5">{status}</span>
    </ListRow>
  ) : (
    <OfficialAvatarListRow
      avatar={avatar}
      name={instance.name}
      subtitle={instance.subtitle}
      rightContent={status}
      selected={false}
      onClick={onClick}
      buttonProps={{ "data-testid": "computer-instance-row" }}
    />
  );
}
