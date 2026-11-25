import { createServer } from 'node:http';
import { once } from 'node:events';

export async function geminiEndpoint() {
  const requests = [];
  const gates = new Map();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"models":[]}');
      return;
    }
    try {
      const data = [];
      for await (const part of req) data.push(part);
      const body = JSON.parse(Buffer.concat(data));
      const prompt = body.contents?.findLast(item => item.role === 'user')?.parts?.map(part => part.text).join('\n');
      const id = /\[loom:([0-9a-f-]{36})\]/.exec(prompt)?.[1];
      const isTurn = path.includes('/gemini-3.1-pro-preview:');
      const held = isTurn && prompt?.includes('ACP-HOLD');
      const delivery = { id, path, held, at: Date.now() };
      if (isTurn) requests.push(delivery);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (text, end) => res.write('data: ' + JSON.stringify({
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, ...(end && { finishReason: 'STOP' }) }],
        ...(end && { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 } }),
      }) + '\n\n');
      if (held) {
        chunk('ACP held ', false);
        const { promise, resolve } = Promise.withResolvers();
        gates.set(id, resolve);
        const closed = () => { delivery.closed = true; resolve(); };
        res.once('close', closed);
        await promise;
        res.off('close', closed);
        gates.delete(id);
        if (res.destroyed) return;
        chunk('result', true);
      } else chunk(isTurn ? 'ACP follow-up' : 'Test title', true);
      res.end();
    } catch (error) {
      requests.push({ error: error.message, path });
      res.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + server.address().port, requests,
    release(id) { gates.get(id)?.(); },
    async close() {
      for (const resolve of gates.values()) resolve();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
