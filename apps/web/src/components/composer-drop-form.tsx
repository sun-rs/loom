import {
  useEffect,
  useRef,
  useState,
  type FormEventHandler,
  type ReactNode,
} from "react";
import { ComposerDropOverlay } from "@rah-os/ui-web/neo-brutalist/composer-drop-overlay";
import { isFileDrag, readDroppedFiles } from "../composer-file-drop.ts";
import { useRoomUploads } from "./room-files.tsx";

/** Only ephemeral drag state; FileUploadStore owns every draft and upload. */
export function ComposerDropForm({
  roomId,
  draftKey,
  disabled,
  onSubmit,
  children,
}: {
  roomId: string | undefined;
  draftKey: string | undefined;
  disabled: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  const uploads = useRoomUploads(roomId, draftKey);
  const allowed =
    !disabled && uploads.enabled && !!uploads.store && !!roomId && !!draftKey;
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string>();
  const depth = useRef(0);
  const generation = useRef({ roomId, draftKey, allowed });
  if (
    generation.current.roomId !== roomId ||
    generation.current.draftKey !== draftKey ||
    generation.current.allowed !== allowed
  )
    generation.current = { roomId, draftKey, allowed };
  function clear() {
    depth.current = 0;
    setOver(false);
  }
  useEffect(() => {
    clear();
    setError(undefined);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("dragend", clear);
      document.removeEventListener("drop", clear);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", clear);
    };
  }, [roomId, draftKey, allowed]);
  return (
    <form
      className="composer rah-composer-drop-target"
      onSubmit={onSubmit}
      onDragEnter={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        if (allowed && ++depth.current === 1) setOver(true);
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        if (--depth.current <= 0) clear();
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = allowed ? "copy" : "none";
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        const alreadyHandled = event.defaultPrevented;
        event.preventDefault();
        clear();
        if (
          alreadyHandled ||
          !allowed ||
          !roomId ||
          !draftKey ||
          !uploads.store
        )
          return;
        const dropped = readDroppedFiles(event.dataTransfer);
        setError(dropped.error);
        const target = generation.current;
        for (const file of dropped.files)
          void uploads.store
            .add(draftKey, roomId, file)
            .catch((caught: unknown) => {
              if (generation.current === target)
                setError(
                  caught instanceof Error ? caught.message : String(caught),
                );
            });
      }}
    >
      {over && allowed ? <ComposerDropOverlay /> : null}
      {error ? (
        <span className="rah-composer-drop-error" role="alert">
          {error}
        </span>
      ) : null}
      {children}
    </form>
  );
}
