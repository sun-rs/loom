import { createServer } from 'node:http';

export async function mockProvider() {
  const requests = [];
  const endpoints = [];
  let mode = 'ok';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    endpoints.push({ method: req.method, url: req.url });
    if (req.url.startsWith('/v1/models')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'loopback', object: 'model', owned_by: 'local' }], object: 'list' }));
      return;
    }
    const anthropic = req.url.startsWith('/v1/messages');
    const chat = req.url.startsWith('/v1/chat/completions');
    if (!anthropic && !chat && !req.url.startsWith('/v1/responses')) {
      res.writeHead(404).end();
      return;
    }
    if (req.url.includes('count_tokens')) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"input_tokens":12}');
      return;
    }
    const input = JSON.parse(body);
    const number = requests.length + 1;
    const active = mode;
    requests.push({ number, time: Date.now(), protocol: anthropic ? 'messages' : chat ? 'chat' : 'responses', mode: active });
    if (active === 'rate' || active === 'error') {
      const status = active === 'rate' ? 429 : 400;
      const error = { type: status === 429 ? 'rate_limit_error' : 'invalid_request_error',
        ...(anthropic ? {} : { code: status === 429 ? 'rate_limit_exceeded' : 'invalid_request_error' }),
        message: status === 429 ? 'Rate limit exceeded for TUI-HOST-0' : 'TUI-HOST-0 controlled invalid request' };
      res.writeHead(status, { 'Content-Type': 'application/json', 'Retry-After': '0' });
      res.end(JSON.stringify({ type: 'error', error }));
      return;
    }
    const usage = { input_tokens: 12, output_tokens: 4 };
    const id = `test_${number}`;
    const reply = 'TUI-HOST-0 OK';
    if (anthropic && input.stream !== true) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: input.model,
        content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const event = (type, data) => {
      if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    };
    const output = { id: `msg_${number}`, type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: reply, annotations: [] }] };
    const response = { id, object: 'response', model: input.model, status: 'completed', output: [output],
      usage: { ...usage, total_tokens: 16, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    if (anthropic) {
      event('message_start', { message: { id, type: 'message', role: 'assistant', model: input.model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    } else if (!chat) {
      event('response.created', { response: { ...response, output: [], status: 'in_progress' } });
    }
    const chunk = (delta, finish_reason = null) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: input.model,
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    };
    if (active === 'slow' && anthropic) {
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Working' } });
    }
    const delay = setTimeout(() => {
      if (anthropic) {
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
        event('content_block_stop', { index: 0 });
        event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
        event('message_stop', {});
      } else if (chat) {
        chunk({ role: 'assistant', content: reply });
        chunk({}, 'stop');
        if (!res.destroyed) res.write('data: [DONE]\n\n');
      } else {
        event('response.output_item.added', { output_index: 0, item: { ...output, content: [], status: 'in_progress' } });
        event('response.output_text.delta', { item_id: output.id, output_index: 0, content_index: 0, delta: reply });
        event('response.output_item.done', { output_index: 0, item: output });
        event('response.completed', { response });
      }
      res.end();
    }, active === 'slow' ? 9_000 : 80);
    res.once('close', () => clearTimeout(delay));
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests, endpoints,
    mode: value => { mode = value; },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
