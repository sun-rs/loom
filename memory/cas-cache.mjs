const outboxPath = 'memory/outbox.json';
const generationPath = 'memory/cache-generation.json';
const missing = () => ({ item: null, seq: null });
const pendingReceipt = requestId => ({ ok: true, receipt: { requestId, status: 'candidate' } });

function scope(binding) {
  return [binding.sessionId, binding.principal, binding.role, binding.project, binding.cardId,
    binding.dependencies, binding.attachments, binding.authorizedIds, binding.ancestors];
}

function cachePath(generation, binding, id, project) {
  const key = Buffer.from(JSON.stringify([scope(binding), id, project])).toString('base64url');
  return `memory/cache/${generation}/${key}.json`;
}

export function createCellMemory({ now = Date.now, io, home, isOnline, getBinding } = {}) {
  const bindings = new Map();
  let queue = Promise.resolve();
  let wasOnline = false;

  function serialize(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }

  async function read(path, fallback) {
    const text = await io.read(path);
    return text == null ? fallback : JSON.parse(text);
  }

  const readOutbox = () => read(outboxPath, []);

  async function connection(refresh = false) {
    const online = await isOnline();
    let generation = await read(generationPath, 0);
    if (online && (!wasOnline || refresh)) {
      if (io.list) {
        for (const path of await io.list('memory/cache/')) await io.write(path, 'null');
      }
      await io.write(generationPath, JSON.stringify(++generation));
    }
    wasOnline = online;
    return { online, generation };
  }

  async function currentBinding(sessionId, principal) {
    const current = getBinding ? await getBinding(sessionId) : bindings.get(sessionId);
    return current?.sessionId === sessionId && current.principal === principal ? current : null;
  }

  async function reconnect(binding) {
    if (binding) bindings.set(binding.sessionId, binding);
    if (!(await connection(true)).online) return [];
    const outbox = await readOutbox();
    const results = [];
    for (const entry of [...outbox]) {
      if (!await isOnline()) break;
      const current = await currentBinding(entry.sessionId, entry.principal);
      if (!current) continue;
      const result = await home.write(current, entry.request);
      await io.write(outboxPath, JSON.stringify(outbox.filter(row => row !== entry)));
      outbox.splice(outbox.indexOf(entry), 1);
      results.push(result);
    }
    return results;
  }

  async function show(binding, id, { project } = {}) {
    if (!binding?.sessionId || !binding.principal) return missing();
    bindings.set(binding.sessionId, binding);
    const { online, generation } = await connection();
    if (!online) {
      const path = cachePath(generation, binding, id, project);
      const cached = await read(path, null);
      if (!cached || (cached.until !== null && !(now() < cached.until))) return missing();
      return cached.result;
    }
    const current = await currentBinding(binding.sessionId, binding.principal);
    if (!current) return missing();
    const path = cachePath(generation, current, id, project);
    const result = await home.access.show(current, id, { project });
    if (!result.item) {
      await io.write(path, 'null');
      return result;
    }
    const until = home.access.cacheUntil ? await home.access.cacheUntil(current, result.item)
      : result.item.sourceProject ? 0 : null;
    const cached = { ...result, cachedAt: new Date(now()).toISOString() };
    await io.write(path, until === 0 ? 'null' : JSON.stringify({ result: cached, until }));
    return result;
  }

  async function write(binding, request) {
    if (!binding?.sessionId || !binding.principal || typeof request?.requestId !== 'string' || !request.requestId.trim()) {
      return { ok: false, code: 'invalid', error: 'Expected a bound session and a memory request ID' };
    }
    const { sessionId, principal } = binding;
    bindings.set(sessionId, binding);
    if ((await connection()).online) {
      const current = await currentBinding(sessionId, principal);
      if (!current) return { ok: false, code: 'forbidden', error: 'Memory write is forbidden' };
      return home.write(current, request);
    }
    const outbox = await readOutbox();
    if (!outbox.some(row => row.sessionId === sessionId && row.principal === principal
      && row.request.requestId === request.requestId)) {
      outbox.push({ sessionId, principal, request });
      await io.write(outboxPath, JSON.stringify(outbox));
    }
    return pendingReceipt(request.requestId);
  }

  return {
    show: (binding, id, options) => serialize(() => show(binding, id, options)),
    write: (binding, request) => serialize(() => write(binding, request)),
    reconnect: binding => serialize(() => reconnect(binding)),
    readOutbox: () => serialize(readOutbox),
  };
}
