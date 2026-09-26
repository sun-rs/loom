import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import {
  MEMORY_BODY_MAX_BYTES,
  type ClientMemoryImportLegacyRequest,
  type LegacyMemoryFile,
  type MemoryImportLegacyResponse,
} from "@rah-os/protocol";

type LegacyWorkspace = {
  files?: readonly { relativePath: string; bytes: number }[];
};

type Administration = {
  inspectWorkspace(
    instanceId: string,
  ): Promise<LegacyWorkspace> | LegacyWorkspace;
  readWorkspaceFile(
    instanceId: string,
    relativePath: string,
  ): Promise<{ content: string }> | { content: string };
};

type Result = MemoryImportLegacyResponse["results"][number];

/** Path the Kernel reports for a whole-mode import. */
const WHOLE_PATH = "MEMORY.md + notes/";

/**
 * Review P2-4. The order that keeps an import from reading what it will not
 * import: authorize (channel manager, instance of that channel) before the
 * Host directory is touched; intersect the request with the Host's safe
 * enumeration; reject by metadata what cannot fit one memory body (16 KiB)
 * before reading it; read only the selected files. Whole mode reads nothing
 * when the files together already exceed that budget. A requested path the
 * enumeration does not list is an explicit skip. Nothing is queued: the
 * Kernel still owns authorization, idempotency and the import itself.
 */
export async function importLegacyChannelMemory(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  command: ClientMemoryImportLegacyRequest,
  administration: Administration,
): Promise<MemoryImportLegacyResponse> {
  human.authorizeLegacyChannelMemoryImport(actor, command);
  const workspace = await administration.inspectWorkspace(command.instanceId);
  const enumerated = new Map(
    (workspace.files ?? []).map((file) => [file.relativePath, file]),
  );
  const respond = (results: Result[]): MemoryImportLegacyResponse => ({
    channelId: command.channelId,
    instanceId: command.instanceId,
    results,
  });
  const read = async (relativePath: string): Promise<LegacyMemoryFile> => ({
    relativePath,
    content: (
      await administration.readWorkspaceFile(command.instanceId, relativePath)
    ).content,
  });
  if (command.mode === "whole") {
    const total = [...enumerated.values()].reduce(
      (sum, file) => sum + file.bytes,
      0,
    );
    if (total > MEMORY_BODY_MAX_BYTES)
      return respond([
        {
          path: WHOLE_PATH,
          status: "skipped",
          reason: `the legacy files total ${String(total)} bytes, which exceeds the ${String(MEMORY_BODY_MAX_BYTES)}-byte memory body; import them per file instead`,
        },
      ]);
    const files: LegacyMemoryFile[] = [];
    for (const relativePath of enumerated.keys())
      files.push(await read(relativePath));
    return human.importLegacyChannelMemory(actor, command, files);
  }
  const requested = command.relativePaths ?? [...enumerated.keys()];
  const early = new Map<string, Result>();
  const files: LegacyMemoryFile[] = [];
  for (const relativePath of new Set(requested)) {
    const file = enumerated.get(relativePath);
    if (file === undefined)
      early.set(relativePath, {
        path: relativePath,
        status: "skipped",
        reason: "not a file of this instance's legacy memory",
      });
    else if (file.bytes > MEMORY_BODY_MAX_BYTES)
      early.set(relativePath, {
        path: relativePath,
        status: "skipped",
        reason: `${String(file.bytes)} bytes exceeds the ${String(MEMORY_BODY_MAX_BYTES)}-byte memory body`,
      });
    else files.push(await read(relativePath));
  }
  const imported =
    files.length === 0
      ? []
      : human.importLegacyChannelMemory(
          actor,
          { ...command, relativePaths: files.map((file) => file.relativePath) },
          files,
        ).results;
  const byPath = new Map(imported.map((result) => [result.path, result]));
  return respond(
    [...new Set(requested)].flatMap((path) => {
      const result = early.get(path) ?? byPath.get(path);
      return result === undefined ? [] : [result];
    }),
  );
}
