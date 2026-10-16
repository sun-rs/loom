import {
  createContext,
  useContext,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useIntl } from "react-intl";
import { Button } from "raft-ui";
import CreateTaskDialog from "../packages/web/src/components/task/CreateTaskDialog.tsx";
import type { ChannelTaskClient } from "./channel-task-client.ts";
import { createTaskBatch } from "./task-create-batch.ts";
const Context = createContext<{
  facade: ChannelTaskClient;
  changed: () => void;
} | null>(null);
export default function TaskCreate({
  facade,
  changed,
  onClose,
}: {
  facade: ChannelTaskClient;
  changed: () => void;
  onClose: () => void;
}) {
  return (
    <Context.Provider value={{ facade, changed }}>
      <CreateTaskDialog channelId={facade.channel.roomId} onClose={onClose} />
    </Context.Provider>
  );
}
/** Checked adapter replaces only the official dialog's provider state/submit handler. */
export function useTaskCreation(channelId: string, requestClose: () => void) {
  const owner = useContext(Context);
  if (!owner || owner.facade.channel.roomId !== channelId)
    throw Error("任务频道不匹配");
  const { facade, changed } = owner;
  const { formatMessage } = useIntl();
  const [titles, setTitles] = useState([""]),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [unknown, setUnknown] = useState(false);
  const busy = useRef(false);
  const onClose = () => {
    if (!busy.current && facade.channel.writes.state === "idle") requestClose();
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    const frozen = titles.map((title) => title.trim()).filter(Boolean);
    if (!frozen.length) {
      setError(formatMessage({ id: "task.create.titleRequired" }));
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setError("");
    let completed = 0;
    try {
      await createTaskBatch(
        facade,
        frozen,
        (count) => {
          completed = count;
          setUnknown(false);
          setError("");
          setTitles(frozen.slice(count).length ? frozen.slice(count) : [""]);
        },
        () => {
          setUnknown(true);
          setError(
            `已创建 ${completed} 项；当前项结果未知，后续项已暂停。请核实原请求。`,
          );
        },
      );
      busy.current = false;
      requestClose();
    } catch {
      setError(
        `已创建 ${completed} 项；当前项未创建，后续项未提交。保留未完成标题，可修正后重试。`,
      );
    } finally {
      busy.current = false;
      setSubmitting(false);
      if (completed) changed();
    }
  };
  return {
    titles,
    error,
    submitting,
    isBatch: titles.length > 1,
    onClose,
    handleSubmit,
    updateTitle: (index: number, value: string) => {
      if (!busy.current)
        setTitles((old) =>
          old.map((title, i) => (i === index ? value : title)),
        );
    },
    addRow: () => {
      if (!busy.current) setTitles((old) => [...old, ""]);
    },
    removeRow: (index: number) => {
      if (!busy.current) setTitles((old) => old.filter((_, i) => i !== index));
    },
    verification: unknown ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setUnknown(false);
          void facade.channel.writes.retry().catch(() => setUnknown(true));
        }}
      >
        核实创建结果
      </Button>
    ) : null,
  };
}
