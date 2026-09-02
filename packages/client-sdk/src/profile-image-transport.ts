import {
  ProfileImageMimeTypeSchema,
  ProfileImageUploadResponseSchema,
  profileImageContentPath,
  type ProfileImageUploadResponse,
} from "@rah-os/protocol";

export interface RahProfileImageTransport {
  upload(body: Blob, signal?: AbortSignal): Promise<ProfileImageUploadResponse>;
  url(avatarKey: string): string;
}

export function createProfileImageTransport(
  baseUrl: string,
  accessToken: () => string | undefined,
  fetcher: typeof fetch = globalThis.fetch,
): RahProfileImageTransport {
  const root = baseUrl.replace(/\/$/u, "");
  return {
    upload: async (body, signal) => {
      const token = accessToken();
      if (!token) throw new Error("a Human access token is required");
      const mimeType = ProfileImageMimeTypeSchema.parse(body.type);
      const response = await fetcher(
        `${root}/v3/client/profile-images/content`,
        {
          body,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": mimeType,
          },
          method: "PUT",
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const parsed =
          typeof payload === "object" && payload !== null && "error" in payload
            ? (payload as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(
          parsed ?? `profile image upload failed (${response.status})`,
        );
      }
      return ProfileImageUploadResponseSchema.parse(await response.json());
    },
    url: (avatarKey) => `${root}${profileImageContentPath(avatarKey)}`,
  };
}
