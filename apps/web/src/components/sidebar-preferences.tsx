import {
  createContext,
  useContext,
  useImperativeHandle,
  type Ref,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";
import type { SidebarPreferences } from "@rah-os/protocol";
import { socialRequestId } from "../message-social-store.ts";
import { useSidebarDisclosure } from "../use-sidebar-disclosure.ts";
type State = RahClientOperationMap["sidebar.get"]["output"];
const Context = createContext<{
  data: State | undefined;
  pending: boolean;
  error: string | undefined;
  patch: (p: Partial<Omit<SidebarPreferences, "version">>) => Promise<boolean>;
  disclosure: Record<string, boolean>;
  setDisclosure: (section: string, open: boolean) => void;
} | null>(null);
export const useSidebarPreferences = () => useContext(Context);
export type SidebarPreferencesHandle = { refresh: () => Promise<void> };
export function SidebarPreferencesProvider({
  ref,
  client,
  workspaceId,
  enabled,
  disclosureScope,
  hostInstanceId,
  children,
}: {
  ref?: Ref<SidebarPreferencesHandle>;
  client: RahClient;
  workspaceId: string | undefined;
  enabled: boolean;
  disclosureScope: string;
  hostInstanceId: string | undefined;
  children: ReactNode;
}) {
  const disclosure = useSidebarDisclosure(disclosureScope, hostInstanceId);
  const [data, setData] = useState<State>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const epoch = useRef(0),
    head = useRef<State | undefined>(undefined),
    writing = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useImperativeHandle(ref, () => ({ refresh: () => refresh.current() }), []);
  useEffect(() => {
    let alive = true,
      loading = false;
    const generation = ++epoch.current;
    setData(undefined);
    head.current = undefined;
    writing.current = false;
    setPending(false);
    setError(undefined);
    if (!enabled || !workspaceId) return;
    const load = async (force = false) => {
      if ((!force && loading) || writing.current) return;
      loading = true;
      try {
        const next = await client.request("sidebar.get", { workspaceId });
        if (
          alive &&
          generation === epoch.current &&
          !writing.current &&
          next.preferences.version >= (head.current?.preferences.version ?? 0)
        ) {
          head.current = next;
          setData(next);
          setError(undefined);
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "侧栏偏好读取失败");
      } finally {
        loading = false;
      }
    };
    refresh.current = () => load(true);
    const onFocus = () => void load();
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      ++epoch.current;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      refresh.current = async () => {};
    };
  }, [client, workspaceId, enabled]);
  async function patch(p: Partial<Omit<SidebarPreferences, "version">>) {
    if (!enabled || !workspaceId || !head.current || writing.current)
      return false;
    const generation = epoch.current,
      expectedVersion = head.current.preferences.version;
    writing.current = true;
    setPending(true);
    setError(undefined);
    try {
      const next = await client.request("sidebar.patch", {
        workspaceId,
        expectedVersion,
        patch: p,
        idempotencyKey: socialRequestId(),
      });
      if (generation === epoch.current) {
        head.current = next;
        setData(next);
        return true;
      }
    } catch (e) {
      if (generation === epoch.current) {
        setError(e instanceof Error ? e.message : "排序保存失败");
        try {
          const latest = await client.request("sidebar.get", { workspaceId });
          if (generation === epoch.current) {
            head.current = latest;
            setData(latest);
          }
        } catch {
          /* preserve previous confirmed snapshot */
        }
      }
    } finally {
      if (generation === epoch.current) {
        writing.current = false;
        setPending(false);
      }
    }
    return false;
  }
  return (
    <Context.Provider value={{ data, pending, error, patch, ...disclosure }}>
      {children}
    </Context.Provider>
  );
}
