import { modelDisplayName } from "../model-display-name.ts";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { chatModelIdentifier } from "../chat-model-identifier.ts";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";

/** Same fixed-size model label in chat, DM, thread and appearance preview. */
export function MessageModelName({
  name,
  modelId,
}: {
  name: string | undefined;
  modelId?: string | undefined;
}) {
  return name ? (
    <span className="rah-message-agent-model" title={modelId ?? name}>
      {name}
    </span>
  ) : null;
}

export function MessageAgentModelName({
  agent,
}: {
  agent: WorkspaceAgentView;
}) {
  const entities = useWorkspaceEntities();
  const bindingId = agent.modelBindingId;
  const runtime = entities?.runtimeForAgent(agent.agentId, bindingId);
  const model = bindingId
    ? runtime?.modelBindingDescriptors.find(
        (entry) => entry.modelBindingId === bindingId,
      )
    : undefined;
  return (
    <MessageModelName
      modelId={
        model || bindingId
          ? chatModelIdentifier(model ?? { modelId: bindingId! })
          : undefined
      }
      name={
        model
          ? modelDisplayName(model, runtime?.cliId)
          : bindingId
            ? modelDisplayName({ modelId: bindingId })
            : undefined
      }
    />
  );
}
