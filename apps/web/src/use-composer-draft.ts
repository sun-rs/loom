import { createContext, useContext, useSyncExternalStore } from "react";
import type { ComposerDraftStore } from "./composer-drafts.ts";

export const DraftContext = createContext<ComposerDraftStore | null>(null);
export function useComposerDraft(key: string | undefined) {
  const store = useContext(DraftContext);
  if (!store) throw new Error("Composer requires its connected draft owner");
  const draft = useSyncExternalStore(store.subscribe, () => store.read(key));
  const updateList = (
    field: "collaboratorIds" | "reviewerIds",
    value: string[] | ((current: string[]) => string[]),
  ) => {
    store.update(key, {
      [field]:
        typeof value === "function" ? value(store.read(key)[field]) : value,
    });
  };
  return {
    body: draft.body,
    setBody: (body: string) => store.update(key, { body }),
    asTask: draft.asTask,
    setAsTask: (asTask: boolean) => store.update(key, { asTask }),
    taskAssigneeId: draft.assigneeId,
    setTaskAssigneeId: (assigneeId: string | undefined) =>
      store.update(key, { assigneeId }),
    taskCollaboratorIds: draft.collaboratorIds,
    setTaskCollaboratorIds: (
      value: string[] | ((current: string[]) => string[]),
    ) => updateList("collaboratorIds", value),
    taskReviewerIds: draft.reviewerIds,
    setTaskReviewerIds: (value: string[] | ((current: string[]) => string[])) =>
      updateList("reviewerIds", value),
    acceptDraft: () => store.accept(key, draft),
  };
}
