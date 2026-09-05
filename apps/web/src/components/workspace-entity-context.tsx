import { createContext, useContext, useRef, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal } from "@rah-os/protocol";
import {
  createPrincipalObservationFence,
  type PrincipalObservation,
  type WorkspaceEntities,
} from "../workspace-entities.ts";

export const WorkspaceEntityContext = createContext<
  WorkspaceEntities | undefined
>(undefined);
export const HumanIdentityContext = createContext<
  | {
      client: RahClient;
      onOpenHuman: (id: string) => void;
      onPrincipalUpdated: (principal: Principal) => void;
      onOpenDirect: (id: string) => Promise<unknown>;
      capturePrincipal: (id: string) => PrincipalObservation;
      beginPrincipalWrite: (id: string) => PrincipalObservation;
      finishPrincipalWrite: (observation: PrincipalObservation) => void;
      subscribePrincipal: (id: string, listener: () => void) => () => void;
      commitPrincipal: (
        principal: Principal,
        observation: PrincipalObservation,
      ) => boolean;
      observePrincipal: (
        principal: Principal,
        observation: PrincipalObservation,
      ) => boolean;
    }
  | undefined
>(undefined);
export const useHumanIdentity = () => useContext(HumanIdentityContext);
export const useWorkspaceEntities = () => useContext(WorkspaceEntityContext);

export const ComputerIdentityContext = createContext<(() => void) | undefined>(
  undefined,
);

export const AgentMessageContext = createContext<
  | {
      client: RahClient;
      onOpen: (id: string) => void;
      canManageAgents?: boolean;
    }
  | undefined
>(undefined);

export function WorkspaceEntityProvider({
  entities,
  client,
  onOpen,
  onOpenHuman,
  onPrincipalUpdated,
  onOpenDirect,
  onOpenComputer,
  children,
  canManageAgents = false,
}: {
  entities: WorkspaceEntities;
  client: RahClient;
  onOpen: (id: string) => void;
  onOpenHuman: (id: string) => void;
  onPrincipalUpdated: (principal: Principal) => void;
  onOpenDirect: (id: string) => Promise<unknown>;
  onOpenComputer: () => void;
  children: ReactNode;
  canManageAgents?: boolean;
}) {
  const applyPrincipal = useRef(onPrincipalUpdated);
  applyPrincipal.current = onPrincipalUpdated;
  const actorId = entities.scope?.actorId;
  const workspaceId = entities.scope?.workspaceId;
  const principalFence = useRef<
    | {
        client: RahClient;
        actorId: string | undefined;
        workspaceId: string | undefined;
        fence: ReturnType<typeof createPrincipalObservationFence>;
      }
    | undefined
  >(undefined);
  if (
    !principalFence.current ||
    principalFence.current.client !== client ||
    principalFence.current.actorId !== actorId ||
    principalFence.current.workspaceId !== workspaceId
  ) {
    principalFence.current?.fence.invalidate();
    principalFence.current = {
      client,
      actorId,
      workspaceId,
      fence: createPrincipalObservationFence((principal) =>
        applyPrincipal.current(principal),
      ),
    };
  }
  const fence = principalFence.current.fence;
  return (
    <WorkspaceEntityContext.Provider value={entities}>
      <AgentMessageContext.Provider value={{ client, onOpen, canManageAgents }}>
        <HumanIdentityContext.Provider
          value={{
            client,
            onOpenHuman,
            onPrincipalUpdated,
            onOpenDirect,
            capturePrincipal: fence.capture,
            beginPrincipalWrite: fence.beginWrite,
            finishPrincipalWrite: fence.finishWrite,
            subscribePrincipal: fence.subscribe,
            commitPrincipal: fence.commit,
            observePrincipal: fence.observe,
          }}
        >
          <ComputerIdentityContext.Provider value={onOpenComputer}>
            {children}
          </ComputerIdentityContext.Provider>
        </HumanIdentityContext.Provider>
      </AgentMessageContext.Provider>
    </WorkspaceEntityContext.Provider>
  );
}
