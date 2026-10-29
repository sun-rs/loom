import { useState } from "react";
import { Button, Input } from "raft-ui";
import { Dices } from "lucide-react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";
import { avatarGroups, randomAvatarKey } from "./pixel-avatar-library";
/** The native preset-button/preview composition, with labelled Loom-owned data groups. */
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
  const needle = query.trim().toLocaleLowerCase();
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
        onChange={(e) => setQuery(e.target.value)}
      />
      {avatarGroups.map((group) => {
        const entries = group.avatars.filter((a) =>
          (a.name + " " + a.id).toLocaleLowerCase().includes(needle),
        );
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
    </div>
  );
}
