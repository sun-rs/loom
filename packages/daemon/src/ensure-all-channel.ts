import { DatabaseSync } from "node:sqlite";
import {
  NotFoundError,
  RoomKernel,
  readAllChannelCandidates,
  type AllChannelCandidateSnapshot,
} from "@rah-os/kernel";
import type { Room } from "@rah-os/protocol";

/**
 * hidden        the operator hid the system Channel; bootstrap does nothing
 * missing       no candidate exists; the canonical Channel can be created
 * canonical     the canonical Channel already satisfies its contract
 * name_drift    the canonical Room only lost its reserved display name
 * archived      a candidate was archived out of the permanent contract
 * private       a candidate is private; publicizing it is the operator's call
 * ambiguous     several Rooms claim the #all identity
 * unsupported   a candidate is not a Channel and cannot hold the identity
 */
export type AllChannelPrecheckStatus =
  | "ambiguous"
  | "archived"
  | "canonical"
  | "hidden"
  | "missing"
  | "name_drift"
  | "private"
  | "unsupported";

export type AllChannelPrecheck = {
  autoRecoverable: boolean;
  candidates: AllChannelCandidateSnapshot[];
  canonical: AllChannelCandidateSnapshot | undefined;
  humanMembership: "missing" | "not_applicable" | "present";
  humanPrincipalId: string;
  reason: string;
  recovery: string[];
  status: AllChannelPrecheckStatus;
  workspaceId: string;
};

/** Fail-closed startup diagnostic: carries the identities an operator must decide on. */
export class AllChannelPrecheckError extends Error {
  readonly precheck: AllChannelPrecheck;
  constructor(precheck: AllChannelPrecheck) {
    super(formatPrecheck(precheck));
    this.name = "AllChannelPrecheckError";
    this.precheck = precheck;
  }
}

function describeCandidate(candidate: AllChannelCandidateSnapshot): string {
  return [
    `roomId=${candidate.roomId}`,
    `slug=${candidate.slug}`,
    `name=${JSON.stringify(candidate.name)}`,
    `kind=${candidate.kind}`,
    `visibility=${candidate.visibility}`,
    `archived=${candidate.archivedAt ?? "no"}`,
    `systemHidden=${candidate.systemHidden}`,
    `members=${candidate.memberCount}`,
    `humanMembers=${candidate.humanMemberPrincipalIds.length}`,
    `events=${candidate.eventCount}`,
    `lastEventAt=${candidate.lastEventAt ?? "none"}`,
  ].join(" ");
}

function formatPrecheck(precheck: AllChannelPrecheck): string {
  return [
    `Existing #all needs explicit recovery before startup (${precheck.status}): ${precheck.reason}`,
    ...precheck.candidates.map(
      (candidate) => `  candidate: ${describeCandidate(candidate)}`,
    ),
    ...precheck.recovery.map((step) => `  option: ${step}`),
  ].join("\n");
}

function readCandidates(
  kernel: RoomKernel,
  workspaceId: string,
): AllChannelCandidateSnapshot[] {
  // The Kernel's Room listing is membership-scoped, so a legacy private or
  // renamed #all would stay invisible and a duplicate would be created. The
  // precheck therefore reads the same file read-only and writes nothing.
  const database = new DatabaseSync(kernel.databasePath, { readOnly: true });
  try {
    return readAllChannelCandidates(database, workspaceId);
  } finally {
    database.close();
  }
}

