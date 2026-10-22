// Compatibility for retained upstream callers only; presentation/state are official.
import type {ComponentProps} from "react";
import type {ButtonProps} from "raft-ui";
import OfficialConfirmation from "../../../../loom/OfficialConfirmation.generated";
const CONFIRM_TONES_BY_LEGACY_COLOR: Record<string, ButtonProps["variant"]> = {
  "bg-white": "outline",
  "bg-soft-signal": "primary",
  "bg-brutal-pink": "accent",
  "bg-brutal-cyan": "information",
  "bg-brutal-lavender": "muted",
  "bg-brutal-orange": "warning",
  "bg-brutal-lime": "success",
  "bg-brutal-red": "danger",
  "bg-brutal-stone": "muted",
};
export default function ConfirmDialog({confirmColor,confirmVariant,...props}:ComponentProps<typeof OfficialConfirmation>&{confirmColor?:string}) {
 return <OfficialConfirmation {...props} confirmVariant={confirmVariant ?? (confirmColor ? CONFIRM_TONES_BY_LEGACY_COLOR[confirmColor] : undefined) ?? "danger"}/>;
}
