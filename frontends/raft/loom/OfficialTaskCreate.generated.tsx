// GENERATED from locked db5e399 source; explicit Loom slots/guards, not a second business owner.
import {useIntl} from "react-intl";import {Button} from "raft-ui";import {Plus} from "lucide-react";import DialogCard from "@loom/raft-web-source/DialogCard";import Banner from "@loom/raft-web-source/Banner";import {TaskTitleRow} from "@loom/raft-web-source/TaskTitleRow";import {useTaskCreation} from "./TaskCreate";
export default function CreateTaskDialog({channelId,onClose:requestClose}:{channelId:string;onClose:()=>void}){const {formatMessage}=useIntl();const {titles,error,submitting,isBatch,onClose,handleSubmit,updateTitle,addRow,removeRow,verification}=useTaskCreation(channelId,requestClose);return (<DialogCard testId="loom-create-tasks" title={formatMessage({ id: "task.create.heading" }, { count: isBatch ? 2 : 1 })} onClose={onClose}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Banner intent="warning">
              {error}
            </Banner>
          )}

          {verification}
          <fieldset disabled={submitting} className="min-w-0 space-y-4">
          <div>
            {titles.map((title, i) => (
              <TaskTitleRow
                key={i}
                index={i}
                title={title}
                placeholder={formatMessage({ id: "task.create.titlePlaceholder" }, { n: i + 1 })}
                removable={titles.length > 1}
                onChange={updateTitle}
                onRemove={removeRow}
              />
            ))}
            <Button size="sm"
              variant="outline"
              type="button"
              onClick={addRow}
              className="mt-1"
            >
              <Plus size={16} />
              {formatMessage({ id: "task.create.addAnother" })}
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="lg"
              variant="ghost"
              type="button"
              onClick={onClose}
            >
              {formatMessage({ id: "common.confirm.cancel" })}
            </Button>
            <Button size="lg"
              variant="accent"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? formatMessage({ id: "task.create.submitting" })
                : formatMessage(
                  { id: "task.create.submit" },
                  { count: isBatch ? titles.filter((t) => t.trim()).length : 1 },
                )}
            </Button>
          </div>
          </fieldset>
        </form>
    </DialogCard>);}
