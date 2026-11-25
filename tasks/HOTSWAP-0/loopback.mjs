import { createServer } from 'node:http';

export async function modelEndpoint(onRequest) {
  const gates = new Map();
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-6.2-sol', object: 'model', owned_by: 'test' }] }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
      res.writeHead(404).end();
      return;
    }
    try {
      const pieces = [];
      for await (const chunk of req) pieces.push(chunk);
      const request = JSON.parse(Buffer.concat(pieces));
      const user = request.input?.findLast(item => item.role === 'user');
      const input = user?.content?.map(part => part.text).join('\n') ?? '';
      const delivery = /\[loom:([0-9a-f-]{36})\]/.exec(input)?.[1];
      const kind = /HS-(LEADER-HOLD|WORKER-HOLD|QUEUED|FOLLOWUP|AUDITOR|LEADER-START)/.exec(input)?.[1] ??
        (input.includes('波次 HSW') ? 'WAVE' : 'other');
      const number = requests.length + 1;
      const entry = { number, at: Date.now(), kind, delivery, port: req.socket.remotePort };
      requests.push(entry);
      onRequest(entry);
      const gate = gates.get(kind);
      if (gate) {
        const closed = () => { entry.closedBeforeRelease = true; };
        res.once('close', closed);
        await gate.promise;
        res.off('close', closed);
      }
      if (res.destroyed) return;
      const output = {
        id: 'msg_' + number, type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer',
        content: [{ type: 'output_text', text: kind === 'WORKER-HOLD' ? 'DONE HSW verified' : 'OK ' + kind,
          annotations: [] }],
      };
      const response = {
        id: 'resp_' + number, object: 'response', model: 'gpt-6.2-sol', status: 'completed', output: [output],
        usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
      event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...output, content: [] } });
      event('response.output_text.delta', { item_id: output.id, output_index: 0, content_index: 0, delta: output.content[0].text });
      event('response.output_item.done', { output_index: 0, item: output });
      event('response.completed', { response });
      res.end();
    } catch (error) {
      onRequest({ error: error.message });
      res.destroy();
    }
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/v1',
    requests,
    hold(kind) {
      const { promise, resolve } = Promise.withResolvers();
      gates.set(kind, { promise, resolve });
    },
    release(kind) { gates.get(kind)?.resolve(); gates.delete(kind); },
    async close() {
      for (const gate of gates.values()) gate.resolve();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
