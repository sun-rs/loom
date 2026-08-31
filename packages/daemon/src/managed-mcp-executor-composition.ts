import type { SecretProvider } from "./secret-provider.ts";
import type { DaemonConfig } from "./config.ts";
import {
  NodeManagedMcpExecutorRegistry,
  type ManagedMcpExecutorConnection,
} from "./managed-mcp-executor-registry.ts";

export async function createConfiguredManagedMcpExecutor(
  config: DaemonConfig,
  secretProvider: SecretProvider,
): Promise<NodeManagedMcpExecutorRegistry> {
  const connections: ManagedMcpExecutorConnection[] = [];
  for (const executor of config.managedMcpExecutors ?? []) {
    const bearerToken =
      executor.bearerToken === undefined
        ? undefined
        : await secretProvider.load(executor.bearerToken);
    connections.push({
      ...(bearerToken === undefined ? {} : { bearerToken }),
      executorRef: executor.executorRef,
      url: executor.transport.url,
    });
  }
  return new NodeManagedMcpExecutorRegistry(connections);
}
