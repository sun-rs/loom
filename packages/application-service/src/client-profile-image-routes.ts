import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

import type { AuthenticatedActorContext } from "@rah-os/kernel";
import {
  ProfileImageMimeTypeSchema,
  ProfileImageUploadResponseSchema,
  UploadedProfileImageKeySchema,
  type ProfileImageMimeType,
} from "@rah-os/protocol";

export type ProfileImageAdministrationPort = Readonly<{
  upload(
    actor: AuthenticatedActorContext,
    mimeType: ProfileImageMimeType,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<unknown> | unknown;
  read(
    actor: AuthenticatedActorContext,
    avatarKey: string,
  ):
    | Promise<{
        mimeType: ProfileImageMimeType;
        size: number;
        stream: NodeJS.ReadableStream;
      }>
    | {
        mimeType: ProfileImageMimeType;
        size: number;
        stream: NodeJS.ReadableStream;
      };
}>;

export class ProfileImageRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function transferProfileImage(
  administration: ProfileImageAdministrationPort,
  actor: AuthenticatedActorContext,
  request: IncomingMessage,
  response: ServerResponse,
  avatarKey?: string,
): Promise<void> {
  if (request.method === "PUT" && avatarKey === undefined) {
    const parsedMimeType = ProfileImageMimeTypeSchema.safeParse(
      request.headers["content-type"]?.split(";", 1)[0]?.trim(),
    );
    if (!parsedMimeType.success) {
      throw new ProfileImageRequestError(
        "unsupported_media_type",
        "profile image must be JPEG, PNG, GIF, or WebP",
        415,
      );
    }
    const mimeType = parsedMimeType.data;
    request.setTimeout(120_000, () => request.destroy());
    let uploaded: unknown;
    try {
      uploaded = await administration.upload(actor, mimeType, request);
    } catch (error) {
      throw mapProfileImageStorageError(error);
    }
    response.statusCode = 200;
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify(ProfileImageUploadResponseSchema.parse(uploaded)),
    );
    return;
  }
  if (request.method === "GET" && avatarKey !== undefined) {
    const parsedAvatarKey = UploadedProfileImageKeySchema.safeParse(avatarKey);
    if (!parsedAvatarKey.success) {
      throw new ProfileImageRequestError(
        "invalid_profile_image_key",
        "profile image key is invalid",
        400,
      );
    }
    let image;
    try {
      image = await administration.read(actor, parsedAvatarKey.data);
    } catch (error) {
      throw mapProfileImageStorageError(error);
    }
    response.statusCode = 200;
    response.setHeader(
      "content-type",
      ProfileImageMimeTypeSchema.parse(image.mimeType),
    );
    response.setHeader("content-length", image.size);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("cache-control", "private, max-age=31536000, immutable");
    await pipeline(image.stream, response);
    return;
  }
  response.statusCode = 405;
  response.setHeader("allow", avatarKey === undefined ? "PUT" : "GET");
  response.end();
}

export function mapProfileImageStorageError(error: unknown): Error {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    if (error.code === "profile_image_too_large") {
      return new ProfileImageRequestError(
        error.code,
        error instanceof Error ? error.message : "profile image is too large",
        413,
      );
    }
    if (error.code === "profile_image_not_found") {
      return new ProfileImageRequestError(
        error.code,
        error instanceof Error ? error.message : "profile image was not found",
        404,
      );
    }
    if (error.code === "profile_image_invalid") {
      return new ProfileImageRequestError(
        error.code,
        error instanceof Error ? error.message : "profile image is invalid",
        400,
      );
    }
  }
  return error instanceof Error
    ? error
    : new Error("profile image operation failed");
}
