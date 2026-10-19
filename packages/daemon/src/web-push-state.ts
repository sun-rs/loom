import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ClientPushSubscription } from "@rah-os/protocol";
import webPush from "web-push";

type StoredSubscription = ClientPushSubscription & {
  principalId: string;
  updatedAt: string;
};
type State = {
  privateKey: string;
  publicKey: string;
  subscriptions: StoredSubscription[];
  version: 1;
};

/** Daemon owner-private transport credentials; never Room/conversation truth. */
export class WebPushStateStore {
  readonly #directory: string;
  readonly #path: string;
  #state: State | undefined;
  #loading: Promise<State> | undefined;
  #mutation = Promise.resolve();

  constructor(input: { directory: string }) {
    this.#directory = input.directory;
    this.#path = join(input.directory, "web-push.json");
  }

  async vapidKeys() {
    const state = await this.#load();
    return { privateKey: state.privateKey, publicKey: state.publicKey };
  }

  async list(principalId: string): Promise<ClientPushSubscription[]> {
    return (await this.#load()).subscriptions
      .filter((item) => item.principalId === principalId)
      .map(({ endpoint, keys }) => ({ endpoint, keys: { ...keys } }));
  }

  async put(principalId: string, subscription: ClientPushSubscription) {
    return await this.#mutate((state) => {
      state.subscriptions = state.subscriptions.filter(
        (item) => item.endpoint !== subscription.endpoint,
      );
      state.subscriptions.push({
        ...subscription,
        keys: { ...subscription.keys },
        principalId,
        updatedAt: new Date().toISOString(),
      });
      return state.subscriptions.filter(
        (item) => item.principalId === principalId,
      ).length;
    });
  }

  async remove(principalId: string, endpoint: string) {
    return await this.#mutate((state) => {
      const before = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter(
        (item) =>
          !(item.principalId === principalId && item.endpoint === endpoint),
      );
      return state.subscriptions.length !== before;
    });
  }

  async #mutate<T>(operation: (state: State) => T): Promise<T> {
    let result!: T;
    const pending = this.#mutation.then(async () => {
      const state = structuredClone(await this.#load());
      result = operation(state);
      await this.#persist(state);
      this.#state = state;
    });
    this.#mutation = pending.catch(() => undefined);
    await pending;
    return result;
  }

  async #load(): Promise<State> {
    if (this.#state) return this.#state;
    return (this.#loading ??= this.#read().finally(() => {
      this.#loading = undefined;
    }));
  }

  async #read(): Promise<State> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as State;
      if (
        value.version !== 1 ||
        typeof value.privateKey !== "string" ||
        typeof value.publicKey !== "string" ||
        !Array.isArray(value.subscriptions)
      )
        throw new Error("invalid Web Push state");
      this.#state = value;
      await chmod(this.#path, 0o600);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const keys = webPush.generateVAPIDKeys();
      const state: State = {
        version: 1,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        subscriptions: [],
      };
      await this.#persist(state);
      this.#state = state;
      return state;
    }
  }

  async #persist(state: State) {
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }
}
