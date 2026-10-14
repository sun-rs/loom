import type { ComponentProps } from "react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
// The native composer assumes missing Agent-store data means offline. Loom has
// no presence binding here: omit that unsupported badge, keep native geometry.
export default function MentionAvatar(
  props: ComponentProps<typeof AvatarSlot>,
) {
  return <AvatarSlot {...props} badge={undefined} />;
}
