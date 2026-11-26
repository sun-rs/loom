import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// OpenCode runs with a disposable home and only a loopback provider. The
// daemon owns the upstream request and returns a credential-free response.
export async function runOpenCodeStage(input, request) {
  const root = await mkdtemp(join(tmpdir(), 'loom-memory-stage-'));
  const route = '/' + randomUUID();
  let upstream;
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.method !== 'POST' || req.url !== route + '/chat/completions' || upstream) {
      res.writeHead(404).end();
      return;
    }
    upstream = Promise.resolve().then(request).catch(() => ({ failure: 'stage-provider' }));
    const result = await upstream;
    if (result.failure) {
      res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":{"message":"Memory stage request failed"}}');
      return;
    }
    const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({
      id: 'stage', model: 'stage', created: 0, object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason }],
    }) + '\n\n';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content: JSON.stringify({ proposals: result.proposals }) }) +
      chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const model = 'loom/stage';
    const config = {
      model, default_agent: 'loom-stage',
      agents: { 'loom-stage': { mode: 'primary', model } },
      permissions: [{ action: '*', resource: '*', effect: 'deny' }],
      providers: { loom: { name: 'Loom', env: ['LOOM_STAGE_LOOPBACK'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${server.address().port}${route}` }, models: { stage: { name: 'Stage' } } } },
    };
    const configPath = join(root, 'opencode.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    let stdout;
    try {
      ({ stdout } = await exec('opencode', ['run', '--standalone', '--archived', '--log-level', 'none',
        '--model', model, '--agent', 'loom-stage', '--format', 'json',
        '--', JSON.stringify(input)], {
        cwd: root, timeout: 45_000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, XDG_CONFIG_HOME: join(root, 'config'),
          XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
          OPENCODE_CONFIG: configPath, OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1', OPENCODE_DISABLE_AUTOUPDATE: '1',
          OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', LOOM_STAGE_LOOPBACK: 'loopback' },
      }));
    } catch {
      const result = await upstream;
      return { inputTokens: result?.inputTokens, tokens: result?.tokens, failure: 'stage-runner' };
    }
    const result = await upstream;
    if (!result) return { failure: 'stage-provider' };
    if (result.failure) return result;
    const accounting = { inputTokens: result.inputTokens, tokens: result.tokens };
    try {
      const content = stdout.split('\n').filter(Boolean).map(JSON.parse)
        .filter(event => event.type === 'text').map(event => event.part?.text).join('');
      const proposals = JSON.parse(content)?.proposals;
      if (Array.isArray(proposals)) return { ...accounting, proposals };
    } catch { /* Invalid child output leaves the stage eligible for retry. */ }
    return { ...accounting, failure: 'stage-output' };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}
