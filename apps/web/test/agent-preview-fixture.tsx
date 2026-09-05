import { useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { createWorkspaceEntities } from "../src/workspace-entities.ts";
import {
  AgentMessageContext,
  WorkspaceEntityContext,
} from "../src/components/workspace-entity-context.tsx";
import { MessageAgentAvatar } from "../src/components/agent-message-identity.tsx";

/** Component-only bounded responses; this fixture cannot issue real API requests. */
export function AgentPreviewFixture({ agent }: { agent: WorkspaceAgentView }) {
  const [mode, setMode] = useState("other");
  const [reads, setReads] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  const activityVersionRef = useRef(0);
  useEffect(() => {
    const advance = () => {
      activityVersionRef.current += 1;
      setActivityVersion(activityVersionRef.current);
    };
    window.addEventListener("fixture-presence", advance);
    return () => window.removeEventListener("fixture-presence", advance);
  }, []);
  const entities = useMemo(
    () =>
      createWorkspaceEntities({
        workspaceId: "fixture",
        actorId: "self",
        human: { kind: "human", principalId: "self", handle: "self" },
        hostId: "fixture-host",
        computer: {
          displayName: "Fixture Computer",
          hostname: "fixture.local",
          os: "test",
          status: "online",
          observedAt: "2026-09-05T00:00:00Z",
        },
        agents: [agent],
        runtimes: [
          {
            displayName: "Fixture Runtime",
            runtimeProfileId: "fake",
            available: true,
            configured: true,
            source: "configured",
            executable: "/fake/cli",
            modelBindingDescriptors: [],
            agentBindings: [
              {
                agentDefinitionId: agent.agentDefinitionId,
                participantId: agent.participantId,
                handle: agent.handle,
              },
            ],
          },
        ],
      }),
    [agent],
  );
  const client = useMemo(
    () =>
      ({
        async request(operation: string) {
          if (operation === "agent.get") {
            if (mode === "profile-error")
              throw new Error("fixture profile read failed");
            return {
              agent: {
                definition: { agentDefinitionId: agent.agentDefinitionId },
              },
              creator: {
                kind: "human",
                principalId: mode === "creator" ? "self" : "other",
              },
              policy: { modelIntent: { reasoning: "default" } },
            };
          }
          if (operation !== "agent.trajectory.list")
            throw new Error(`Unexpected operation ${operation}`);
          setReads((n) => n + 1);
          if (mode === "activity-error")
            throw new Error("fixture trajectory read failed");
          return {
            activities:
              mode === "empty"
                ? []
                : [
                    {
                      serverSequence: 1,
                      observedAt: "2026-09-05T00:00:00Z",
                      entry: {
                        kind: "tool_start",
                        toolName: activityVersionRef.current
                          ? "updated_fixture_tool"
                          : "exec_command",
                        toolInput: "PRIVATE COMMAND",
                        activity: "working",
                      },
                    },
                  ],
          };
        },
      }) as unknown as RahClient,
    [mode, agent.agentDefinitionId],
  );
  return (
    <section data-fixture="agent-preview-content">
      <label>
        预览权限状态
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setReads(0);
            activityVersionRef.current = 0;
            setActivityVersion(0);
          }}
        >
          {[
            "other",
            "creator",
            "manager",
            "empty",
            "activity-error",
            "profile-error",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <output data-trajectory-reads>{reads}</output>
      <WorkspaceEntityContext.Provider value={entities}>
        <AgentMessageContext.Provider
          value={{
            client,
            onOpen: () => {},
            canManageAgents: ["manager", "empty", "activity-error"].includes(
              mode,
            ),
          }}
        >
          <MessageAgentAvatar
            key={mode}
            agent={{
              ...agent,
              presence: {
                agentDefinitionId: agent.agentDefinitionId,
                activity: "working",
                reason: "working",
                activityAt: new Date(
                  Date.UTC(2026, 8, 5, 0, 0, activityVersion),
                ).toISOString(),
              },
            }}
          />
        </AgentMessageContext.Provider>
      </WorkspaceEntityContext.Provider>
    </section>
  );
}
