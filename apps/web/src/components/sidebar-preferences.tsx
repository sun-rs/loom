import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";
import type { SidebarPreferences } from "@rah-os/protocol";
import { socialRequestId } from "../message-social-store.ts";
type State = RahClientOperationMap["sidebar.get"]["output"];
const Context = createContext<{
  data: State | undefined;
  pending: boolean;
  error: string | undefined;
  patch: (p: Partial<Omit<SidebarPreferences, "version">>) => Promise<void>;
} | null>(null);
export const useSidebarPreferences = () => useContext(Context);
export function SidebarPreferencesProvider({
  client,
  workspaceId,
  enabled,
  children,
}: {
  client: RahClient;
  workspaceId: string | undefined;
  enabled: boolean;
  children: ReactNode;
}) {
  const [data, setData] = useState<State>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const epoch = useRef(0),
    head = useRef<State | undefined>(undefined),
    writing = useRef(false);
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
    const load = async () => {
      if (loading || writing.current) return;
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
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      ++epoch.current;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [client, workspaceId, enabled]);
  async function patch(p: Partial<Omit<SidebarPreferences, "version">>) {
    if (!enabled || !workspaceId || !head.current || writing.current) return;
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
  }
  return (
    <Context.Provider value={{ data, pending, error, patch }}>
      {children}
    </Context.Provider>
  );
}
