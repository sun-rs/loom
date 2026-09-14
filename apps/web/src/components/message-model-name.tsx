import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { chatModelIdentifier } from "../chat-model-identifier.ts";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";

/** Same fixed-size model label in chat, DM, thread and appearance preview. */
export function MessageModelName({ name }: { name: string | undefined }) {
  return name ? (
    <span className="rah-message-agent-model" title={name}>
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
  const runtime = entities?.runtimeForAgent(agent.agentDefinitionId, bindingId);
  const model = bindingId
    ? runtime?.modelBindingDescriptors.find(
        (entry) => entry.modelBindingId === bindingId,
      )
    : undefined;
  return (
    <MessageModelName name={model ? chatModelIdentifier(model) : bindingId} />
  );
}
