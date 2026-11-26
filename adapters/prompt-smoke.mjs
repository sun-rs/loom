import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { providers } from '../tui/providers.mjs';
import { promptFrames } from './prompt-fixtures.mjs';

const exec = promisify(execFile);
const marker = 'LOOM PROMPT SMOKE COMPLETE';
const inputText = 'Loom local prompt smoke';
const questions = [{ id: 'colour', header: 'Colour', question: 'Which colour should the fixture use?', multiSelect: false,
  options: [{ label: 'Blue', description: 'Use blue' }, { label: 'Green', description: 'Use green' }] }];
const toolNames = {
  claude: 'AskUserQuestion', codex: 'request_user_input', agy: 'ask_question', opencode: 'question',
};
const browseEnv = folder => ({
  HOME: folder, TMPDIR: folder, PATH: process.env.PATH, LANG: 'en_US.UTF-8', TERM: 'xterm-256color',
  XDG_CONFIG_HOME: join(folder, 'config'), XDG_CACHE_HOME: join(folder, 'cache'),
  XDG_STATE_HOME: join(folder, 'state'), XDG_DATA_HOME: join(folder, 'data'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
});
export const isolatedVersion = (command, cwd) => exec(command, ['--version'], {
  cwd, env: browseEnv(cwd), timeout: 4000, maxBuffer: 16_384,
});

async function launchFixture(cli, root, url) {
  const cwd = join(root, 'w');
  const home = join(root, 'h');
  const env = { ...browseEnv(home), NO_PROXY: '127.0.0.1,localhost' };
  await Promise.all([cwd, home].map(path => mkdir(path, { mode: 0o700 })));
  await exec('/usr/bin/git', ['init', '-q', cwd], { env });
  let model;
  if (cli === 'claude') {
    const config = join(home, '.claude');
    await mkdir(config, { mode: 0o700 });
    Object.assign(env, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: 'loopback',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', DISABLE_AUTOUPDATER: '1' });
    const settings = JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [cwd]: { hasTrustDialogAccepted: true } } });
    await Promise.all([home, config].map(path => writeFile(join(path, '.claude.json'), settings)));
    model = 'sonnet';
  } else if (cli === 'codex') {
    const config = env.CODEX_HOME = join(home, 'codex');
    await mkdir(config, { mode: 0o700 });
    model = 'gpt-5.4';
    await writeFile(join(config, 'config.toml'), [
      'model_provider="loopback"', 'check_for_update_on_startup=false', 'skip_model_catalog_refresh_on_startup=true',
      'analytics.enabled=false', 'feedback.enabled=false', '[model_providers.loopback]', 'name="Loopback"',
      `base_url="${url}/v1"`, 'wire_api="responses"', 'requires_openai_auth=false',
      'request_max_retries=0', 'stream_max_retries=0', `[projects.${JSON.stringify(cwd)}]`, 'trust_level="trusted"',
    ].join('\n'));
  } else if (cli === 'agy') {
    const config = join(home, '.gemini', 'antigravity-cli');
    await mkdir(join(config, 'cache'), { recursive: true, mode: 0o700 });
    await writeFile(join(config, 'cache', 'onboarding.json'),
      JSON.stringify({ onboardingComplete: true, consumerOnboardingComplete: true, enterpriseOnboardingComplete: true }));
    model = 'Gemini 4 Neon';
    Object.assign(env, { ANTIGRAVITY_APP_DATA_DIR: config, AGY_LLM_GATEWAY_URL: url + '/v1',
      AGY_LLM_GATEWAY_API_KEY: 'loopback', AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai',
      AGY_LLM_GATEWAY_MODELS: model + ' (Low)', AGY_LLM_GATEWAY_TIER_FLASH: model + ' (Low)', AGY_LLM_GATEWAY_TIER_PRO: model + ' (Low)' });
  } else {
    env.OPENCODE_CONFIG = join(cwd, 'opencode.json');
    Object.assign(env, { OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1', LOOPBACK_API_KEY: 'loopback' });
    model = 'acme/echo';
    await writeFile(env.OPENCODE_CONFIG, JSON.stringify({ model, providers: { acme: {
      name: 'Loopback', env: ['LOOPBACK_API_KEY'], package: '@opencode/ai/providers/openai-compatible',
      settings: { baseURL: url + '/v1' }, models: { echo: { name: 'Echo' } },
    } } }));
  }
  return { cwd, env, model };
}

function fixtureServer(cli, record) {
  return createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/v1/models')) return response.end('{"object":"list","data":[]}');
      if (request.url.includes('count_tokens')) return response.end('{"input_tokens":12}');
      if (!/^\/v1\/(?:messages|responses|chat\/completions)/.test(request.url)) return response.writeHead(404).end();
      let body = '';
      for await (const chunk of request) body += chunk;
      if (record.attempted) record.denied ||= /unavailable in Default mode|Use Loom notifications for decisions/i.test(body);
      const input = JSON.parse(body);
      const id = 'smoke_' + ++record.requests;
      const name = toolNames[cli];
      const advertised = input.tools?.some(tool => (tool.name ?? tool.function?.name) === name);
      record.advertised ||= advertised;
      const call = advertised && !record.attempted && (input.stream || cli !== 'claude');
      record.attempted ||= call;
      const args = JSON.stringify({ questions: cli === 'agy' ? questions.map(q =>
        ({ question: q.question, options: q.options.map(option => option.label), is_multi_select: false })) : questions });
      const usage = { input_tokens: 12, output_tokens: 4 };
      const answer = { type: 'text', text: marker };
      if (cli === 'claude' && !input.stream) {
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: input.model,
          content: [answer], stop_reason: 'end_turn', stop_sequence: null, usage }));
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      if (cli === 'claude') {
        event('message_start', { message: { id, type: 'message', role: 'assistant', model: input.model, content: [],
          stop_reason: null, usage: { ...usage, output_tokens: 0 } } });
        event('content_block_start', { index: 0, content_block: call ? { type: 'tool_use', id, name, input: {} } : { ...answer, text: '' } });
        event('content_block_delta', { index: 0, delta: call ? { type: 'input_json_delta', partial_json: args } : { type: 'text_delta', text: marker } });
        event('content_block_stop', { index: 0 });
        event('message_delta', { delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
        event('message_stop', {});
      } else if (cli === 'codex') {
        const item = call ? { id: 'fc_' + id, call_id: 'call_' + id, type: 'function_call', name, arguments: args } :
          { id: 'msg_' + id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: marker, annotations: [] }] };
        const result = { id, object: 'response', model: input.model, status: 'completed',
          output: [{ ...item, status: 'completed' }], usage: { ...usage, total_tokens: 16 } };
        event('response.created', { response: { ...result, output: [], status: 'in_progress' } });
        event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress',
          ...(call ? { arguments: '' } : { content: [] }) } });
        event(call ? 'response.function_call_arguments.delta' : 'response.output_text.delta',
          { item_id: item.id, output_index: 0, delta: call ? args : marker });
        event('response.output_item.done', { output_index: 0, item: result.output[0] });
        event('response.completed', { response: result });
      } else {
        const write = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', model: input.model, choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`);
        write(call ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] } :
          { role: 'assistant', content: marker });
        write({}, call ? 'tool_calls' : 'stop');
        response.write('data: [DONE]\n\n');
      }
      response.end();
    } catch { response.destroy(); }
  });
}

