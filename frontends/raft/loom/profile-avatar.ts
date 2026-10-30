import {
  isUploadedProfileImageKey,
  profileImageContentPath,
} from "@rah-os/protocol";
/** A persisted identity is not a URL. Convert uploaded keys only at the resource seam. */
export function roleAvatarUrl(value: string | null): string | null {
  return value && isUploadedProfileImageKey(value)
    ? profileImageContentPath(value)
    : value;
}
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
