import {
  ProfileImageMimeTypeSchema,
  ProfileImageUploadResponseSchema,
  type ProfileImageMimeType,
  type ProfileImageUploadResponse,
} from "@rah-os/protocol";
import type {
  AuthenticatedWorkerExecutionContext,
  RoomKernel,
} from "@rah-os/kernel";
export type WorkerProfileImageStore = {
  upload(
    mimeType: ProfileImageMimeType,
    chunks: AsyncIterable<Uint8Array>,
    recordIntent: (input: {
      avatarKey: string;
      mimeType: ProfileImageMimeType;
      size: number;
    }) => Promise<string> | string,
  ): Promise<ProfileImageUploadResponse>;
};
/** Uses the existing daemon image store and durable intent owner. Reauthorize
 * the credential and live Run before I/O, at intent recording, and before reply. */
export async function uploadWorkerSelfAvatar(input: {
  profiles: RoomKernel["workerSelfProfile"];
  execution: () => AuthenticatedWorkerExecutionContext;
  store: WorkerProfileImageStore;
  mimeType: unknown;
  chunks: AsyncIterable<Uint8Array>;
}): Promise<ProfileImageUploadResponse> {
  const authorize = () => {
    const execution = input.execution();
    input.profiles.assertAvatarUploadAllowed(execution);
    return execution;
  };
  authorize();
  const mimeType = ProfileImageMimeTypeSchema.parse(input.mimeType);
  const result = await input.store.upload(
    mimeType,
    input.chunks,
    ({ avatarKey }) =>
      input.profiles.recordAvatarUpload(authorize(), { avatarKey })
        .uploadIntentId,
  );
  authorize();
  return ProfileImageUploadResponseSchema.parse(result);
}
