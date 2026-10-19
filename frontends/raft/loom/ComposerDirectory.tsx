import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Room } from "@rah-os/protocol";
import type { Channel } from "../packages/web/src/store/channelStore.ts";
import { projectComposerChannels } from "./composer-directory.ts";
const Context = createContext<Channel[]>([]);
export const useComposerChannels = () => useContext(Context);
export default function ComposerDirectory({
  directory,
  children,
}: {
  directory?: { channels: Room[]; archivedChannels: Room[] };
  children?: ReactNode;
}) {
  const channels = useMemo(
    () =>
      projectComposerChannels(
        directory ? [...directory.channels, ...directory.archivedChannels] : [],
      ),
    [directory?.channels, directory?.archivedChannels],
  );
  return <Context.Provider value={channels}>{children}</Context.Provider>;
}
