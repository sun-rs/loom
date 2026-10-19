import type { ReactNode } from "react";
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
/** ThreadsInbox's non-sidebar toolbar; only supported activity filters. */
export default function ActivityFilters({
  value,
  onChange,
  actions,
}: {
  value: string;
  actions?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div
      data-testid="inbox-toolbar"
      className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-line-seam bg-layer-panel px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0">
          <SegmentedControl
            value={value}
            onValueChange={onChange}
            aria-label="动态范围"
          >
            {[
              ["all", "全部"],
              ["unread", "未读"],
              ["mentions", "提及我"],
            ].map(([id, label]) => (
              <SegmentedControlItem
                key={id}
                value={id!}
                data-testid={`inbox-filter-${id}`}
              >
                <SegmentedControlLabel>{label}</SegmentedControlLabel>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
