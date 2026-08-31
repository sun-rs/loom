import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PRODUCT_FILE_BYTES = 1024 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;

const ProductFileSchema = z
  .object({
    path: z.string().min(1).max(4_096).refine(safeRelativePath),
    sha256: z.string().regex(SHA256),
    size: z.number().int().positive().max(MAX_PRODUCT_FILE_BYTES),
  })
  .strict();

const LocalCoreProductManifestSchema = z
  .object({
    executable: ProductFileSchema,
    nodeCarrierVersion: z.string().trim().min(1).max(128),
    platformKey: z.string().trim().min(1).max(128),
    product: z.literal("rah-os-local-core"),
    schemaVersion: z.literal(1),
    version: z
      .string()
      .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u),
    web: z
      .object({
        files: z.array(ProductFileSchema).min(1).max(10_000),
        root: z.literal("web"),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.executable.path !== "bin/rah-os-core") {
      context.addIssue({
        code: "custom",
        message: "Local Core executable path is invalid",
        path: ["executable", "path"],
      });
    }
    const paths = new Set<string>();
    manifest.web.files.forEach((file, index) => {
      if (!file.path.startsWith("web/")) {
        context.addIssue({
          code: "custom",
          message: "Web product files must stay under web/",
          path: ["web", "files", index, "path"],
        });
      }
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: "Product file paths must be unique",
          path: ["web", "files", index, "path"],
        });
      }
      paths.add(file.path);
    });
    if (!paths.has("web/index.html")) {
      context.addIssue({
        code: "custom",
        message: "Local Core product requires web/index.html",
        path: ["web", "files"],
      });
    }
  });

export type InspectedLocalCoreProduct = Readonly<{
  executablePath: string;
  nodeCarrierVersion: string;
  platformKey: string;
  productDirectory: string;
  runnerIntegrity: Readonly<{ sha256: string; size: number }>;
  staticDirectory: string;
  version: string;
}>;

/** Verifies the immutable product tree before it can enter a launchd plan. */
export async function inspectLocalCoreProduct(
  productDirectory: string,
): Promise<InspectedLocalCoreProduct> {
  if (!isAbsolute(productDirectory) || productDirectory.includes("\0")) {
    throw new Error("Local Core product directory must be absolute");
  }
  const root = resolve(productDirectory);
  const manifestBytes = await readBoundedRegularFile(
    join(root, "product-manifest.json"),
    MAX_MANIFEST_BYTES,
    false,
  );
  let unchecked: unknown;
  try {
    unchecked = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Local Core product manifest is invalid JSON");
  }
  const manifest = LocalCoreProductManifestSchema.parse(unchecked);
  if (manifest.platformKey !== `${process.platform}-${process.arch}`) {
    throw new Error("Local Core product platform does not match this Mac");
  }
  await verifyProductFile(root, manifest.executable, true);
  for (const file of manifest.web.files) {
    await verifyProductFile(root, file, false);
  }
  return Object.freeze({
    executablePath: join(root, manifest.executable.path),
    nodeCarrierVersion: manifest.nodeCarrierVersion,
    platformKey: manifest.platformKey,
    productDirectory: root,
    runnerIntegrity: Object.freeze({
      sha256: manifest.executable.sha256,
      size: manifest.executable.size,
    }),
    staticDirectory: join(root, manifest.web.root),
    version: manifest.version,
  });
}

async function verifyProductFile(
  root: string,
  descriptor: z.infer<typeof ProductFileSchema>,
  executable: boolean,
): Promise<void> {
  const path = join(root, descriptor.path);
  const bytes = await readBoundedRegularFile(path, descriptor.size, executable);
  if (
    bytes.byteLength !== descriptor.size ||
    createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
  ) {
    throw new Error(`product file digest does not match: ${descriptor.path}`);
  }
}

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
  executable: boolean,
): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes ||
      (executable && (metadata.mode & 0o111) === 0) ||
      (metadata.mode & 0o022) !== 0
    ) {
      throw new Error(`Local Core product file is invalid: ${path}`);
    }
    return await readFile(handle);
  } finally {
    await handle.close();
  }
}

function safeRelativePath(value: string): boolean {
  return (
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
