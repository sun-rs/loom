// GENERATED from immutable Raft db5e399 MessageInput Composer subtree. Loom owns callbacks and file authority.
import type {ComponentProps,ReactNode} from "react";import {useIntl} from "react-intl";import {Composer,ComposerInput,ComposerToolbar,ComposerToolbarLabel,ComposerSubmit,CheckboxIndicator,ComposerActions,ComposerIconButton} from "raft-ui";import {ImagePlus,Paperclip} from "lucide-react";import Tooltip from "@loom/raft-web-source/Tooltip";
export default function OfficialComposerView({input,fileTools,variant,preventToolbarButtonPointerDownBlur,handleAttachImageClick,handleAttachFileClick,showTaskButton,alsoCreateTask,preventTaskTogglePointerDownBlur,toggleTaskModeWithoutBlur,submitTitle,preventSendButtonPointerDownBlur,submitBlocked,submitLabel,submitIcon}:{input:ComponentProps<typeof ComposerInput>;fileTools:ReactNode;variant:"full"|"compact";preventToolbarButtonPointerDownBlur:ComponentProps<typeof ComposerIconButton>["onPointerDown"];handleAttachImageClick:()=>void;handleAttachFileClick:()=>void;showTaskButton:boolean|undefined;alsoCreateTask:boolean;preventTaskTogglePointerDownBlur:ComponentProps<typeof ComposerToolbarLabel>["onPointerDown"];toggleTaskModeWithoutBlur:ComponentProps<typeof ComposerToolbarLabel>["onClick"];submitTitle:string;preventSendButtonPointerDownBlur:ComponentProps<typeof ComposerSubmit>["onPointerDown"];submitBlocked:boolean;submitLabel:string;submitIcon:ReactNode}){const {formatMessage}=useIntl();return (<Composer>
          <ComposerInput {...input} data-testid="composer-textarea" rows={1} />
          <ComposerToolbar>
            {variant === "compact" ? (
              fileTools
            ) : (
              <ComposerActions>
                <Tooltip content={formatMessage({ id: "message.composer.attachImage" })}>
                <ComposerIconButton
                  onPointerDown={preventToolbarButtonPointerDownBlur}
                  onClick={handleAttachImageClick}
                  data-slot="button"
                  aria-label={formatMessage({ id: "message.composer.attachImage" })}
                >
                  <ImagePlus size={18} />
                </ComposerIconButton>
                </Tooltip>
                <Tooltip content={formatMessage({ id: "message.composer.attachFile" })}>
                <ComposerIconButton
                  onPointerDown={preventToolbarButtonPointerDownBlur}
                  onClick={handleAttachFileClick}
                  data-slot="button"
                  aria-label={formatMessage({ id: "message.composer.attachFile" })}
                >
                  <Paperclip size={18} />
                </ComposerIconButton>
                </Tooltip>
              </ComposerActions>
            )}
            <div className="flex items-center gap-2">
              {showTaskButton && (
                <Tooltip content={formatMessage({ id: "message.composer.sendAsTaskTooltip" })}>
                {/* raft-ui's composer toolbar label (DS `rf-check` in the
                    composer bar), drawn as a button so a tap toggles without
                    taking focus from the input. */}
                <ComposerToolbarLabel
                  render={<button type="button" />}
                  role="checkbox"
                  data-testid="composer-as-task-toggle"
                  aria-checked={alsoCreateTask}
                  className="rounded-control outline-none focus-visible:shadow-focus"
                  onPointerDown={preventTaskTogglePointerDownBlur}
                  onClick={toggleTaskModeWithoutBlur}
                >
                  <CheckboxIndicator
                    checked={alsoCreateTask}
                  />
                  {formatMessage({ id: "message.composer.asTask" })}
                </ComposerToolbarLabel>
                </Tooltip>
              )}
              <Tooltip content={submitTitle}>
              <ComposerSubmit
                size="icon-sm"
                data-slot="button"
                onPointerDown={preventSendButtonPointerDownBlur}
                disabled={submitBlocked}
                aria-label={submitLabel}
              >
                {submitIcon}
              </ComposerSubmit>
              </Tooltip>
            </div>
          </ComposerToolbar>
        </Composer>);}
