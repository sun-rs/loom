/** Raft live CSS: thread-layout min-width 680, landscape OR viewport >=1280;
 * below md (768) the active conversation occupies the entire viewport. */
export function conversationLayout(
  width: number,
  height: number,
  navigationWidth: number,
) {
  if (width < 768) return "fullscreen";
  return width - navigationWidth >= 680 && (width > height || width >= 1280)
    ? "split"
    : "replace";
}
