import {AttachmentChip as OfficialAttachmentChip} from "../../../../../loom/OfficialAttachmentChip.generated";
import type {ComponentProps, ReactNode} from "react";
// Old callers may supply two retired presentation-only props. Neither alters native layout.
export function AttachmentChip({variant: _variant,icon: _icon,...props}: ComponentProps<typeof OfficialAttachmentChip> & {variant?: "compact" | "wide";icon?: ReactNode}) {
 return <OfficialAttachmentChip {...props} />;
}
