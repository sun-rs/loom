import type {
  HumanProfileResponse,
  LocalComputerObservation,
  LocalRuntimeInventoryEntry,
  Principal,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { selectBoundRuntime } from "./agent-runtime-presentation.ts";

type Input = {
  workspaceId: string | undefined;
  actorId: string | undefined;
  human: Principal | undefined;
  hostId: string | undefined;
  computer: LocalComputerObservation | undefined;
  agents: readonly WorkspaceAgentView[];
  runtimes: readonly LocalRuntimeInventoryEntry[];
};
type EntityKey =
  `${"human" | "agent" | "principal" | "computer" | "runtime"}:${string}`;
type Edge = { from: EntityKey; to: EntityKey; kind: string };
export type PrincipalObservation = Readonly<{
  principalId: string;
  generation: number;
  kind: "read" | "write";
}>;
export type PersonIdentity = Pick<
  Principal,
  | "principalId"
  | "handle"
  | "kind"
  | "avatarKey"
  | "displayName"
  | "description"
>;

/** Orders canonical Principal observations without pretending the protocol has
 * a profile revision. Starting a local write fences reads and earlier writes;
 * an authorized later read can then become the shared projection again. */
export function createPrincipalObservationFence(
  apply: (principal: Principal) => void,
) {
  const generations = new Map<string, number>();
  const pendingWrites = new Map<string, Set<number>>();
  const listeners = new Map<string, Set<() => void>>();
  let active = true;
  const capture = (principalId: string): PrincipalObservation => ({
    principalId,
    generation: generations.get(principalId) ?? 0,
    kind: "read",
  });
  const current = (observation: PrincipalObservation) =>
    active &&
    (generations.get(observation.principalId) ?? 0) ===
      observation.generation &&
    (observation.kind === "write" ||
      (pendingWrites.get(observation.principalId)?.size ?? 0) === 0);
  const finishWrite = (observation: PrincipalObservation) => {
    if (observation.kind !== "write") return;
    const pending = pendingWrites.get(observation.principalId);
    if (!pending?.delete(observation.generation)) return;
    if (pending.size > 0) return;
    pendingWrites.delete(observation.principalId);
    if (!active) return;
    for (const listener of listeners.get(observation.principalId) ?? [])
      listener();
  };
  const commit = (principal: Principal, observation: PrincipalObservation) => {
    const accepted =
      principal.principalId === observation.principalId && current(observation);
    if (accepted) apply(principal);
    // A successful write is settled by its response. This is a no-op for read
    // observations and remains idempotent with a caller's finally cleanup.
    finishWrite(observation);
    return accepted;
  };
  return {
    capture,
    beginWrite(principalId: string): PrincipalObservation {
      const generation = (generations.get(principalId) ?? 0) + 1;
      generations.set(principalId, generation);
      // An earlier write cannot commit after this generation exists, so it must
      // not keep reads fenced if its transport hangs after the newer write ends.
      pendingWrites.set(principalId, new Set([generation]));
      return { principalId, generation, kind: "write" };
    },
    finishWrite,
    subscribe(principalId: string, listener: () => void) {
      if (!active) return () => {};
      const subscriptions = listeners.get(principalId) ?? new Set<() => void>();
      subscriptions.add(listener);
      listeners.set(principalId, subscriptions);
      return () => {
        subscriptions.delete(listener);
        if (subscriptions.size === 0) listeners.delete(principalId);
      };
    },
    invalidate() {
      active = false;
      pendingWrites.clear();
      listeners.clear();
    },
    commit,
    observe: commit,
  };
}

/** Read-only join of the current actor/workspace projections, not another store.
 * The caller supplies an ACL-scoped Agent catalog; runtime bindings cannot add
 * missing Agents. No ownership/creator edges are inferred from revision editors.
 * Rebuild from current inputs, so removal and workspace switches need no cache GC.
 */
export function createWorkspaceEntities(input: Input) {
  const scoped = Boolean(input.workspaceId && input.actorId);
  const agents = new Map(
    (scoped ? input.agents : []).map((agent) => [
      agent.agentDefinitionId,
      agent,
    ]),
  );
  const people = new Map<string, PersonIdentity>();
  if (scoped && input.human && input.human.principalId === input.actorId)
    people.set(input.human.principalId, input.human);
  const edges: Edge[] = [];
  for (const agent of agents.values()) {
    people.set(agent.participantId, {
      principalId: agent.participantId,
      kind: "agent",
      handle: agent.handle,
      displayName: agent.displayName,
      ...(agent.avatarKey ? { avatarKey: agent.avatarKey } : {}),
    });
    edges.push({
      from: `agent:${agent.agentDefinitionId}`,
      to: `principal:${agent.participantId}`,
      kind: "identity",
    });
  }
  const bindings = new Map<string, Map<string, LocalRuntimeInventoryEntry>>();
  if (scoped && input.hostId)
    for (const runtime of input.runtimes) {
      const runtimeId = runtime.runtimeOfferId ?? runtime.runtimeProfileId;
      if (!runtime.configured || !runtimeId) continue;
      for (const binding of runtime.agentBindings) {
        const agent = agents.get(binding.agentDefinitionId);
        if (!agent || agent.participantId !== binding.participantId) continue;
        const options = bindings.get(agent.agentDefinitionId) ?? new Map();
        options.set(runtimeId, runtime);
        bindings.set(agent.agentDefinitionId, options);
        edges.push({
          from: `agent:${agent.agentDefinitionId}`,
          to: `runtime:${runtimeId}`,
          kind: "uses-runtime",
        });
        edges.push({
          from: `runtime:${runtimeId}`,
          to: `computer:${input.hostId}`,
          kind: "runs-on",
        });
      }
    }
  for (const id of bindings.keys())
    edges.push({
      from: `agent:${id}`,
      to: `computer:${input.hostId!}`,
      kind: "runs-on",
    });
  const runtimesForAgent = (id: string) =>
    [...(bindings.get(id)?.entries() ?? [])]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, runtime]) => runtime);
  return {
    catalogRevision: JSON.stringify(
      [...agents.values()].map((agent) => [
        agent.agentDefinitionId,
        agent.agentDefinitionRevisionId,
        agent.state,
      ]),
    ),
    scope: scoped
      ? { workspaceId: input.workspaceId!, actorId: input.actorId! }
      : undefined,
    edges: Object.freeze(edges.map((edge) => Object.freeze(edge))),
    agent: (id: string) => agents.get(id),
    person: (id: string) => people.get(id),
    humanProfile(profile: HumanProfileResponse) {
      if (!scoped || profile.workspaceId !== input.workspaceId)
        return undefined;
      return {
        ...profile,
        // Canonical relation IDs join only the currently authorized catalog.
        // Removed/unknown entities cannot be restored by an older profile response.
        createdAgents: profile.createdAgentDefinitionIds.flatMap((id) => {
          const agent = agents.get(id);
          return agent && agent.state !== "tombstoned" ? [agent] : [];
        }),
      };
    },
    // Enrich only candidates already returned by an authorized query. This does
    // not expand that query's visibility to every person in the workspace.
    resolvePerson(person: PersonIdentity): PersonIdentity {
      const known = people.get(person.principalId);
      return {
        ...person,
        ...(known?.kind === person.kind
          ? {
              ...known,
              avatarKey: known.avatarKey,
              description: known.description,
            }
          : {}),
        displayName:
          (known?.kind === person.kind
            ? known.displayName
            : person.displayName) || person.handle,
      };
    },
    computer: scoped && input.hostId ? input.computer : undefined,
    computerForAgent: (id: string) =>
      bindings.has(id) ? input.computer : undefined,
    runtimesForAgent,
    runtimeForAgent(id: string, modelBindingId?: string) {
      return selectBoundRuntime(runtimesForAgent(id), modelBindingId);
    },
    computerAgents: () =>
      [...bindings.keys()].map((id) => {
        const agent = agents.get(id)!;
        return {
          agent,
          agentDefinitionId: id,
          handle: agent.handle,
          runtimeLabel: runtimesForAgent(id)
            .map((runtime) => runtime.displayName)
            .join(" · "),
        };
      }),
  };
}

export type WorkspaceEntities = ReturnType<typeof createWorkspaceEntities>;
