// Local router adapter via official AppProviders.router. Draft lifetime only;
// backend writes remain owned by WriteIntentSlot and cannot be discarded here.
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  createBrowserRouter,
  RouterProvider,
  useBlocker,
  useBeforeUnload,
  type BlockerFunction,
} from "react-router-dom";
import DiscardChangesDialog from "./DiscardChangesDialog.tsx";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
type Draft = {
  discard: () => void;
  blocks: (next: URLSearchParams) => boolean;
};
const Drafts = createContext<Set<Draft> | null>(null);
export function LoomRouter({ children }: { children: ReactNode }) {
  const [router] = useState(() =>
    createBrowserRouter([{ path: "*", element: children }]),
  );
  return <RouterProvider router={router} />;
}
export function DraftNavigation({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Set<Draft>());
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        (currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search) &&
        (hasRouteBoundIntent() ||
          [...drafts].some((draft) =>
            draft.blocks(new URLSearchParams(nextLocation.search)),
          )),
      [drafts],
    ),
  );
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (drafts.size || hasRouteBoundIntent()) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [drafts],
    ),
  );
  // A pending/unknown write is not a draft and never offers a discard shortcut.
  useEffect(() => {
    if (blocker.state === "blocked" && hasRouteBoundIntent()) blocker.reset();
  }, [blocker]);
  return (
    <Drafts.Provider value={drafts}>
      {children}
      {blocker.state === "blocked" && !hasRouteBoundIntent() && (
        <DiscardChangesDialog
          onCancel={() => blocker.reset()}
          onDiscard={() => {
            if (hasRouteBoundIntent()) {
              blocker.reset();
              return;
            }
            const next = new URLSearchParams(blocker.location.search);
            const current = [...drafts].filter((draft) => draft.blocks(next));
            current.forEach((draft) => {
              drafts.delete(draft);
              draft.discard();
            });
            blocker.proceed();
          }}
        />
      )}
    </Drafts.Provider>
  );
}
export function useDraftNavigation(
  dirty: boolean,
  discard: () => void,
  blocks: (next: URLSearchParams) => boolean = () => true,
) {
  const drafts = useContext(Drafts);
  const predicate = useRef(blocks);
  predicate.current = blocks;
  const latest = useRef(discard);
  latest.current = discard;
  useLayoutEffect(() => {
    if (!dirty || !drafts) return;
    const draft = {
      discard: () => latest.current(),
      blocks: (next: URLSearchParams) => predicate.current(next),
    };
    drafts.add(draft);
    return () => {
      drafts.delete(draft);
    };
  }, [dirty, drafts]);
}
