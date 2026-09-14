import { useState, type ReactElement } from "react";
import { ContextActions } from "@rah-os/ui-web/neo-brutalist/context-actions";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";
import { SectionCreateDialog } from "./section-create-dialog.tsx";
import { browserOpaqueId } from "../browser-opaque-id.ts";

export function SidebarGroupActions({
  id,
  children,
}: {
  id: string;
  children: ReactElement;
}) {
  const prefs = useSidebarPreferences(),
    p = prefs?.data?.preferences;
  const custom = p?.customSections.find((s) => `custom:${s.id}` === id);
  const [dialog, setDialog] = useState<"create" | "edit">();
  const [error, setError] = useState<string>();
  const disabled = !p || prefs?.pending;
  return (
    <>
      <ContextActions
        trigger={children}
        label="分区菜单"
        items={[
          ...(custom
            ? [
                {
                  key: "edit",
                  label: (
                    <>
                      <Icon name="pencil" />
                      <span>重命名 / 更换图标…</span>
                    </>
                  ),
                  disabled,
                  onSelect: () => setDialog("edit"),
                },
              ]
            : []),
          {
            key: "create",
            label: (
              <>
                <Icon name="folder-plus" />
                <span>新建分区…</span>
              </>
            ),
            disabled,
            onSelect: () => setDialog("create"),
          },
          ...(custom
            ? [
                {
                  key: "delete",
                  label: (
                    <>
                      <Icon name="trash" />
                      <span>删除分区</span>
                    </>
                  ),
                  separator: true,
                  disabled,
                  onSelect: () => {
                    void prefs
                      ?.patch({
                        customSections: p!.customSections.filter(
                          (s) => s.id !== custom.id,
                        ),
                        sectionOrder: p!.sectionOrder.filter((s) => s !== id),
                      })
                      .then((ok) => {
                        if (!ok) setError("删除分区失败，请重试");
                      });
                  },
                },
              ]
            : []),
        ]}
      />
      {error && (
        <p role="alert" className="side-hint">
          {error}
        </p>
      )}
      {dialog && (
        <SectionCreateDialog
          {...(dialog === "edit" && custom ? { initial: custom } : {})}
          onClose={() => setDialog(undefined)}
          onSubmit={async (name, emoji) => {
            if (!p) return;
            const sections =
              dialog === "edit" && custom
                ? p.customSections.map((s) =>
                    s.id === custom.id ? { ...s, name, emoji } : s,
                  )
                : [
                    ...p.customSections,
                    { id: browserOpaqueId(), name, emoji, items: [] },
                  ];
            if (!(await prefs?.patch({ customSections: sections })))
              throw new Error("保存失败，请重试");
            setDialog(undefined);
          }}
        />
      )}
    </>
  );
}
