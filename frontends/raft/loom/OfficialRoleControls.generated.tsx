// GENERATED from db5e399 AgentDetailPanel runtime modal and reset action button.
// Loom supplies supported runtime fields/actions. No cloud account/provider configuration.
import type {ReactNode,RefObject} from 'react';
import {DialogSurface,Button} from 'raft-ui';
import {X} from 'lucide-react';
import Modal from '@loom/raft-web-source/Modal';
import CloseButton from '@loom/raft-web-source/CloseButton';
export function OfficialRuntimeDialog({onClose,children,containerRef}:{onClose:()=>void;children:ReactNode;containerRef:RefObject<HTMLDivElement|null>}){return (<Modal onClose={onClose} layer={1}>
          <DialogSurface
            ref={containerRef}
            className="w-full max-w-md p-5"
            data-testid="agent-runtime-config-dialog"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-headline text-foreground">编辑运行时配置</h2>
              <CloseButton onClick={onClose}>
                <X size={20} />
              </CloseButton>
            </div>
            {children}
          </DialogSurface>
        </Modal>);}
export function OfficialRoleAction({onClick,disabled,danger,children}:{onClick:()=>void;disabled?:boolean;danger?:boolean;children:ReactNode}){return (<Button variant={danger ? "danger" : "outline"} size="lg"
                      onClick={onClick} disabled={disabled}
                      className="flex w-full items-center justify-center gap-2"
                    >{children}</Button>);}
