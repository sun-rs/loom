/**
 * Review P2-3: the memory detail load owner (DOM-free, so it can be tested
 * with controlled completion order). Every selection starts a new generation
 * and abandons the previous one; a response only lands while its generation
 * is current, the panel is running and its entry is the selected one. The
 * current body and the history always belong to the selected entry, and
 * detail actions are available only once the selected entry's body loaded.
 * Throwaway: deleted in phase 4 with the console.
 */
import type {
  MemoryEntryDetail,
  MemoryHistoryResponse,
  MemoryReadResponse,
} from "@rah-os/protocol";

export type MemoryDetailApi = {
  read: (entryId: string, signal: AbortSignal) => Promise<MemoryReadResponse>;
  history: (
    entryId: string,
    signal: AbortSignal,
  ) => Promise<MemoryHistoryResponse>;
};

export type MemoryDetailState = {
  selectedId: string | undefined;
  current: MemoryEntryDetail | undefined;
  history: MemoryHistoryResponse | undefined;
  error: unknown;
  /** True only when the selected entry's own body is shown. */
  actionable: boolean;
};

export type MemoryDetailLoader = {
  state: () => MemoryDetailState;
  /** Resolves true when the selected entry's body loaded. */
  select: (entryId: string) => Promise<boolean>;
  /** Reloads the current selection (after a write). */
  reload: () => Promise<boolean>;
  stop: () => void;
};

export function createMemoryDetailLoader(
  api: MemoryDetailApi,
  onChange: (state: MemoryDetailState) => void,
): MemoryDetailLoader {
  let generation = 0;
  let stopped = false;
  let controller: AbortController | undefined;
  let state: MemoryDetailState = {
    selectedId: undefined,
    current: undefined,
    history: undefined,
    error: undefined,
    actionable: false,
  };
  const set = (next: Partial<MemoryDetailState>) => {
    state = { ...state, ...next };
    state.actionable =
      state.current !== undefined && state.current.entryId === state.selectedId;
    if (!stopped) onChange(state);
  };
  const select = async (entryId: string): Promise<boolean> => {
    if (stopped) return false;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    generation += 1;
    const token = generation;
    const live = () =>
      !stopped && token === generation && state.selectedId === entryId;
    set({
      selectedId: entryId,
      current: undefined,
      history: undefined,
      error: undefined,
    });
    try {
      const read = await api.read(entryId, mine.signal);
      if (!live() || read.entry.entryId !== entryId) return false;
      set({ current: read.entry });
      const history = await api.history(entryId, mine.signal);
      if (!live() || history.entry.entryId !== entryId) return live();
      set({ history });
      return true;
    } catch (error) {
      if (!live()) return false;
      set({ current: undefined, history: undefined, error });
      return false;
    }
  };
  return {
    state: () => state,
    select,
    reload: async () =>
      state.selectedId === undefined ? false : await select(state.selectedId),
    stop: () => {
      stopped = true;
      controller?.abort();
    },
  };
}
