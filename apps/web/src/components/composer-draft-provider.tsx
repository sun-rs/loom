import { useState, type ReactNode } from "react";
import { ComposerDraftStore } from "../composer-drafts.ts";
import { DraftContext } from "../use-composer-draft.ts";
export function ComposerDraftProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ComposerDraftStore());
  return (
    <DraftContext.Provider value={store}>{children}</DraftContext.Provider>
  );
}
