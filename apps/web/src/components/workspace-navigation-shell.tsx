import { useMobileLayout } from "../use-mobile-layout.ts";
import type { ComponentProps } from "react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { Rail } from "./workspace-navigation.tsx";

/** Shared destination actions; mobile root pages use the iOS reference tab bar. */
export function WorkspaceNavigation({
  homeOpen,
  onHome,
  ...props
}: ComponentProps<typeof Rail> & {
  homeOpen: boolean;
  onHome: () => void;
}) {
  const mobile = useMobileLayout();
  if (!mobile) return <Rail {...props} />;
  const active = props.active;
  if (
    !(active === "room" && homeOpen) &&
    active !== "tasks" &&
    active !== "agents" &&
    active !== "settings"
  )
    return null;
  return (
    <nav className="rah-mobile-nav" aria-label="移动端主导航">
      {(
        [
          ["room", "home", "首页"],
          ["tasks", "task", "任务"],
          ["agents", "members", "成员"],
          ["settings", "gear", "设置"],
        ] as const
      ).map(([surface, icon, label]) => (
        <button
          key={surface}
          aria-label={label}
          type="button"
          aria-current={active === surface ? "page" : undefined}
          onClick={() =>
            surface === "room"
              ? onHome()
              : surface === "tasks"
                ? props.onTasks?.()
                : props.onSelect?.(surface)
          }
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
