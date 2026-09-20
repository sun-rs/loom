import type { NavigationTarget } from "@rah-os/protocol";
import {
  navigationSearch,
  shouldHandleClientNavigation,
} from "../navigation-target.ts";

export function NavigationReceiptLink({
  onOpenTarget,
  target,
  text,
}: {
  onOpenTarget?: (target: NavigationTarget) => void;
  target: Extract<NavigationTarget, { kind: "message" }>;
  text: string;
}) {
  return (
    <a
      href={navigationSearch({ target })}
      onClick={(event) => {
        if (onOpenTarget === undefined || !shouldHandleClientNavigation(event))
          return;
        event.preventDefault();
        onOpenTarget(target);
      }}
    >
      {text}
    </a>
  );
}
