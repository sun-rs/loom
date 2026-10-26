/** UI-only pending gesture, structurally ported from Raft 1.21.34 Gt/f/p.
 * It owns no durable activity state, retries or queue. One pending action only.
 */
export class ActivitySwipeUndo<T> {
  private serial = 0;
  private pending?: { token: number; value: T };
  private commit: (value: T) => void;
  private change: (value: T | undefined) => void;
  constructor(
    commit: (value: T) => void,
    change: (value: T | undefined) => void,
  ) {
    this.commit = commit;
    this.change = change;
  }
  stage(value: T) {
    this.flush();
    const token = ++this.serial;
    this.pending = { token, value };
    this.change(value);
    return token;
  }
  finish(token: number, commit: boolean) {
    const pending = this.pending;
    if (!pending || pending.token !== token) return;
    this.pending = undefined;
    this.change(undefined);
    if (commit) this.commit(pending.value);
  }
  reconcile(isCurrent: (value: T) => boolean) {
    if (this.pending && !isCurrent(this.pending.value))
      this.finish(this.pending.token, false);
  }
  flush() {
    if (this.pending) this.finish(this.pending.token, true);
  }
}
