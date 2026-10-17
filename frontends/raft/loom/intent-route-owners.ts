/** Presentation lifetime references only; WriteIntentSlot remains the write owner. */
type Slot = {
  readonly state: string;
  readonly current?: { readonly action: string } | null;
};
export class RouteIntentOwners {
  readonly #owners = new Set<{ slot: Slot; actions?: readonly string[] }>();
  register(slot: Slot, actions?: readonly string[]) {
    const owner = { slot, actions };
    this.#owners.add(owner);
    return () => {
      this.#owners.delete(owner);
    };
  }
  blocked() {
    return [...this.#owners].some(
      ({ slot, actions }) =>
        slot.state !== "idle" &&
        (actions === undefined ||
          (slot.current !== undefined &&
            slot.current !== null &&
            actions.includes(slot.current.action))),
    );
  }
}
