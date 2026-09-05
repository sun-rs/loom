import { useContext } from "react";
import {
  ComputerIdentityContext,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";

/** Current local host only, resolved through the same authorized binding as previews. */
export function AgentComputerIdentity({ agentId }: { agentId: string }) {
  const entities = useWorkspaceEntities();
  const open = useContext(ComputerIdentityContext);
  const computer = entities?.computerForAgent(agentId);
  if (!computer) return <>未绑定</>;
  return open ? (
    <button
      type="button"
      className="rah-profile-entity-link"
      aria-label="打开计算机资料"
      onClick={open}
    >
      {computer.displayName}
    </button>
  ) : (
    <>{computer.displayName}</>
  );
}
