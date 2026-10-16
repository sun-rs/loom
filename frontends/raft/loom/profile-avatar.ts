/** The native renderer's uploaded-image guard, bound to Loom's same-origin transport. */
export function isRaftUploadedHumanAvatarUrl(
  value: string | null | undefined,
): value is string {
  return (
    typeof value === "string" &&
    /^\/v3\/client\/profile-images\/content\/upload_(?:jpeg|png|gif|webp)_[a-f0-9]{40}$/.test(
      value,
    )
  );
}
