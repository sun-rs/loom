/** Role templates never acquire membership or execution lanes. Instances reuse
 * existing Principal/Agent execution projections; this is their stable origin. */
export const ROLE_CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS role_templates (
 role_id TEXT PRIMARY KEY,
 role_revision_id TEXT NOT NULL UNIQUE,
 control_room_id TEXT NOT NULL REFERENCES rooms(room_id),
 configuration_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 deleted_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS role_revisions (
 role_revision_id TEXT PRIMARY KEY,
 role_id TEXT NOT NULL REFERENCES role_templates(role_id),
 snapshot_json TEXT NOT NULL
) STRICT;
INSERT OR IGNORE INTO role_revisions(role_revision_id,role_id,snapshot_json)
 SELECT role_revision_id, role_id,
 json_object('roleId',role_id,'roleRevisionId',role_revision_id,'controlRoomId',control_room_id,
 'configuration',json(configuration_json),'createdAt',created_at) FROM role_templates;
CREATE TABLE IF NOT EXISTS role_instances (
 instance_id TEXT PRIMARY KEY REFERENCES principals(principal_id),
 agent_id TEXT NOT NULL UNIQUE REFERENCES agent_definitions(agent_definition_id),
 role_id TEXT NOT NULL REFERENCES role_templates(role_id),
 role_revision_id TEXT NOT NULL,
 channel_id TEXT NOT NULL REFERENCES rooms(room_id)
) STRICT;
`;
