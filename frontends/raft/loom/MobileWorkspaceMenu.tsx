import { useState, useRef } from "react";
import {
  MobileNavServerPopover,
  MobileNavServerItem,
  MobileNavServerPopoverContent,
  MobileNavServerPopoverList,
  MobileNavServerPopoverRow,
  MobileNavServerPopoverRowLabel,
  MobileNavServerPopoverDestinations,
  MobileNavServerPopoverDestination,
  MobileNavServerPopoverGroup,
} from "raft-ui/wip";
import { MobileNavRoot } from "raft-ui";
import { Users, Monitor, Settings, BookOpen, Check } from "lucide-react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import type { Destination } from "./Navigation";
/** Official 0.35.1 mobile-server composition; Loom only binds local workspace/routes. */
export default function MobileWorkspaceMenu({
  name,
  active,
  onSelect,
}: {
  name: string;
  active: string;
  onSelect: (id: Destination) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const select = (id: Destination) => {
    setOpen(false);
    onSelect(id);
  };
  const initial = Array.from(name)[0]?.toUpperCase() || "L";
  return (
    <MobileNavServerPopover open={open} onOpenChange={setOpen}>
      <MobileNavRoot
        ref={navRef}
        className="loom-mobile-nav loom-mobile-workspace-nav"
        role="presentation"
      >
        <MobileNavServerItem aria-label="工作区与更多页面">
          <AvatarSlot
            context="creator-link"
            type="server"
            serverInitial={initial}
          />
        </MobileNavServerItem>
      </MobileNavRoot>
      <MobileNavServerPopoverContent
        anchor={() =>
          navRef.current?.closest<HTMLElement>(".loom-mobile-nav-group") ?? null
        }
        data-testid="mobile-workspace-menu"
      >
        <MobileNavServerPopoverList>
          <MobileNavServerPopoverRow
            aria-current="true"
            onClick={() => setOpen(false)}
          >
            <AvatarSlot
              context="creator-link"
              type="server"
              serverInitial={initial}
            />
            <MobileNavServerPopoverRowLabel>
              {name}
            </MobileNavServerPopoverRowLabel>
            <Check aria-label="当前工作区" />
          </MobileNavServerPopoverRow>
        </MobileNavServerPopoverList>
        <MobileNavServerPopoverDestinations aria-label="工作区页面">
          {(
            [
              { id: "agents", label: "成员", icon: Users },
              { id: "computers", label: "计算机", icon: Monitor },
              { id: "settings", label: "设置", icon: Settings },
            ] as const
          ).map((item) => (
            <MobileNavServerPopoverDestination
              key={item.id}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => select(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
            </MobileNavServerPopoverDestination>
          ))}
        </MobileNavServerPopoverDestinations>
        <MobileNavServerPopoverGroup>
          <MobileNavServerPopoverRow onClick={() => select("memory")}>
            <BookOpen />
            <MobileNavServerPopoverRowLabel>
              记忆
            </MobileNavServerPopoverRowLabel>
          </MobileNavServerPopoverRow>
        </MobileNavServerPopoverGroup>
      </MobileNavServerPopoverContent>
    </MobileNavServerPopover>
  );
}
