// GENERATED from preserved official CreateChannelDialog; original name/description/member JSX.
// Unsupported multi-Human/visibility/Slack slots are not exposed; Loom owns commands.
import {useState,type ChangeEvent,type ReactNode} from 'react';
import {useIntl} from 'react-intl';
import {Input,Textarea,Card,InputGroup,InputGroupAddon,InputGroupInput,CheckboxIndicator} from 'raft-ui';
import {Search} from 'lucide-react';
import {PICKER_GROUP_LABEL_CLASS,PICKER_ROW_CLASS} from '../upstream/channel-create-2026-10-29/memberPickerClasses';
import AvatarSlot from '../packages/web/src/components/ui/AvatarSlot.tsx';
import SectionEyebrow from '@loom/raft-web-source/SectionEyebrow';
import FormField from '../packages/web/src/components/ui/FormField.tsx';
type Member={id:string;name:string;displayName?:string;avatarUrl?:string|null;userId:string};
export function OfficialCreateChannelFields({name,description,onName,onDescription,agents,selectedAgentIds,toggleAgent,workspace}:{name:string;description:string;onName:(v:string)=>void;onDescription:(v:string)=>void;agents:Omit<Member,"userId">[];selectedAgentIds:Set<string>;toggleAgent:(id:string)=>void;workspace:ReactNode}){
 const {formatMessage}=useIntl();
 const [memberSearch,setMemberSearch]=useState('');
 const filteredAgents=agents.filter(a=>(a.displayName||a.name).toLocaleLowerCase().includes(memberSearch.trim().toLocaleLowerCase()));
 const filteredHumans:Member[]=[];
 const selectedHumanIds=new Set<string>();
 const toggleHuman=(_id:string)=>{};
 const hasMembers=agents.length>0;
 const hasFilteredMembers=filteredAgents.length>0;
 const handleNameChange=(e:ChangeEvent<HTMLInputElement>)=>onName(e.target.value);
 const handleDescriptionChange=(e:ChangeEvent<HTMLTextAreaElement>)=>onDescription(e.target.value);
 const handleMemberSearchChange=(e:ChangeEvent<HTMLInputElement>)=>setMemberSearch(e.target.value);
 return <>          <FormField label={formatMessage({ id: "channel.create.nameLabel" })} required>
            <Input aria-label="名称"
              type="text"
              value={name}
              onChange={handleNameChange}
              className="w-full"
              placeholder={formatMessage({ id: "channel.create.namePlaceholder" })}
              required
              autoFocus
            />
          </FormField>
          <FormField label={formatMessage({ id: "channel.create.descriptionLabel" })} optional>
            <Textarea aria-label="描述"
              value={description}
              onChange={handleDescriptionChange}
              className="w-full"
              placeholder={formatMessage({ id: "channel.create.descriptionPlaceholder" })}
              rows={2}
            />
          </FormField>
{workspace}          <FormField label={formatMessage({ id: "channel.create.membersLabel" })} optional>
            {hasMembers ? (
              <div className="space-y-2">
                <InputGroup>
                  <InputGroupAddon align="inline-start">
                    <Search aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="text"
                    value={memberSearch}
                    onChange={handleMemberSearchChange}
                    placeholder={formatMessage({ id: "channel.create.membersSearchPlaceholder" })}
                  />
                </InputGroup>

                {/* A multi-select list (DS Select, multiple): grouped by kind, a
                    check box per option (checked = ink), menu-row hover. */}
                <Card className="max-h-48 overflow-y-auto p-1.5">
                  {/* Agents section */}
                  {filteredAgents.length > 0 && (
                    <>
                      <SectionEyebrow as="div" className={PICKER_GROUP_LABEL_CLASS}>
                        {formatMessage({ id: "channel.create.agents" })}
                      </SectionEyebrow>
                      {filteredAgents.map((agent) => {
                        const selected = selectedAgentIds.has(agent.id);
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => toggleAgent(agent.id)}
                            className={PICKER_ROW_CLASS}
                          >
                            <CheckboxIndicator checked={selected} />
                            <AvatarSlot context="sidebar-list" type="agent" agentAvatarUrl={agent.avatarUrl} />
                            <span className="min-w-0 flex-1 truncate">{agent.displayName || agent.name}</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* Humans section */}
                  {filteredHumans.length > 0 && (
                    <>
                      <SectionEyebrow as="div" className={PICKER_GROUP_LABEL_CLASS}>
                        {formatMessage({ id: "channel.create.humans" })}
                      </SectionEyebrow>
                      {filteredHumans.map((human) => {
                        const selected = selectedHumanIds.has(human.userId);
                        return (
                          <button
                            key={human.userId}
                            type="button"
                            onClick={() => toggleHuman(human.userId)}
                            className={PICKER_ROW_CLASS}
                          >
                            <CheckboxIndicator checked={selected} />
                            <AvatarSlot context="sidebar-list" type="human" humanPlaceholder />
                            <span className="min-w-0 flex-1 truncate">{human.displayName || human.name}</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {!hasFilteredMembers && (
                    <div className="px-2.5 py-2 text-callout text-foreground-hint">
                      {formatMessage({ id: "channel.create.noMatchesFor" }, { query: memberSearch.trim() })}
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <div className="text-callout text-foreground-hint">{formatMessage({ id: "channel.create.noMembersAvailable" })}</div>
            )}
          </FormField>
</>;
}
