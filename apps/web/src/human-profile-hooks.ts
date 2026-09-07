import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientPrincipalUpdateRequest,
  HumanProfileResponse,
  Principal,
} from "@rah-os/protocol";
import {
  useHumanIdentity,
  useWorkspaceEntities,
} from "./components/workspace-entity-context.tsx";

/** Read owner shared by the full profile and hover preview. No persistent cache. */
export function useHumanProfile(
  client: RahClient,
  principalId: string,
  workspaceId: string | undefined,
) {
  const entities = useWorkspaceEntities();
  const identity = useHumanIdentity();
  const capturePrincipal = identity?.capturePrincipal;
  const observePrincipal = identity?.observePrincipal;
  const subscribePrincipal = identity?.subscribePrincipal;
  const actorId = entities?.scope?.actorId;
  const catalogRevision = entities?.catalogRevision;
  const directoryObservation = JSON.stringify([
    entities?.human(principalId),
    actorId ? entities?.human(actorId)?.membership.role : undefined,
  ]);
  const [result, setResult] = useState<{
    client: RahClient;
    workspaceId: string;
    actorId: string;
    principalId: string;
    profile: HumanProfileResponse;
  }>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!actorId || principalId !== actorId || !subscribePrincipal) return;
    return subscribePrincipal(principalId, () => setReload((n) => n + 1));
  }, [actorId, principalId, subscribePrincipal]);
  useEffect(() => {
    const controller = new AbortController();
    const observation = capturePrincipal?.(principalId);
    // A write settlement and catalog revision are background refreshes. Keep
    // the mounted editor and its local draft only for this exact authorized
    // scope; a client/workspace/actor/subject switch fails closed immediately.
    setResult((current) =>
      current?.client === client &&
      current.workspaceId === workspaceId &&
      current.actorId === actorId &&
      current.principalId === principalId
        ? current
        : undefined,
    );
    setError(undefined);
    if (workspaceId && actorId)
      void client
        .request(
          "human.profile",
          { workspaceId, principalId },
          { signal: controller.signal },
        )
        .then((profile) => {
          if (!controller.signal.aborted) {
            if (
              profile.workspaceId !== workspaceId ||
              profile.principal.principalId !== principalId
            ) {
              setResult(undefined);
              setError("成员资料响应与当前范围不匹配");
              return;
            }
            if (
              principalId === actorId &&
              observation &&
              !observePrincipal?.(profile.principal, observation)
            )
              return;
            setResult({ client, workspaceId, actorId, principalId, profile });
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            // An authorization failure must not become visible again merely
            // because the user presses retry and the error state is cleared.
            setResult(undefined);
            setError(
              cause instanceof Error ? cause.message : "读取成员资料失败",
            );
          }
        });
    return () => controller.abort();
  }, [
    client,
    principalId,
    workspaceId,
    actorId,
    catalogRevision,
    directoryObservation,
    capturePrincipal,
    observePrincipal,
    reload,
  ]);
  const profile =
    result?.client === client &&
    result.workspaceId === workspaceId &&
    result.actorId === actorId &&
    result.principalId === principalId &&
    !error
      ? entities?.humanProfile(result.profile)
      : undefined;
  return { profile, error, refresh: () => setReload((n) => n + 1) };
}

export function useHumanProfileMutation(
  client: RahClient,
  principal: Principal | undefined,
  onUpdated: (p: Principal) => void,
) {
  const identity = useHumanIdentity();
  const beginPrincipalWrite = identity?.beginPrincipalWrite;
  const finishPrincipalWrite = identity?.finishPrincipalWrite;
  const commitPrincipal = identity?.commitPrincipal;
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const scope = useRef({ client, id: principal?.principalId });
  const mounted = useRef(true);
  scope.current = { client, id: principal?.principalId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save(
    patch: Partial<
      Pick<
        ClientPrincipalUpdateRequest,
        "description" | "avatarKey" | "avatarUploadIntentId" | "displayName"
      >
    >,
    baseline = principal,
  ) {
    if (!baseline || baseline.kind !== "human" || busy.current)
      throw new Error("资料尚未准备好或正在保存");
    const target = baseline.principalId;
    const observation = beginPrincipalWrite?.(target);
    busy.current = true;
    setPending(true);
    try {
      const result = await client.request("principal.update", {
        displayName: baseline.displayName ?? baseline.handle,
        avatarKey: baseline.avatarKey ?? null,
        ...patch,
        expectedProfile: {
          displayName: baseline.displayName ?? null,
          avatarKey: baseline.avatarKey ?? null,
          description: baseline.description ?? null,
        },
      });
      if (scope.current.client === client && scope.current.id === target) {
        if (observation && !commitPrincipal?.(result.principal, observation))
          throw new Error("资料更新结果已被较新的操作取代");
        if (!observation) onUpdated(result.principal);
      }
      return result.principal;
    } finally {
      if (observation) finishPrincipalWrite?.(observation);
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return { pending, save };
}
