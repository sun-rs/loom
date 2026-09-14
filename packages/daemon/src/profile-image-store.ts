import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageMimeTypeSchema,
  ProfileImageUploadResponseSchema,
  UploadedProfileImageKeySchema,
  type ProfileImageMimeType,
} from "@rah-os/protocol";

type ImageKind = "gif" | "jpeg" | "png" | "webp";
type ProfileImageStoreErrorCode =
  | "profile_image_invalid"
  | "profile_image_not_found"
  | "profile_image_too_large";

export class ProfileImageStoreError extends Error {
  readonly code: ProfileImageStoreErrorCode;

  constructor(code: ProfileImageStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Owner-private immutable media store for Human and Workspace profile images. */
export class ProfileImageStore {
  readonly #directory: string;

  constructor(input: { directory: string }) {
    this.#directory = resolve(input.directory);
    mkdirSync(this.#directory, { mode: 0o700, recursive: true });
    requirePrivateDirectory(this.#directory);
  }

  async upload(
    requestedMimeType: string,
    chunks: AsyncIterable<Uint8Array>,
    recordIntent: (input: {
      avatarKey: string;
      mimeType: ProfileImageMimeType;
      size: number;
    }) => Promise<string> | string,
  ) {
    const parsedMimeType =
      ProfileImageMimeTypeSchema.safeParse(requestedMimeType);
    if (!parsedMimeType.success) {
      throw new ProfileImageStoreError(
        "profile_image_invalid",
        "unsupported profile image MIME type",
      );
    }
    const mimeType = parsedMimeType.data;
    const buffers: Buffer[] = [];
    let size = 0;
    for await (const chunk of chunks) {
      size += chunk.byteLength;
      if (size > PROFILE_IMAGE_MAX_BYTES) {
        throw new ProfileImageStoreError(
          "profile_image_too_large",
          `profile image must not exceed ${String(PROFILE_IMAGE_MAX_BYTES)} bytes`,
        );
      }
      buffers.push(Buffer.from(chunk));
    }
    if (size === 0)
      throw new ProfileImageStoreError(
        "profile_image_invalid",
        "profile image cannot be empty",
      );
    const bytes = Buffer.concat(buffers, size);
    const kind = sniffImageKind(bytes);
    if (mimeForKind(kind) !== mimeType) {
      throw new ProfileImageStoreError(
        "profile_image_invalid",
        "profile image content does not match its MIME type",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const avatarKey = `upload_${kind}_${digest.slice(0, 40)}`;
    UploadedProfileImageKeySchema.parse(avatarKey);
    // The durable intent must precede publication. If the process exits after
    // this point, the reconciler can recover the unbound object safely.
    const uploadIntentId =
      ProfileImageUploadResponseSchema.shape.uploadIntentId.parse(
        await recordIntent({ avatarKey, mimeType, size }),
      );
    const path = this.#path(avatarKey);
    if (existsSync(path)) {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(
          "profile image path must be an owner-private regular file",
        );
      }
      if (!readFileSync(path).equals(bytes)) {
        throw new Error("profile image content-address collision");
      }
    } else {
      const temporary = this.#path(`.${avatarKey}.${randomUUID()}.part`);
      try {
        writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return ProfileImageUploadResponseSchema.parse({
      avatarKey,
      mimeType,
      size,
      uploadIntentId,
    });
  }

  inventory(): ReadonlyArray<{ avatarKey: string; modifiedAtMs: number }> {
    const entries: Array<{ avatarKey: string; modifiedAtMs: number }> = [];
    for (const name of readdirSync(this.#directory)) {
      if (!UploadedProfileImageKeySchema.safeParse(name).success) continue;
      const path = this.#path(name);
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      // Filesystems expose fractional milliseconds; Kernel timestamps use integers.
      // Round upward so normalization never shortens the collection grace period.
      entries.push({
        avatarKey: name,
        modifiedAtMs: Math.ceil(metadata.mtimeMs),
      });
    }
    return entries.sort((left, right) =>
      left.avatarKey.localeCompare(right.avatarKey),
    );
  }

  reclaim(avatarKey: string): void {
    const canonicalKey = UploadedProfileImageKeySchema.parse(avatarKey);
    const path = this.#path(canonicalKey);
    if (!existsSync(path)) return;
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("profile image path must be a regular file");
    }
    rmSync(path);
  }

  reclaimStaleParts(input: { olderThanMs: number }): number {
    if (!Number.isSafeInteger(input.olderThanMs) || input.olderThanMs < 0) {
      throw new Error("profile image part cutoff must be non-negative");
    }
    let reclaimed = 0;
    for (const name of readdirSync(this.#directory)) {
      if (
        !/^\.upload_(?:jpeg|png|gif|webp)_[a-f0-9]{40}\.[0-9a-f-]{36}\.part$/u.test(
          name,
        )
      ) {
        continue;
      }
      const path = this.#path(name);
      const metadata = lstatSync(path);
      if (
        metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.mtimeMs <= input.olderThanMs
      ) {
        rmSync(path);
        reclaimed += 1;
      }
    }
    return reclaimed;
  }

  read(avatarKey: string) {
    const canonicalKey = UploadedProfileImageKeySchema.parse(avatarKey);
    const path = this.#path(canonicalKey);
    if (!existsSync(path))
      throw new ProfileImageStoreError(
        "profile_image_not_found",
        "profile image was not found",
      );
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("profile image path must be a regular file");
    }
    const kind = canonicalKey.slice("upload_".length).split("_", 1)[0];
    return {
      mimeType: mimeForKind(kind as ImageKind),
      size: metadata.size,
      stream: createReadStream(path),
    };
  }

  #path(filename: string): string {
    const path = resolve(this.#directory, filename);
    if (!path.startsWith(`${this.#directory}/`)) {
      throw new Error("invalid profile image path");
    }
    return path;
  }
}

function requirePrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("profile image directory must be owner-private");
  }
}

function sniffImageKind(bytes: Buffer): ImageKind {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "jpeg";
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  )
    return "gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  throw new ProfileImageStoreError(
    "profile_image_invalid",
    "unsupported or malformed profile image",
  );
}

function mimeForKind(kind: ImageKind): ProfileImageMimeType {
  return kind === "jpeg" ? "image/jpeg" : `image/${kind}`;
}
