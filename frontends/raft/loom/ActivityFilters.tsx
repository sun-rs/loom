import {
  Button,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
/** ThreadsInbox's non-sidebar toolbar; only supported activity filters. */
export default function ActivityFilters({
  value,
  onChange,
  onRefresh,
}: {
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div
      data-testid="inbox-toolbar"
      className="shrink-0 border-b border-line-muted bg-layer-panel px-4 theme-brutal:border-b-2 theme-brutal:border-black theme-brutal:bg-white flex h-[54px] items-center justify-between gap-3"
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
      <Button size="sm" variant="ghost" onClick={onRefresh}>
        刷新动态
      </Button>
    </div>
  );
}
