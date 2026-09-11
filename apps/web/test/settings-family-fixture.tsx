import { useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Workspace, Principal } from "@rah-os/protocol";
import { WebPushSettingsContent } from "../src/components/web-push-settings.tsx";
import {
  AppearanceSettingsContent,
  AccountSettingsContent,
  LanguageRegionSettingsContent,
  WorkspaceProfileSettingsContent,
  AdministrationSettingsContent,
} from "../src/components/settings-pages.tsx";

// Bounded component fixture only. Never connects to a provider or production API.
export function SettingsFamilyFixture() {
  const [workspace, setWorkspace] = useState<Workspace>({
    workspaceId: "fixture-a",
    controlRoomId: "room-a",
    name: "Fixture Workspace",
    slug: "fixture-a",
    createdAt: "2026-09-05T00:00:00Z",
  });
  const [mode, setMode] = useState("server");
  const [principal, setPrincipal] = useState<Principal>({
    principalId: "fixture-human",
    kind: "human",
    handle: "Human",
    displayName: "Original Human",
  });
  const [accountWrites, setAccountWrites] = useState(0);
  const [canManage, setCanManage] = useState(true);
  const [writes, setWrites] = useState(0);
  const [updated, setUpdated] = useState("");
  const probe = useRef({
    failRead: false,
    seq: 7,
    defer: false,
    resolve: undefined as (() => void) | undefined,
  });
  const client = useMemo(
    () =>
      ({
        request: async (operation: string, input: Record<string, unknown>) => {
          if (operation === "principal.update") {
            setAccountWrites((n) => n + 1);
            return {
              principal: {
                principalId: "fixture-human",
                kind: "human",
                handle: "Human",
                displayName: input.displayName,
              },
            };
          }
          if (operation === "push.configuration")
            return { supported: true, subscriptionCount: 1 };
          if (operation === "push.test") return { delivered: 1 };
          if (operation === "room.sync") {
            if (probe.current.failRead)
              throw new Error("Fixture baseline unavailable");
            return { latestRoomSeq: probe.current.seq };
          }
          if (operation === "workspace.update") {
            if (input.basedOnControlRoomSeq !== probe.current.seq)
              throw new Error("Guessed sequence rejected");
            setWrites((n) => n + 1);
            if (probe.current.defer)
              await new Promise<void>((resolve) => {
                probe.current.resolve = resolve;
              });
            probe.current.seq += 5;
            return {
              event: { roomSeq: probe.current.seq },
              workspace: {
                ...input,
                controlRoomId: "room-a",
                slug: "fixture-a",
              },
            };
          }
          throw new Error(`Unexpected fixture operation: ${operation}`);
        },
      }) as unknown as RahClient,
    [],
  );
  return (
    <main
      className="app rah-product-shell"
      style={{ display: "block", height: "100vh", overflow: "auto" }}
    >
      <div data-fixture-controls>
        <button onClick={() => setMode("account")}>Fixture account</button>
        <button onClick={() => setMode("server")}>Fixture server</button>
        <button onClick={() => setMode("appearance")}>
          Fixture appearance
        </button>
        <button onClick={() => setMode("language")}>Fixture language</button>
        <button onClick={() => setMode("notifications")}>
          Fixture notifications
        </button>
        <button onClick={() => setMode("administration")}>
          Fixture administration
        </button>
        <button
          onClick={() =>
            setWorkspace((w) => ({ ...w, name: "Remote refresh" }))
          }
        >
          Fixture refresh
        </button>
        <button
          onClick={() => {
            probe.current.seq++;
          }}
        >
          Fixture remote event
        </button>
        <button
          onClick={() => {
            probe.current.failRead = true;
            setWorkspace((w) => ({
              ...w,
              workspaceId: "fixture-error",
              controlRoomId: "room-error",
            }));
          }}
        >
          Fixture read error
        </button>
        <button
          onClick={() => {
            probe.current.failRead = false;
          }}
        >
          Fixture read recovery
        </button>
        <button
          onClick={() =>
            setWorkspace((w) => ({
              ...w,
              workspaceId: "fixture-b",
              controlRoomId: "room-b",
              name: "Second Workspace",
            }))
          }
        >
          Fixture switch
        </button>
        <button
          onClick={() => {
            probe.current.defer = true;
          }}
        >
          Fixture defer
        </button>
        <button onClick={() => probe.current.resolve?.()}>
          Fixture resolve
        </button>
        <button onClick={() => setCanManage(false)}>Fixture deny</button>
        <output
          data-writes={writes}
          data-updated={updated}
          data-account-writes={accountWrites}
        />
      </div>
      {mode === "account" ? (
        <AccountSettingsContent
          client={client}
          principal={principal}
          onUpdated={setPrincipal}
        />
      ) : mode === "appearance" ? (
        <AppearanceSettingsContent />
      ) : mode === "language" ? (
        <LanguageRegionSettingsContent />
      ) : mode === "notifications" ? (
        <WebPushSettingsContent
          client={client}
          workspaceId={workspace.workspaceId}
        />
      ) : mode === "administration" ? (
        <AdministrationSettingsContent />
      ) : (
        <WorkspaceProfileSettingsContent
          canManage={canManage}
          client={client}
          workspace={workspace}
          onUpdated={(w) => {
            setUpdated(w.workspaceId);
            setWorkspace(w);
          }}
        />
      )}
    </main>
  );
}
