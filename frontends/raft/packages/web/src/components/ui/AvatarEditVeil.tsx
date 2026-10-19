import { Upload } from "lucide-react";
/** Structural port: Raft v1.21.22 app-shell t8; presentation only. */
export default function AvatarEditVeil({ busy = false }: { busy?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-avatar-edit-veil=""
      className={`absolute inset-0 flex items-center justify-center rounded-sticker bg-layer-backdrop text-layer-hud-foreground transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100 peer-focus-visible/avatar-edit:opacity-100"}`}
    >
      <Upload size={20} />
    </span>
  );
}
