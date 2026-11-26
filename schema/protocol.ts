import type { TurnOutcome } from '@botiverse/oar';
import type { AgentStatus } from '@botiverse/oar/observe';

export type {
  AdapterSession, AvailableInstallation, ControlOutcome, ControlResult, Cursor,
  DeliverOptions, DeliverResult, Event, FailureClass, Frame, InputOptions, InstallationProbe,
  PromptOptions, QueryResult, RawEvent, RecordEnvelope, RejectionCode, RequestRecord, ResponseRecord,
  Runtime, RuntimeRegistry, Session, SessionCapabilities, SessionGraph, SessionOptions, SessionUsage,
  StartSession, TokenTotals, TurnOutcome,
} from '@botiverse/oar';
export type { AgentStatus, ConversationInput, SessionView, ViewTurn } from '@botiverse/oar/observe';

export type Role = 'super' | 'leader' | 'auditor' | 'worker';
export type SendMode = 'queue' | 'steer' | 'interrupt';
export type Cli = 'codex' | 'agy' | 'claude' | 'opencode';
export type ExecutionMode = 'tui' | 'headless';

export interface SessionIndex {
  readonly addr: string;
  readonly project: string;
  readonly role: Role | null;
  readonly task: string | null;
  readonly wave: string | null;
  readonly backend: ExecutionMode;
  readonly runtimeId: string | null;
  readonly cli: Cli | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly pane: string | null;
  readonly cwd: string | null;
  readonly parent: string | null;
  readonly sessionId: string | null;
  readonly transcriptPath: string | null;
  readonly baseCommit: string | null;
  readonly account: null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

export interface WaveRecord {
  readonly id: string;
  readonly parent: string | null;
  readonly members: readonly string[];
  readonly deadline: number | null;
  readonly closed?: boolean;
}

export interface DeliveryReceipt {
  readonly id: string;
  readonly deliveryId: string;
  readonly requestedMode: SendMode;
  readonly mode: SendMode;
  readonly downgraded: boolean;
  readonly status: 'queued' | 'delivered' | 'steered' | 'interrupted';
  readonly at: number;
  readonly phase?: DeliveryRecord['phase'];
  readonly issue?: string;
}

export interface DeliveryRecord {
  readonly id: string;
  readonly target: { readonly addr: string };
  readonly from?: { readonly addr: string };
  readonly text: string;
  readonly createdAt: number;
  readonly phase: 'queued' | 'sending' | 'received' | 'stopping' | 'stopped' | 'refused' | 'corrupted' | 'target-ended';
  readonly mode: SendMode;
  readonly requestedMode: SendMode;
  readonly issue?: string;
  readonly completion?: { readonly body?: string; readonly noReply?: boolean; readonly outcome?: TurnOutcome };
}

export interface CommandInputs {
  readonly spawn: {
    readonly role: Role;
    readonly cli: Cli;
    readonly mode: ExecutionMode;
    readonly model: string;
    readonly effort: string;
    readonly cwd: string;
    readonly project: string;
    readonly task: string;
    readonly wave: string;
    readonly parent?: string;
    readonly 'expect-red'?: boolean;
    readonly prompt: string;
  };
  readonly send: { readonly target: string; readonly mode?: SendMode; readonly from?: string; readonly message: string };
  readonly hist: { readonly target?: string; readonly role?: Role; readonly project?: string; readonly turns?: number; readonly level?: 'L1' | 'L2'; readonly since?: string };
  readonly state: { readonly target: string };
  readonly ls: { readonly project?: string };
  readonly stop: { readonly target: string };
  readonly daemon: { readonly action: 'start' | 'stop' | 'status'; readonly project?: string; readonly foreground?: boolean };
  readonly handover: { readonly role: Exclude<Role, 'worker'>; readonly project: string; readonly to?: string };
}

export interface CommandResults {
  readonly spawn: { readonly session: SessionIndex; readonly deliveryId: string; readonly handoff?: { readonly cwd: string; readonly argv: readonly string[] } };
  readonly send: DeliveryReceipt;
  readonly hist: { readonly level: 'L1' | 'L2'; readonly turns: readonly unknown[] };
  readonly state: { readonly addr: string; readonly state: string; readonly runtimeStatus?: AgentStatus; readonly deliveries: readonly DeliveryReceipt[] };
  readonly ls: { readonly sessions: readonly SessionIndex[] };
  readonly stop: { readonly addr: string; readonly endedAt: number };
  readonly daemon: { readonly running: boolean; readonly pid?: number };
  readonly handover: { readonly brief: string; readonly delivery?: DeliveryReceipt };
}

export type CommandErrorCode = 'invalid-arguments' | 'not-found' | 'ambiguous-target' |
  'unavailable' | 'unsupported' | 'not-ready' | 'uncertain';

export type CommandResponse<Kind extends keyof CommandResults> =
  | ({ readonly ok: true } & CommandResults[Kind])
  | { readonly ok: false; readonly error: { readonly code: CommandErrorCode; readonly message: string } };
