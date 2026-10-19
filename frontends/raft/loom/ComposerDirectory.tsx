import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Room } from "@rah-os/protocol";
import type { Channel } from "../packages/web/src/store/channelStore.ts";
import { projectComposerChannels } from "./composer-directory.ts";
const Viewer = createContext<string | null>(null);
export const useMessageViewerId = () => useContext(Viewer);
const Context = createContext<Channel[]>([]);
export const useComposerChannels = () => useContext(Context);
export default function ComposerDirectory({
  directory,
  children,
}: {
  directory?: {
    channels: Room[];
    archivedChannels: Room[];
    principal?: { principalId: string };
  };
  children?: ReactNode;
}) {
  const channels = useMemo(
    () =>
      projectComposerChannels(
        directory ? [...directory.channels, ...directory.archivedChannels] : [],
      ),
    [directory?.channels, directory?.archivedChannels],
  );
  return (
    <Viewer.Provider value={directory?.principal?.principalId ?? null}>
      <Context.Provider value={channels}>{children}</Context.Provider>
    </Viewer.Provider>
  );
}
