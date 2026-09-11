import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** Raft zi -> Bc/JLe: Base UI dismissal, right placement, brutal chrome. */
export function HintTooltip({
  children,
  content,
}: {
  children: ReactElement;
  content: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          positionMethod="fixed"
          collisionAvoidance={{
            side: "shift",
            align: "shift",
            fallbackAxisSide: "none",
          }}
          side="right"
          sideOffset={6}
          className="rah-tooltip-positioner"
        >
          <Tooltip.Popup role="tooltip" className="rah-tooltip">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
