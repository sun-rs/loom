// TasksPage filter Button recipe; native Select owns focus and dismissal.
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectList,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from "raft-ui";
import { ChevronDown, RefreshCw } from "lucide-react";
export function MemoryFilter({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(v) => {
        if (v) onChange(v);
      }}
    >
      <SelectTrigger
        aria-label={label}
        render={
          <Button
            size="sm"
            variant="outline"
            className="box-border h-8 min-h-8 w-auto shrink-0 gap-1 py-0"
          />
        }
      >
        <SelectValue className="max-w-28 truncate" />
        <SelectIcon>
          <ChevronDown size={12} />
        </SelectIcon>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectList>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectItemText>{o.label}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectList>
      </SelectContent>
    </Select>
  );
}
export default function MemoryFilters({
  query,
  onQuery,
  channel,
  onChannel,
  channels,
  filter,
  onFilter,
  busy,
  onRefresh,
}: {
  query: string;
  onQuery: (value: string) => void;
  channel: string;
  onChannel: (value: string) => void;
  channels: { value: string; label: string }[];
  filter: string;
  onFilter: (value: string) => void;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div
      data-testid="memory-toolbar"
      className="shrink-0 flex items-center gap-2 px-4 pt-3"
    >
      <Input
        aria-label="搜索记忆"
        placeholder="搜索记忆"
        className="h-8 min-h-8 min-w-0 flex-1 py-0 text-sm"
        value={query}
        maxLength={200}
        disabled={busy}
        onChange={(e) => onQuery(e.target.value)}
      />
      <MemoryFilter
        label="频道"
        value={channel}
        disabled={busy}
        onChange={onChannel}
        options={[{ value: "all", label: "全部频道" }, ...channels]}
      />
      <MemoryFilter
        label="状态"
        value={filter}
        disabled={busy || !!query.trim()}
        onChange={onFilter}
        options={[
          { value: "active", label: "有效" },
          { value: "invalidated", label: "已失效" },
          { value: "deleted", label: "已删除" },
          { value: "all", label: "全部状态" },
        ]}
      />
      <Button
        size="icon-sm"
        variant="outline"
        className="h-8 min-h-8 w-8 shrink-0"
        aria-label="刷新记忆"
        disabled={busy}
        onClick={onRefresh}
      >
        <RefreshCw size={14} />
      </Button>
    </div>
  );
}
