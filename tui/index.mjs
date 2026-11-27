import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { deliveryId, messageIdPattern, wireText } from '../inbox/message.mjs';
import { agyPasteSegments, QUIET_OUTPUT_MS } from './agent-input.mjs';
import { draftExpectation, isAgyDraftSubset, verifyAgyDraft, verifyDraft, verifyReflowedDraft } from './composer-draft.mjs';
import { screenPrompt } from '../adapters/prompt-state.mjs';
import { blocksInput, currentTitle, isDialog, isFailure } from './agent-status.mjs';
import { hcBackend, hcWrappedBackend } from './backends.mjs';
import { nativeState } from './native.mjs';
import { hostPhase, providers } from './providers.mjs';
import { openRequestBook } from './request-book.mjs';
import { adoptionWriteId } from './holder-paste.mjs';

export { hcBackend, hcWrappedBackend };
const refusal = code => ({ kind: 'refused', code });
const digestOf = text => createHash('sha256').update(text).digest('hex');
const partialReceipt = error => ({ accepted: false, error: error.code,
  partialWrite: { written: error.written, total: error.total, reason: error.reason } });

export function createTuiHost(backend) {
  return {
    async launch({ cli, cwd, evidenceRoot, env = {}, unset = [], executable, ...launchOptions }) {
      const provider = Object.hasOwn(providers, cli) && providers[cli];
      if (!provider) throw new RangeError(`Unsupported TUI: ${cli}`);
      if (launchOptions.prompt) throw new Error('Send the initial prompt through submit');
      cwd = await realpath(cwd);
      await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
      evidenceRoot = await realpath(evidenceRoot);
      const sessionDir = await mkdtemp(join(evidenceRoot, 'tui-'));
      const hookSink = join(sessionDir, 'hooks.jsonl');
      const spec = await provider.start({ ...launchOptions, cwd, hookSink });
      const staging = spec.env.LOOM_AGY_HOOK_WORKSPACE;
      const ownedStaging = staging && dirname(staging) === sessionDir ? staging : undefined;
      if (executable) spec.argv[0] = executable;
      const name = `tui-host-0-${randomUUID().slice(0, 16)}`;
      const evidence = { cwd, evidenceRoot, hookSink, sessionId: spec.sessionId, promptSink: spec.promptSink };
      let terminal;
      try {
        terminal = await backend.launch({ cwd, argv: spec.argv, env: { ...env, ...spec.env }, unset, name, provider: cli, evidence, sessionDir });
      } catch (error) {
        if (ownedStaging) await rm(ownedStaging, { recursive: true, force: true });
        throw error;
      }
      if (terminal.remote) return {
        id: terminal.id, hookSink, ...terminal.remote,
        async close() {
          const result = await terminal.close();
          if (ownedStaging) await rm(ownedStaging, { recursive: true, force: true });
          return result;
        },
      };
      return bindTuiSession(terminal, provider, { ...evidence, ownedStaging });
    },
  };
}

