import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProviderSessionKey,
  ProviderSessionRecord,
  ProviderSessionStore,
} from "./provider-session-store.ts";

export type ProviderSessionForkInput = Readonly<{
  operationId: string;
  source: ProviderSessionKey;
  sourceGeneration: number;
  target: ProviderSessionKey;
}>;

type Receipt = {
  version: 1;
  requestDigest: string;
  state: "prepared" | "created";
  providerSessionId?: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uncertain = (cause?: unknown) =>
  new Error(
    "RAH_SESSION_FORK_UNCERTAIN: native fork may have happened; inspect or abandon this operation, never silently retry it",
    { cause },
  );

/** Host metadata only, not a business queue. Kernel must authorize and CAS the
 * idle source generation/configuration before exposing the new principal.
 * The native callback must copy, never resume/turn the source. A persisted
 * receipt permits binding recovery; an ambiguous native result never reruns.
 */
export async function forkProviderSession(
  store: ProviderSessionStore,
  root: string,
  input: ProviderSessionForkInput,
  nativeFork: (source: Readonly<ProviderSessionRecord>) => Promise<string>,
): Promise<ProviderSessionRecord> {
  const directory = join(root, "fork-receipts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0
  )
    throw new Error("Fork receipt directory must be private and not a symlink");
  // One claim per destination: another request cannot race a second native
  // fork into the same principal, even across processes or Host restarts.
  const path = join(
    directory,
    `${digest([input.target.participantId, input.target.provider])}.json`,
  );
  const requestDigest = digest(input);
  const read = async (): Promise<Receipt | undefined> => {
    let meta;
    try {
      meta = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (
      !meta.isFile() ||
      meta.isSymbolicLink() ||
      (meta.mode & 0o077) !== 0 ||
      meta.size > 32 * 1024
    )
      throw uncertain();
    let receipt: Receipt;
    try {
      receipt = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw uncertain(error);
    }
    if (
      !receipt ||
      receipt.version !== 1 ||
      !["prepared", "created"].includes(receipt.state)
    )
      throw uncertain();
    if (receipt.requestDigest !== requestDigest)
      throw new Error("Native fork operation idempotency conflict");
    return receipt;
  };
  const bind = async (receipt: Receipt) => {
    if (
      receipt.state !== "created" ||
      typeof receipt.providerSessionId !== "string" ||
      !receipt.providerSessionId.trim()
    )
      throw uncertain();
    const existing = await store.load(input.target, { instance: true });
    if (existing !== null) {
      if (existing.providerSessionId !== receipt.providerSessionId)
        throw new Error("Native fork destination binding conflict");
      return existing;
    }
    // No source delivery, protocol, memory or compaction receipts cross identity.
    return store.record(input.target, receipt.providerSessionId, {
      instance: true,
    });
  };
  const previous = await read();
  if (previous) return bind(previous);
  const source = await store.load(input.source, {
    instance: true,
    instanceGeneration: input.sourceGeneration,
    requireExisting: true,
  });
  if (!source)
    throw new Error("RAH_SESSION_CONTINUITY_REQUIRED: source session missing");
  if (await store.load(input.target, { instance: true }))
    throw new Error("Native fork destination is already bound");
  let claim;
  try {
    claim = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const receipt = await read();
    if (!receipt) throw uncertain(error);
    return bind(receipt);
  }
  try {
    await claim.writeFile(
      JSON.stringify({ version: 1, requestDigest, state: "prepared" }),
    );
    await claim.sync();
  } finally {
    await claim.close();
  }
  await syncDirectory(directory);
  let nativeId: string;
  try {
    nativeId = await nativeFork(Object.freeze({ ...source }));
    if (
      typeof nativeId !== "string" ||
      !nativeId.trim() ||
      nativeId.length > 4096 ||
      nativeId === source.providerSessionId
    )
      throw new Error("Native fork must return a distinct session ID");
  } catch (error) {
    throw uncertain(error);
  }
  const receipt: Receipt = {
    version: 1,
    requestDigest,
    state: "created",
    providerSessionId: nativeId,
  };
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(receipt));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    throw uncertain(error);
  } finally {
    await rm(temporary, { force: true });
  }
  return bind(receipt);
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
