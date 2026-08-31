export type ComposerDraft = Readonly<{
  body: string;
  asTask: boolean;
  assigneeId: string | undefined;
  collaboratorIds: string[];
  reviewerIds: string[];
}>;
const EMPTY: ComposerDraft = Object.freeze({
  body: "",
  asTask: false,
  assigneeId: undefined,
  collaboratorIds: [],
  reviewerIds: [],
});

// UI-only, unsent drafts. One instance per authenticated app connection;
// no transcript cache, browser persistence, or canonical business state.
export class ComposerDraftStore {
  private readonly drafts = new Map<string, ComposerDraft>();
  private readonly listeners = new Set<() => void>();
  read(key: string | undefined): ComposerDraft {
    return key === undefined ? EMPTY : (this.drafts.get(key) ?? EMPTY);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(key: string | undefined, patch: Partial<ComposerDraft>): void {
    if (key === undefined) return;
    this.drafts.set(key, { ...this.read(key), ...patch });
    for (const listener of this.listeners) listener();
  }
  accept(key: string | undefined, submitted: ComposerDraft): void {
    if (key === undefined || this.read(key) !== submitted) return;
    this.drafts.delete(key);
    for (const listener of this.listeners) listener();
  }
}
