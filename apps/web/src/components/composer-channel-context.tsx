import { createContext } from "react";
import type { ComposerChannel } from "../composer-mention.ts";

/** Uses the application's authenticated Room directory, including archived Channels. */
export const ComposerChannelContext = createContext<readonly ComposerChannel[]>(
  [],
);