export function bindTuiSession(terminal, provider, {
  ownedStaging, bookPath, incarnation, requireNative, autoTrustWorkspace, readPending,
  report = message => process.stderr.write(`loom-tui: ${message}\n`), ...evidence
}) {
  const { requests, put } = openRequestBook(bookPath);
  const native = nativeState(provider, { ...evidence, ...(terminal.provePaste && { expectedPayload: id => requests.get(id)?.digest }) });
  let sequence = Promise.resolve();
  const pendingRequest = ([id, entry]) => messageIdPattern.test(id) && !entry.confirmation?.count;
  const unsafeRequest = ([id, entry]) => pendingRequest([id, entry]) && entry.hostReceipt?.accepted !== true;
  const unresolved = () => [...requests].findLast(entry => pendingRequest(entry) && !entry[1].released)?.[0];
  const unsubmitted = () => terminal.provePaste && [...requests].findLast(unsafeRequest)?.[0];
  let pending = unsubmitted() ?? unresolved();
  let closed;
  let lastExit;
  let interruptionFallback;
  let paste;
  let startupFrame;
  let previousPrompt;
  let startupKeyAt = -Infinity;
  const startupAttempts = new Map();
  const seenUnknownHints = new Set();
  const classify = text => provider.screen.classify(text);
  const agyAnnouncement = frame => provider.id === 'agy' && frame.text != null &&
    provider.screen.startupAnnouncement?.(frame.outsideComposer ?? frame.text);
  const agyOverlayKey = frame => provider.id === 'agy' && frame.text != null &&
    provider.screen.dialogKeys?.('overlay', frame.outsideComposer ?? frame.text)?.[0];
  function classifyFrame(frame) {
    if (agyAnnouncement(frame) || agyOverlayKey(frame)) return 'overlay';
    const kind = classify(frame.composerText ?? frame.text);
    return kind === 'idle' && provider.id === 'agy' && frame.buffer === 'alternate' ? 'unknown' : kind;
  }
  const heldComposer = frame => frame.vacantText &&
    !(provider.id === 'agy' && frame.buffer === 'alternate') &&
    (classify(frame.vacantText) === 'idle' || provider.screen.hasHeldComposer?.(frame.vacantText));

  function sameInterruptedTurn(evidence) {
    return evidence.phase === 'busy' && interruptionFallback !== undefined &&
      evidence.sessionId === interruptionFallback.sessionId && evidence.activeSince === interruptionFallback.activeSince &&
      evidence.observedAt <= interruptionFallback.observedAt;
  }

  function idleBefore(native, at) {
    return !native.identityChanged && (native.phase === 'idle' && Number.isFinite(native.observedAt) && native.observedAt < at ||
      provider.screenStartup && !native.phase && !native.turnSequence);
  }

  function serialize(action) {
    const task = sequence.then(action);
    sequence = task.catch(() => {});
    return task;
  }

  async function observe() {
    const observation = await terminal.read();
    const observedAt = Date.now();
    const evidence = await native.read();
    for (const id of native.changedInputs) confirmations(id);
    native.changedInputs.clear();
    const { text, composerText = text, draft, cursor, state, agent, lastOutputAt, quietForMs, generation,
      outputSequence, buffer, bufferSequence, resizeSequence, size, humanActive, humanInputAt, humanSequence,
      writable, exited, code, reason, unknownHints } = observation;
    for (const hint of unknownHints ?? []) {
      const key = `${hint.kind}:${hint.text}`;
      if (seenUnknownHints.has(key) || seenUnknownHints.size >= 64) continue;
      seenUnknownHints.add(key);
      report?.(`${provider.id} unknown ${hint.kind} (ignored as draft): ${JSON.stringify(hint.text)}`);
    }
    const screen = text == null ? 'unavailable' : classifyFrame(observation);
    const visiblePrompt = screenPrompt(screen, composerText ?? '');
    const nativePrompt = evidence.userPrompt;
    const matchingNative = nativePrompt && (!visiblePrompt || nativePrompt.kind === visiblePrompt.kind);
    const details = matchingNative ? nativePrompt : visiblePrompt;
    const userPrompt = !exited && details ? { ...details, cli: provider.id, source: matchingNative ? 'native' : 'screen',
      since: previousPrompt?.kind === details.kind &&
        !(matchingNative && previousPrompt.source === 'native' && details.since > previousPrompt.since) ?
        previousPrompt.since : details.since ?? observedAt,
      summary: matchingNative && details.options == null && visiblePrompt ? visiblePrompt.summary : details.summary,
      options: details.options ?? visiblePrompt?.options ?? null } : undefined;
    previousPrompt = userPrompt;
    const host = hostPhase(state);
    const title = currentTitle(observation, evidence, observedAt);
    const fallback = sameInterruptedTurn(evidence);
    const empty = text != null && !(provider.id === 'agy' && buffer === 'alternate') &&
      provider.screen.hasEmptyComposer(composerText) &&
      (generation === undefined ? !draft : draft === '');
    // A stale native idle edge cannot authorize writes into current UI activity.
    const liveBlocker = userPrompt ? { phase: userPrompt.kind, source: userPrompt.source } : blocksInput(screen) ? { phase: screen, source: 'screen' } :
      blocksInput(host) ? { phase: host, source: 'host' } :
      title === 'busy' && !fallback && !evidence.phase ? { phase: title, source: 'title' } : undefined;
    const status = exited ? { phase: 'exited', source: 'host' } : liveBlocker ??
      (fallback ? { phase: 'idle', source: 'screen' } : evidence.phase ? { phase: evidence.phase, source: evidence.source } :
        { phase: host ?? screen, source: host ? 'host' : 'screen' });
    const quiet = (quietForMs ?? (lastOutputAt == null ? Infinity : observedAt - lastOutputAt)) >= QUIET_OUTPUT_MS;
    const frameReady = Boolean(!exited && writable && terminal.writeIf && status.phase === 'idle' && screen === 'idle' &&
      empty && !liveBlocker && (title !== 'busy' || fallback) && quiet && !humanActive &&
      (!requireNative || evidence.phase === 'idle' || fallback || provider.screenStartup && !evidence.phase));
    if (pending) {
      const entry = requests.get(pending);
      const confirmation = native.confirmations(pending);
      if (confirmation.count) {
        pending = unsubmitted() ?? unresolved();
        paste = undefined;
      } else if (frameReady && !terminal.provePaste && entry.hostReceipt?.accepted === false) {
        // A held or abandoned paste with no Enter can stop blocking new IDs
        // once the composer is empty. Its own ID remains reserved for reconciliation.
        put(pending, { ...entry, released: true });
        pending = undefined;
        paste = undefined;
      }
    }
    const outstanding = pending && requests.get(pending);
    const failedPartialWrite = [...requests].findLast(([, entry]) => entry.hostReceipt?.partialWrite);
    const submitted = outstanding?.hostReceipt?.accepted === true;
    const unsafe = pending && terminal.provePaste && !submitted;
    const heldRetry = submitted && quiet && writable && !humanActive && !liveBlocker && heldComposer(observation) &&
      observation.atDraftEnd && deliveryId(draft) === pending && !observation.outsideComposer?.includes(`[loom:${pending}]`);
    const retryable = submitted && (frameReady || heldRetry) && !evidence.identityChanged &&
      observedAt - outstanding.hostReceipt.submittedAt >= 1500 && !outstanding.nativeRetry && !outstanding.reenterReserved &&
      outstanding.beforeSubmit?.humanSequence === humanSequence &&
      outstanding.beforeSubmit?.sessionId === evidence.sessionId &&
      outstanding.beforeSubmit?.nativeSequence === evidence.turnSequence &&
      outstanding.beforeSubmit?.phase === evidence.phase && outstanding.beforeSubmit?.observedAt === evidence.observedAt;
    const blocker = screen === 'trust-dialog' || screen === 'overlay' ? screen :
      pending && (draft || unsafe) && !userPrompt && !blocksInput(screen) ? 'draft-held' : undefined;
    return { observation, result: {
      incarnation, ...status, observedAt, native: evidence, ...(userPrompt && { userPrompt }),
      host: { state, agent, lastOutputAt, quietForMs, generation, outputSequence, buffer, bufferSequence, resizeSequence,
        size, title, humanActive, humanInputAt, humanSequence },
      screen: { kind: screen, text, draft, cursor, empty, ...(unknownHints?.length && { unknownHints }) }, pending,
      ...(submitted && { submittedDeliveryId: pending }),
      ...(retryable && { retryableDeliveryId: pending, ...(heldRetry && { retryHeld: true }) }),
      blocker, unsafeDraft: Boolean(unsafe), ready: frameReady && !pending, urgentReady: frameReady && Boolean(pending) && !unsafe,
      ...(failedPartialWrite && { failedPartialWrite: { id: failedPartialWrite[0], ...failedPartialWrite[1].hostReceipt.partialWrite } }),
      ...(exited ? { exit: { code, reason } } : {}),
    } };
  }

  async function recoverStartup({ observation: frame, result }) {
    let adoption;
    if (result.userPrompt && result.userPrompt.kind !== 'overlay' &&
        !(result.screen.kind === 'trust-dialog' && autoTrustWorkspace)) return false;
    const announcement = agyAnnouncement(frame);
    const overlay = result.unsafeDraft && !result.native.turnSequence &&
      result.blocker === 'overlay' && announcement?.key === 'esc';
    if ((result.blocker === 'draft-held' || overlay) && readPending && terminal.provePaste) {
      const entry = requests.get(pending);
      const message = readPending(pending);
      result.heldDraftProof = 'unproven';
      result.heldDraftBytes = { status: 'unknown', written: null, total: null };
      if (message && typeof message.text === 'string' && entry.digest === digestOf(message.text)) {
        const input = wireText(pending, message.text);
        const dismissals = provider.id === 'agy' ? ['overlay-esc', 'overlay-auto-mode']
          .map(key => adoptionWriteId(incarnation, pending, key)) : [];
        const proof = terminal.provePaste(input, frame, dismissals);
        result.heldDraftBytes = { status: proof.written == null ? 'unknown' : proof.written === proof.total ? 'complete' : 'partial',
          written: proof.written, total: proof.total };
        if (proof.status === 'incomplete') result.heldDraftProof = 'incomplete';
        const beforePasteTurn = !entry.hostReceipt?.partialWrite && entry.hostReceipt?.accepted !== true && Number.isFinite(message.attemptAt) &&
          idleBefore(result.native, message.attemptAt) && !frame.outsideComposer?.includes(`[loom:${pending}]`);
        const expected = draftExpectation(input);
        const agy = provider.id === 'agy';
        const continuation = proof.continuation;
        const boundaryMismatch = agy && proof.closedBracket && continuation?.offset === 0 &&
          !verifyAgyDraft(frame, draftExpectation(agyPasteSegments(input, frame.size.rows).slice(0, continuation.segment).join('')), proof.ownsDraft);
        const completeDraft = agy ? verifyAgyDraft(frame, expected, proof.ownsDraft) ||
          proof.ownsDraft && proof.closedBracket && provider.screen.pastePlaceholder?.(frame.draft, input) :
          verifyDraft(frame, expected) || provider.screen.pastePlaceholder?.(frame.draft, input);
        if (overlay && beforePasteTurn && (proof.continuation || proof.status === 'complete')) {
          result.heldDraftProof = 'dismissing-overlay';
          adoption = { key: 'esc', token: `overlay:${pending}:${announcement.id}`, limit: 1,
            writeId: dismissals[announcement.id === 'auto-mode' ? 1 : 0],
            attemptAt: message.attemptAt, dismissFor: pending, banner: announcement.id };
        } else if (!overlay && beforePasteTurn && continuation && !boundaryMismatch && terminal.resumePaste) {
          result.heldDraftProof = 'continuing';
          adoption = { token: pending, limit: 1, entry, input, continuation,
            writeId: adoptionWriteId(incarnation, pending, 'enter'), attemptAt: message.attemptAt };
        } else if (!overlay && beforePasteTurn && proof.status === 'complete' && heldComposer(frame) && completeDraft) {
          result.heldDraftProof = 'complete';
          adoption = { key: 'enter', token: pending, limit: 1, entry,
            writeId: adoptionWriteId(incarnation, pending, 'enter'), attemptAt: message.attemptAt };
        } else if (!overlay && beforePasteTurn && proof.status === 'complete' && proof.ownsDraft && proof.dismissedOverlay &&
            result.screen.kind === 'idle' && result.screen.empty && !entry.clearResend && terminal.resumePaste) {
          result.heldDraftProof = 'repasting-after-overlay';
          adoption = { token: pending, limit: 1, entry, input, attemptAt: message.attemptAt, repaste: true,
            writeId: adoptionWriteId(incarnation, pending, 'overlay-resend-enter') };
        } else if (!overlay && beforePasteTurn && agy && terminal.resendAfterClear && proof.ownsDraft && proof.closedBracket &&
            !entry.clearResend && heldComposer(frame) && isAgyDraftSubset(frame, input)) {
          result.heldDraftProof = 'clearing-own-draft';
          adoption = { token: pending, limit: 1, entry, input, attemptAt: message.attemptAt,
            clearId: adoptionWriteId(incarnation, pending, 'clear-draft'), writeId: adoptionWriteId(incarnation, pending, 'resend-enter') };
        } else if (!overlay && beforePasteTurn && ['complete', 'reflowed'].includes(proof.status) && heldComposer(frame) &&
            verifyReflowedDraft(frame, expected)) {
          result.heldDraftProof = 'complete-after-reflow';
          adoption = { key: 'enter', token: pending, limit: 1, entry,
            writeId: adoptionWriteId(incarnation, pending, 'enter'), attemptAt: message.attemptAt };
        }
      }
    }
    const rating = !result.native.userPrompt && agyOverlayKey(frame) === '0';
    if (result.screen.kind !== 'overlay') startupAttempts.delete('overlay:0');
    if (!terminal.key || !frame.writable || frame.humanActive || frame.quietForMs < QUIET_OUTPUT_MS ||
        !rating && (['busy', 'compacting'].includes(result.native.phase) || result.host.title === 'busy')) return false;
    const { kind, text } = result.screen;
    let action;
    if (kind === 'trust-dialog' && autoTrustWorkspace && !pending && !result.native.turnSequence) {
      const [key] = provider.screen.dialogKeys(kind, text, evidence.cwd);
      if (key) action = { key, token: `trust:${key}`, limit: 2 };
    } else if (kind === 'overlay' && !result.unsafeDraft && (!pending || paste?.humanSequence === frame.humanSequence)) {
      const [key] = provider.screen.dialogKeys(kind, frame.outsideComposer ?? text);
      if (key === '0') action = { key, token: 'overlay:0', limit: 1 };
      else if ((!pending || !terminal.provePaste && paste?.id === pending && paste.resizeSequence === frame.resizeSequence &&
          paste.bufferSequence === frame.bufferSequence) && !result.native.userPrompt && !result.native.turnSequence &&
          !result.native.identityChanged && announcement?.key === 'esc') {
        const token = `overlay:${announcement.id}`;
        action = { key: 'esc', token, limit: 1, writeId: adoptionWriteId(incarnation, 'startup', token),
          attemptAt: Date.now(), dismissFor: token, banner: announcement.id };
      }
    } else if (result.blocker === 'draft-held' && paste?.id === pending && !requests.get(pending)?.reenterReserved) {
      const entry = requests.get(pending);
      if (!entry.hostReceipt?.partialWrite && entry.hostReceipt?.accepted === false && paste.humanSequence === frame.humanSequence &&
          paste.resizeSequence === frame.resizeSequence && paste.buffer === frame.buffer && paste.bufferSequence === frame.bufferSequence &&
          paste.turnSequence === result.native.turnSequence &&
          frame.outputSequence > paste.outputSequence && heldComposer(frame) &&
          !frame.outsideComposer?.includes(`[loom:${pending}]`) &&
          (result.native.phase === 'idle' || provider.screenStartup && !result.native.phase)) {
        if (verifyDraft(frame, paste.expected)) action = { key: 'enter', token: pending, limit: 1, entry };
      }
    }
    action ??= adoption;
    if (!action) { startupFrame = undefined; return false; }
    const { key, token, limit, entry, writeId, attemptAt, input, continuation, dismissFor, banner, clearId, repaste } = action;
    const attempts = startupAttempts.get(token) ?? 0;
    const stable = startupFrame?.generation === frame.generation && startupFrame.token === token;
    startupFrame = { generation: frame.generation, token };
    if (!stable || attempts >= limit || performance.now() - startupKeyAt < 1000) return false;
    const stillSafe = async (current = frame, { held } = {}) => {
      const latest = await native.read();
      return !latest.userPrompt && idleBefore(latest, attemptAt) && latest.sessionId === result.native.sessionId &&
        !native.confirmations(dismissFor ?? token).count &&
        (dismissFor ? agyAnnouncement(current)?.id === banner && agyOverlayKey(current) === 'esc' :
          !blocksInput(classifyFrame(current))) &&
        (!held || heldComposer(current));
    };
    if (writeId && !await stillSafe(frame, { held: key === 'enter' })) {
      result.heldDraftProof = 'unproven';
      return false;
    }
    let hostReceipt;
    try {
      if (clearId || continuation || repaste) {
        if (clearId) {
          // Reserve the destructive step before writing so that a restart cannot clear again.
          put(token, { ...entry, clearResend: true });
          hostReceipt = await terminal.resendAfterClear(input, frame, { clearId, enterId: writeId }, stillSafe);
        } else {
          if (repaste) put(token, { ...entry, clearResend: true });
          hostReceipt = await terminal.resumePaste(input, frame, continuation, stillSafe, writeId);
        }
        if (!hostReceipt.accepted) {
          put(token, { ...requests.get(token), hostReceipt });
          result.heldDraftProof = 'unproven';
          return false;
        }
      } else await terminal.key(key, frame.generation, writeId);
    }
    catch (error) {
      if (error.code === 'STALE_FRAME') return false;
      if (entry && error.code === 'HOLDER_PARTIAL_WRITE') {
        put(token, { ...requests.get(token), hostReceipt: partialReceipt(error) });
        return false;
      }
      if (writeId) {
        result.heldDraftProof = 'uncertain-enter';
        return false;
      }
      throw error;
    }
    if (entry) {
      const saved = requests.get(token);
      put(token, { ...saved, hostReceipt: { submittedAt: Date.now(), ...hostReceipt, accepted: true,
        outcome: repaste ? 'resent-after-overlay' : saved.clearResend ? 'resent-after-clear' :
          continuation ? 'resumed-paste' : writeId ? 'adopted-draft' : 'recovered-draft' } });
    } else startupAttempts.set(token, attempts + 1);
    startupKeyAt = performance.now();
    return true;
  }

  async function read({ passive = false } = {}) {
    if (lastExit) return lastExit;
    let frame = await observe();
    if (!passive && !frame.result.exit && await recoverStartup(frame)) frame = await observe();
    if (frame.result.exit) lastExit = frame.result;
    return frame.result;
  }

  async function until(predicate, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    do {
      const state = await read();
      if (predicate(state) || state.exit) return state;
      const remaining = deadline - performance.now();
      if (remaining <= 0) return state;
      await sleep(Math.min(100, remaining));
    } while (true);
  }

  function receipt(id) {
    const confirmation = confirmations(id);
    if (!confirmation.count) return { kind: 'unconfirmed', id, hostReceipt: requests.get(id)?.hostReceipt };
    return { kind: confirmation.count === 1 ? 'confirmed' : 'duplicate', id, confirmation,
      hostReceipt: requests.get(id)?.hostReceipt };
  }

  function confirmations(id) {
    const entry = requests.get(id);
    const observed = native.confirmations(id);
    if (entry && (observed.count > (entry.confirmation?.count ?? 0) ||
        observed.digestVersion && observed.digestVersion !== entry.confirmation?.digestVersion ||
        observed.digests?.some(digest => !entry.confirmation?.digests?.includes(digest)))) {
      put(id, { ...entry, confirmation: observed });
    }
    return observed.count ? observed : entry?.confirmation ?? observed;
  }

  return {
    id: terminal.id,
    hookSink: evidence.hookSink,
    warnings: terminal.warnings ?? [],
    readState: options => serialize(() => read(options)),
    confirmations: id => serialize(async () => { await read(); return confirmations(id); }),
    submit: ({ id = randomUUID(), text, timeoutMs = 5_000, deferMs = 0, generation, urgent = false, retry = false }) => serialize(async () => {
      if (closed) return refusal('closed');
      if (!messageIdPattern.test(id) || typeof text !== 'string' || !text.trim() ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) return refusal('invalid-input');
      if (!terminal.writeIf) return refusal('plain-hc-fallback');
      const first = await read();
      const digest = digestOf(text);
      const previous = requests.get(id);
      if (previous && previous.digest !== digest) return refusal('id-conflict');
      if (retry && (first.retryableDeliveryId !== id || native.confirmations(id).count)) return receipt(id);
      if (retry && first.retryHeld) {
        const { observation: frame, result: fresh } = await observe();
        if (fresh.retryableDeliveryId !== id || !fresh.retryHeld || !terminal.key ||
            generation !== undefined && generation !== fresh.host.generation ||
            !verifyReflowedDraft(frame, draftExpectation(wireText(id, text))) ||
            blocksInput(classify(frame.outsideComposer ?? ''))) return receipt(id);
        const entry = { ...previous, reenterReserved: true };
        put(id, entry);
        try { await terminal.key('enter', frame.generation, adoptionWriteId(incarnation, id, 're-enter')); }
        catch (error) { if (error.code !== 'STALE_FRAME') throw error; return receipt(id); }
        put(id, { ...entry, hostReceipt: { ...entry.hostReceipt, outcome: 're-enter' } });
        await until(() => native.confirmations(id).count > 0, timeoutMs);
        return receipt(id);
      }
      if (!retry && previous) return receipt(id);
      if (native.confirmations(id).count) return refusal('id-conflict');
      if (pending && !retry && urgent !== true) return refusal('previous-input-unconfirmed');
      const canWrite = value => retry ? value.retryableDeliveryId === id : value.ready || urgent === true && value.urgentReady;
      const state = await until(value => canWrite(value) || value.userPrompt || isDialog(value.screen.kind) || isFailure(value.screen.kind), deferMs);
      if (!canWrite(state)) {
        const blocked = state.userPrompt?.kind ?? [state.screen.kind, state.phase].find(kind => isDialog(kind) || isFailure(kind));
        const busy = [state.phase, state.screen.kind].some(phase => phase === 'busy' || phase === 'compacting');
        return refusal(state.exit ? 'exited' : state.host.humanActive ? 'human-active' : blocked ?? (busy ? 'busy' : 'composer-not-proven-empty'));
      }
      if (generation !== undefined && state.host.generation !== generation) return refusal('frame-changed');
      if (pending && !retry) put(pending, { ...requests.get(pending), released: true });
      const entry = { digest, ...(retry && { nativeRetry: true }), beforeSubmit: {
        humanSequence: state.host.humanSequence, sessionId: state.native.sessionId, observedAt: state.native.observedAt,
        nativeSequence: state.native.turnSequence, phase: state.native.phase,
      } };
      put(id, entry);
      pending = id;
      const input = wireText(id, text);
      paste = { id, ...state.host, turnSequence: state.native.turnSequence, expected: draftExpectation(input) };
      try {
        entry.hostReceipt = await terminal.writeIf(input, state, async (frame, { collapsed, held, reenter } = {}) => {
          const latest = await native.read();
          if (latest.userPrompt || native.confirmations(id).count || latest.sessionId !== state.native.sessionId ||
              latest.turnSequence !== state.native.turnSequence || latest.activeSince !== state.native.activeSince ||
              latest.phase !== state.native.phase || reenter && latest.identityChanged) return false;
          return !blocksInput(classifyFrame(frame)) &&
            (!held || heldComposer(frame)) &&
            (!collapsed || heldComposer(frame)) &&
            (!(reenter || retry) || (!held || frame.atDraftEnd) && !blocksInput(classify(frame.outsideComposer ?? ''))) &&
            (sameInterruptedTurn(latest) || currentTitle(frame, latest, Date.now()) !== 'busy');
        }, {
          visibleOnly: retry,
          reserveReenter() {
            entry.reenterReserved = true;
            put(id, entry);
          },
        });
      } catch (error) {
        if (error.code === 'STALE_FRAME') {
          put(id, retry ? { ...previous, nativeRetry: true } : null);
          pending = retry ? id : undefined;
          paste = undefined;
          return refusal('frame-changed');
        }
        entry.hostReceipt = error.code === 'HOLDER_PARTIAL_WRITE' ? partialReceipt(error) :
          { error: error.code ?? error.message };
      }
      put(id, entry);
      await until(() => native.confirmations(id).count > 0, entry.hostReceipt.accepted === false ? 0 : timeoutMs);
      return receipt(id);
    }),
    interrupt: ({ id, timeoutMs = 3_000, generation, turnId, sessionId, turnAt } = {}) => serialize(async () => {
      if (closed) return refusal('closed');
      if (!terminal.key) return refusal('plain-hc-fallback');
      const key = id && messageIdPattern.test(id) ? `abort:${id}` : undefined;
      if (key && requests.has(key)) return requests.get(key).receipt ?? { kind: 'unconfirmed' };
      const before = await read();
      if (before.host.humanActive) return refusal('human-active');
      if (generation !== undefined && before.host.generation !== generation) return refusal('frame-changed');
      if (sessionId && before.native.sessionId !== sessionId ||
          turnId && before.native.activeTurn !== turnId ||
          turnAt !== undefined && before.native.activeSince !== turnAt) return refusal('turn-changed');
      if (before.exit || before.userPrompt || before.unsafeDraft || before.screen.kind !== 'busy' || !before.screen.empty) return refusal('not-interruptible');
      const active = { sessionId: before.native.sessionId, turnId: before.native.activeTurn, since: before.native.activeSince,
        inputId: before.native.activeInputId };
      if (key) put(key, { active, attemptedAt: Date.now() });
      try {
        await terminal.key('esc', before.host.generation);
      } catch (error) {
        if (error.code === 'STALE_FRAME') {
          if (key) put(key, null);
          return refusal('frame-changed');
        }
        throw error;
      }
      const previousMarker = provider.screen.interruptions?.(before.screen.text) ?? 0;
      const currentRequest = requests.get(active.inputId);
      let hits = 0;
      let replaced = false;
      let after = await until(state => {
        replaced ||= state.native.sessionId !== before.native.sessionId ||
          state.native.activeSince != null && state.native.activeSince !== before.native.activeSince ||
          state.host.humanSequence !== before.host.humanSequence;
        if (replaced) return true;
        const draft = state.screen.draft;
        const restored = provider.restoresInterruptedDraft && currentRequest &&
          deliveryId(draft) === active.inputId && digestOf(draft.slice(draft.indexOf('\n') + 1)) === currentRequest.digest &&
          !blocksInput(state.screen.kind);
        if (state.native.interruption > before.native.interruption && (state.ready || restored)) return true;
        const fresh = provider.screenInterrupt && state.native.activeSince === before.native.activeSince &&
          state.host.outputSequence > before.host.outputSequence && state.host.quietForMs >= QUIET_OUTPUT_MS &&
          (restored || state.screen.kind === 'idle' && state.screen.empty &&
            (provider.screen.interruptions?.(state.screen.text) ?? 0) > previousMarker);
        hits = fresh ? hits + 1 : 0;
        return hits >= 2;
      }, timeoutMs);
      const structured = !replaced && after.native.interruption > before.native.interruption;
      const screenConfirmed = !replaced && hits >= 2;
      if (!structured && screenConfirmed) {
        interruptionFallback = before.native;
        after = await read();
      }
      const receipt = { kind: structured || screenConfirmed ? 'confirmed' : 'unconfirmed',
        source: structured ? after.native.source : screenConfirmed ? 'screen' : undefined,
        at: structured ? after.native.observedAt : Date.now(), recovered: after.ready };
      if (key) put(key, { ...requests.get(key), receipt });
      return { ...receipt, state: after };
    }),
    dialog: ({ trust = false, dismissPicker = false, onboarding = false, timeoutMs = 3_000 } = {}) => serialize(async () => {
      if (closed) return refusal('closed');
      if (!terminal.key) return refusal('plain-hc-fallback');
      const before = await read();
      if (before.host.humanActive) return refusal('human-active');
      if (!(trust && before.screen.kind === 'trust-dialog') &&
          !(dismissPicker && before.screen.kind === 'picker') && !(onboarding && before.screen.kind === 'onboarding')) return refusal('dialog-not-authorized');
      let current = before;
      for (let step = 0; step < 3; step++) {
        const keys = provider.screen.dialogKeys(current.screen.kind, current.screen.text, evidence.cwd);
        if (!keys.length || (before.screen.kind === 'picker' && keys[0] !== 'esc')) return refusal('unknown-dialog');
        await sleep(100);
        const stable = await read();
        if (stable.host.humanActive || stable.screen.text !== current.screen.text || stable.screen.kind !== current.screen.kind) return refusal('dialog-changed');
        try {
          await terminal.key(keys[0], stable.host.generation);
        } catch (error) {
          if (error.code === 'STALE_FRAME') return refusal('dialog-changed');
          throw error;
        }
        current = await until(state => state.screen.kind !== stable.screen.kind || state.screen.text !== stable.screen.text, timeoutMs);
        if (current.exit) return { kind: 'unconfirmed', state: current };
        if (current.screen.kind !== before.screen.kind) return { kind: 'advanced', state: current };
        if (keys[0] === 'enter' || keys[0] === 'esc' || current.screen.text === stable.screen.text) break;
      }
      return { kind: 'unconfirmed', state: current };
    }),
    waitExit: ({ timeoutMs = 5_000 } = {}) => serialize(() => until(state => !!state.exit, timeoutMs)),
    close: () => serialize(async () => {
      if (closed) return closed;
      const result = await terminal.close();
      if (ownedStaging) await rm(ownedStaging, { recursive: true, force: true });
      closed = result ?? { closed: true };
      return closed;
    }),
  };
}
