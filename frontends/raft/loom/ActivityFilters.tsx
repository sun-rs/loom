import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
/** ThreadsInbox's non-sidebar toolbar; only supported activity filters. */
export default function ActivityFilters({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      data-testid="inbox-toolbar"
      className="shrink-0 border-b border-line-muted bg-layer-panel px-4    flex h-[54px] items-center justify-between gap-3"
    >
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
  );
}
