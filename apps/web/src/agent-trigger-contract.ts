export const RAFT_AVATAR_PREVIEW = Object.freeze({
  delay: 200,
  closeDelay: 120,
  width: 280,
  sideOffset: 6,
  collisionPadding: 6,
});
export function placePreview(
  anchor: { left: number; top: number; bottom: number },
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  gutter = 6,
) {
  return {
    left: Math.max(
      gutter,
      Math.min(anchor.left, viewport.width - popup.width - gutter),
    ),
    top:
      anchor.bottom + gap + popup.height <= viewport.height - gutter
        ? anchor.bottom + gap
        : Math.max(gutter, anchor.top - popup.height - gap),
  };
}
export function permissionRoleLabel(
  role: "owner" | "admin" | "member" | undefined,
) {
  return role === "member"
    ? "成员"
    : role === "admin"
      ? "管理员"
      : role === "owner"
        ? "所有者"
        : "未获取";
}
