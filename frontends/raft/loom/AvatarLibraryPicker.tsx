import { useState } from "react";
import { Button, Input } from "raft-ui";
import { Dices } from "lucide-react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";
import { avatarGroups, randomAvatarKey } from "./pixel-avatar-library";
/** Native preview/preset controls; the full catalogue is searchable, images load in batches. */
export default function AvatarLibraryPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const needle = query.trim().toLocaleLowerCase();
  let remaining = limit;
  const filtered = avatarGroups.map((group) => ({
    ...group,
    avatars: group.avatars.filter((a) =>
      (a.name + " " + a.id).toLocaleLowerCase().includes(needle),
    ),
  }));
  const total = filtered.reduce((sum, group) => sum + group.avatars.length, 0);
  return (
    <div className="space-y-4" data-testid="role-avatar-library">
      <div className="flex items-start gap-4">
        <div className="size-16 shrink-0">
          <AvatarSlot
            context="profile-tile"
            type="agent"
            agentAvatarUrl={value}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disabled}
          onClick={() => onChange(randomAvatarKey(value))}
        >
          <Dices size={16} />
          随机头像
        </Button>
      </div>
      <Input
        aria-label="搜索头像"
        placeholder="搜索头像"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(60);
        }}
      />
      {filtered.map((group) => {
        const entries = group.avatars.slice(0, remaining);
        remaining -= entries.length;
        return entries.length ? (
          <section key={group.id} data-avatar-group={group.id}>
            <SectionEyebrow as="div" className="mb-2">
              {group.name}
            </SectionEyebrow>
            <div className="flex flex-wrap gap-2">
              {entries.map((a) => (
                <Tooltip key={a.id} content={a.name}>
                  <button
                    type="button"
                    aria-label={`头像 ${a.name}`}
                    aria-pressed={value === `pixel:${a.id}`}
                    disabled={disabled}
                    onClick={() => onChange(`pixel:${a.id}`)}
                    className={`flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors ${value === `pixel:${a.id}` ? "border-accent bg-accent-soft" : "border-line-muted hover:border-line-strong"}`}
                  >
                    <AvatarSlot
                      context="panel-header"
                      type="agent"
                      agentAvatarUrl={`pixel:${a.id}`}
                    />
                  </button>
                </Tooltip>
              ))}
            </div>
          </section>
        ) : null;
      })}
      {total > limit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setLimit((n) => n + 60)}
          data-testid="avatar-library-more"
        >
          显示更多头像（{limit} / {total}）
        </Button>
      )}
      {total === 0 && (
        <p className="text-sm text-content-muted">没有匹配的头像</p>
      )}
    </div>
  );
}