/** Read-only upgrade precheck. It runs before any destructive or creating write. */
export function precheckAllChannel(
  kernel: RoomKernel,
  accessToken: string,
  workspaceId: string,
): AllChannelPrecheck {
  const actor = kernel.authenticateHumanAccessToken(accessToken);
  const base: Omit<AllChannelPrecheck, "reason" | "status"> = {
    autoRecoverable: false,
    candidates: [],
    canonical: undefined,
    humanMembership: "not_applicable",
    humanPrincipalId: actor.principalId,
    recovery: [],
    workspaceId,
  };
  try {
    if (kernel.getSystemChannelVisibility(actor, { workspaceId }).hidden) {
      return {
        ...base,
        reason: "the system Channel is hidden for this Workspace",
        status: "hidden",
      };
    }
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  const candidates = readCandidates(kernel, workspaceId);
  if (candidates.length === 0) {
    return {
      ...base,
      autoRecoverable: true,
      reason: "no Room claims the #all identity yet",
      recovery: ["create the canonical public #all Channel"],
      status: "missing",
    };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      candidates,
      reason: `${candidates.length} Rooms claim the #all identity`,
      recovery: [
        "keep exactly one Room as the canonical #all and rename the others yourself",
        "no Room is renamed, archived or deleted automatically; history is preserved either way",
      ],
      status: "ambiguous",
    };
  }
  const candidate = candidates[0]!;
  const humanMembership: AllChannelPrecheck["humanMembership"] =
    candidate.humanMemberPrincipalIds.includes(actor.principalId)
      ? "present"
      : "missing";
  const membershipRecovery =
    humanMembership === "missing"
      ? [
          `the Human ${actor.principalId} is not a member of this Room; permanent #all membership is Kernel-managed, so decide explicitly whether to restore that membership`,
        ]
      : [];
  const conflict = { ...base, candidates, humanMembership };
  if (candidate.kind !== "channel" || candidate.slug !== "all") {
    return {
      ...conflict,
      reason: `a ${candidate.kind} Room named "${candidate.name}" occupies the #all identity`,
      recovery: [
        "rename that Room yourself so the reserved #all identity is free",
        ...membershipRecovery,
      ],
      status: "unsupported",
    };
  }
  if (candidate.archivedAt !== undefined) {
    return {
      ...conflict,
      reason: `the canonical #all is archived since ${candidate.archivedAt}`,
      recovery: [
        "unarchive this Room explicitly, keeping its identity and history",
        "startup will not unarchive, recreate or delete it automatically",
        ...membershipRecovery,
      ],
      status: "archived",
    };
  }
  if (candidate.visibility !== "public") {
    return {
      ...conflict,
      reason: `the canonical #all is ${candidate.visibility}; startup never publicizes a private Room`,
      recovery: [
        "decide explicitly whether this Room becomes public again, which exposes its history to every Workspace member",
        "or move its content elsewhere and free the #all identity yourself",
        ...membershipRecovery,
      ],
      status: "private",
    };
  }
  if (candidate.name !== "all") {
    return {
      ...conflict,
      autoRecoverable: true,
      canonical: candidate,
      reason: `the canonical #all display name drifted to "${candidate.name}"`,
      recovery: [
        "restore the reserved display name; identity, visibility and history are unchanged",
        ...membershipRecovery,
      ],
      status: "name_drift",
    };
  }
  return {
    ...conflict,
    autoRecoverable: true,
    canonical: candidate,
    reason: "the canonical #all satisfies its contract",
    recovery: membershipRecovery,
    status: "canonical",
  };
}

/** Bootstrap reconciliation uses canonical commands; existing Channels and history are untouched. */
export function ensureAllChannel(
  kernel: RoomKernel,
  accessToken: string,
  workspaceId: string,
  controlRoomId: string,
  options: { onPrecheck?: (precheck: AllChannelPrecheck) => void } = {},
): Room | undefined {
  const precheck = precheckAllChannel(kernel, accessToken, workspaceId);
  options.onPrecheck?.(precheck);
  if (precheck.status === "hidden") return undefined;
  if (!precheck.autoRecoverable) throw new AllChannelPrecheckError(precheck);
  const actor = kernel.authenticateHumanAccessToken(accessToken);
  const findRoom = (roomId: string) =>
    kernel.listRooms(actor, { workspaceId }).find((r) => r.roomId === roomId);
  if (precheck.status === "missing") {
    return kernel.createWorkspaceRoom(actor, {
      workspaceId,
      kind: "channel",
      name: "all",
      slug: "all",
      visibility: "public",
      idempotencyKey: "local-workbench-permanent-all-v1",
      basedOnControlRoomSeq: kernel.sync(actor, {
        roomId: controlRoomId,
        consumerId: "bootstrap-all",
      }).latestRoomSeq,
    }).room;
  }
  const canonical = precheck.canonical!;
  if (precheck.status === "name_drift") {
    // Identity-preserving repair only: same Room, same visibility, same
    // description, history appended to rather than rewritten.
    return kernel.updateWorkspaceRoom(actor, {
      basedOnRoomSeq: canonical.latestRoomSeq,
      description: canonical.description,
      idempotencyKey: `local-workbench-all-name-recovery-v1:${canonical.latestRoomSeq}`,
      name: "all",
      roomId: canonical.roomId,
      visibility: "public",
    }).room;
  }
  return findRoom(canonical.roomId) ?? roomFromSnapshot(canonical);
}

/** The Human may have lost membership of a still-canonical Room; report, do not fabricate. */
function roomFromSnapshot(candidate: AllChannelCandidateSnapshot): Room {
  return {
    createdAt: candidate.createdAt,
    ...(candidate.description === undefined
      ? {}
      : { description: candidate.description }),
    kind: "channel",
    name: candidate.name,
    roomId: candidate.roomId,
    slug: candidate.slug,
    visibility: "public",
    workspaceId: candidate.workspaceId,
  };
}