export async function smokePrompts(cli, binary, root) {
  const provider = providers[cli];
  for (const [kind, frame, key] of promptFrames[cli]) {
    if (provider.screen.classify(frame) !== kind || key && provider.screen.dialogKeys(kind, frame)[0] !== key) {
      throw new Error(`Prompt replay failed for ${kind}`);
    }
  }
  const record = { requests: 0, advertised: false, attempted: false, denied: false };
  const server = fixtureServer(cli, record);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let pane;
  let grid;
  let closed;
  try {
    const { cwd, env, model } = await launchFixture(cli, root, `http://127.0.0.1:${server.address().port}`);
    const hookSink = join(root, 'hooks');
    const args = await provider.start({ cwd, model, hookSink, allowNativeQuestions: false,
      ...(cli === 'opencode' && { sessionId: 'ses_' + randomUUID().replaceAll('-', '') }),
      ...(cli === 'codex' && { effort: 'low', extraArgs: ['--disable', 'memories'] }) });
    pane = pty.spawn(binary, args.argv.slice(1), { cwd, env: { ...args.env, ...env }, cols: 112, rows: 34 });
    grid = new xterm.Terminal({ cols: 112, rows: 34, allowProposedApi: true });
    pane.onData(text => grid.write(text));
    grid.onData(text => pane.write(text));
    pane.onExit(() => { closed = true; });
    const frame = () => {
      const buffer = grid.buffer.active;
      return Array.from({ length: grid.rows }, (_, line) => buffer.getLine(buffer.viewportY + line)?.translateToString(true)).join('\n');
    };
    const deadline = Date.now() + 26_000;
    let submitted = false;
    let submitAt = 0;
    let enterCount = 0;
    let dismissal;
    let checkingPicker = false;
    while (!closed && Date.now() < deadline) {
      const text = frame();
      const kind = provider.screen.classify(text);
      if (kind === 'idle' && !submitted) {
        pane.write(`\x1b[200~${inputText}\x1b[201~`);
        await wait(200);
        pane.write('\r');
        submitted = true;
        submitAt = Date.now();
        enterCount++;
      } else if (kind === 'choice' || kind === 'permission' && submitted) {
        throw new Error(`Native question unexpectedly blocked the fixture (${kind})`);
      } else if (cli === 'opencode' && submitted && !record.requests && enterCount < 4 && Date.now() - submitAt > 2000 &&
          text.split('\n').some(line => line.trim() === `┃ ${inputText}`)) {
        pane.write('\r');
        submitAt = Date.now();
        enterCount++;
      } else if (checkingPicker && kind === 'picker') {
        return { questions: record.attempted ? 'refused' : 'absent', recognisers: 'live composer and picker, prompt replays' };
      } else if (!checkingPicker && kind === 'idle' && submitted && text.includes(marker) && record.requests) {
        if (['claude', 'opencode'].includes(cli) && record.advertised ||
            ['codex', 'agy'].includes(cli) && record.advertised && !record.attempted) throw new Error('Question ban was not exercised');
        if (record.attempted && !record.denied) throw new Error('The loopback model did not receive the native question veto');
        checkingPicker = true;
        if (cli === 'opencode') pane.write('\x10');
        else {
          pane.write('/');
          await wait(180);
          for (const char of 'model') {
            pane.write(char);
            await wait(60);
          }
          if (provider.screen.classify(frame()) !== 'picker' && frame().includes('/model')) pane.write('\r');
        }
      } else if (!submitted && kind === 'overlay' && cli === 'agy' && !dismissal &&
          provider.screen.dialogKeys(kind, text)[0] === 'esc') {
        pane.write('\x1b');
        dismissal = true;
      } else if (!submitted && kind === 'trust-dialog' && cli === 'agy' && !dismissal &&
          provider.screen.dialogKeys(kind, text)[0] === 'enter') {
        pane.write('\r');
        dismissal = true;
      }
      await wait(125);
    }
    throw new Error(`Native ${checkingPicker ? 'picker check' : 'question smoke'} ${closed ? 'exited' : 'timed out'} (screen ${provider.screen.classify(frame())}, ${record.requests} loopback requests)`);
  } finally {
    if (pane && !closed) { try { pane.kill('SIGKILL'); } catch { /* Native process already exited. */ } }
    grid?.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
