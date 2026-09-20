import { z } from "zod";

/** Raft Computer 1.0.18 listSkills metadata; local read outcomes are explicit. */
export const AgentSkillSchema = z
  .object({
    name: z.string().min(1).max(512),
    displayName: z.string().min(1).max(512),
    description: z.string().max(8192),
    userInvocable: z.boolean(),
    sourcePath: z.string().min(1).max(4096),
  })
  .strict();
export const AgentSkillsIssueSchema = z.enum([
  "unsupported_runtime",
  "unresolved_runtime",
  "unresolved_home",
  "blocked_path",
  "read_failed",
  "metadata_limit",
  "scan_limit",
]);
export const AgentSkillsScopeSchema = z
  .object({
    state: z.enum(["ready", "partial", "error", "unavailable"]),
    skills: z.array(AgentSkillSchema).max(1000),
    truncated: z.boolean(),
    issues: z.array(AgentSkillsIssueSchema).max(7),
  })
  .strict();
export const AgentSkillsListRequestSchema = z
  .object({
    agentId: z.string().min(1),
  })
  .strict();
export const AgentSkillsListSchema = z
  .object({
    executionPolicyRevisionId: z.string().min(1),
    runtimeOfferId: z.string().min(1).optional(),
    cliId: z.string().min(1).optional(),
    global: AgentSkillsScopeSchema,
    workspace: AgentSkillsScopeSchema,
  })
  .strict();
export type AgentSkill = z.infer<typeof AgentSkillSchema>;
export type AgentSkillsIssue = z.infer<typeof AgentSkillsIssueSchema>;
export type AgentSkillsScope = z.infer<typeof AgentSkillsScopeSchema>;
export type AgentSkillsList = z.infer<typeof AgentSkillsListSchema>;
