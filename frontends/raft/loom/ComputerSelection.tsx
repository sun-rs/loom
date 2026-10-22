// Structural port: db5e399 MachineDetailPanel.tsx MachineAgentList header/actions.
// Native button parameters retained. Loom selects Instance IDs, never Role IDs.
import { Button } from "raft-ui";
import SurfaceListItem from "../packages/web/src/components/ui/SurfaceListItem.tsx";
import { Check, X, Play, Square, RotateCcw } from "lucide-react";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import type { RoleBatchAction } from "./RoleBatchDialog.tsx";
export default function ComputerSelection({
  rows,
  selected,
  onSelect,
  onAction,
  toolbar = false,
}: {
  toolbar?: boolean;
  rows: readonly { instanceId: string }[];
  selected: string[] | null;
  onSelect: (ids: string[] | null) => void;
  onAction: (action: RoleBatchAction) => void;
}) {
  const count = rows.filter((r) => selected?.includes(r.instanceId)).length;
  if (toolbar)
    return selected !== null && count > 0 ? (
      <SurfaceListItem selected interactive={false} className="mb-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          <SectionEyebrow tone="ink" className="mr-auto">
            已选择 {count} 个实例
          </SectionEyebrow>
          <Button
            size="sm"
            variant="success"
            disabled={!count}
            onClick={() => onAction("enable")}
          >
            <Play size={16} />
            启用
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!count}
            onClick={() => onAction("stop")}
          >
            <Square size={16} />
            停止
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!count}
            onClick={() => onAction("restart")}
          >
            <RotateCcw size={16} />
            重启／重置
          </Button>
        </div>
      </SurfaceListItem>
    ) : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected === null ? (
        <Button size="sm" variant="outline" onClick={() => onSelect([])}>
          <Check size={16} />
          选择
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onSelect(
                count === rows.length ? [] : rows.map((r) => r.instanceId),
              )
            }
          >
            <Check size={16} />
            {count === rows.length ? "清空选择" : "全选"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSelect(null)}>
            <X size={16} />
            取消
          </Button>
        </>
      )}
    </div>
  );
}
