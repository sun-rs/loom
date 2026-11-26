import { createConnection } from 'node:net';

export const protocol = 3;
export const frameLimit = 65536;
export const methods = Object.freeze({ hello: 1, claim: 2, snapshot: 3, read: 4, write: 5, resize: 6, signal: 7, handoff: 8 });
export const statuses = Object.freeze(['applied', 'invalid', 'stale', 'busy-human', 'would-block', 'partial', 'exited', 'gap', 'unknown', 'failed']);
export const events = Object.freeze({ output: 1, resize: 2, human: 3, write: 4, exit: 5, stderr: 6 });
export const idBytes = id => {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(id ?? '')) throw new TypeError('Invalid holder UUID');
  return Buffer.from(id.replaceAll('-', ''), 'hex');
};

export const u32 = (...values) => {
  const bytes = Buffer.alloc(4 * values.length);
  values.forEach((x, i) => bytes.writeUInt32BE(x, 4 * i));
  return bytes;
};
export const u64 = (...values) => {
  const bytes = Buffer.alloc(8 * values.length);
  values.forEach((x, i) => bytes.writeBigUInt64BE(BigInt(x), 8 * i));
  return bytes;
};

export function frame(body) {
  if (!body.length || body.length > frameLimit) throw new RangeError('Invalid holder frame size');
  return Buffer.concat([u32(body.length), body]);
}

export function frameDecoder(limit = frameLimit) {
  const prefix = Buffer.alloc(4);
  let used = 0;
  let body;
  return chunk => {
    if (!body) {
      const n = Math.min(4 - used, chunk.length);
      chunk.copy(prefix, used, 0, n);
      used += n;
      if (used < 4) return;
      const size = prefix.readUInt32BE();
      if (!size || size > limit) throw new RangeError('Invalid holder frame size');
      body = Buffer.alloc(size);
      used = 0;
      chunk = chunk.subarray(n);
    }
    if (chunk.length > body.length - used) throw new RangeError('Trailing holder frame bytes');
    chunk.copy(body, used);
    used += chunk.length;
    return used === body.length ? body : undefined;
  };
}

export function holderError(code, message = `Holder v3: ${code}`) {
  return Object.assign(new Error(message), { code });
}

export function decodeSnapshot(p) {
  const pipes = p[99] === 1;
  if (pipes ? p.length !== 160 : p.length !== 152 || p[99] !== 0) throw holderError('HOLDER_FRAME');
  const get = i => p.readBigUInt64BE(i);
  const geometry = i => ({ cols: p.readUInt32BE(i), rows: p.readUInt32BE(i + 4) });
  return { generation: get(0), epoch: get(8), eventSeq: get(16), outputOffset: get(24), humanInputOffset: get(32),
    lastHumanNs: get(40), nowNs: get(48), mirroredOffset: get(56), pid: Number(get(64)), childPid: Number(get(72)),
    initial: geometry(80), size: geometry(88), ended: Boolean(p[96]), gap: Boolean(p[97]), humanPending: Boolean(p[98]),
    waitStatus: p.readUInt32BE(100), transaction: p.toString('hex', 104, 120), build: p.toString('hex', 120, 152),
    ...(pipes && { pipes, stderrOffset: get(152) }) };
}

const inputClass = data => {
  const flags = data[8] & 0xc0;
  return flags === 0xc0 ? 'terminal-report' : flags === 0x80 ? 'editing' : 'unknown';
};

export function decodeEvents(bytes) {
  const result = [];
  for (let i = 0; i < bytes.length;) {
    if (bytes.length - i < 21) throw holderError('HOLDER_FRAME');
    const n = bytes.readUInt32BE(i) + 4;
    const type = bytes[i + 4];
    if (n < 21 || n > 8213 || i + n > bytes.length ||
        type === events.resize && n !== 29 || type === events.human && n !== 37 ||
        type === events.write && n !== 41 || type === events.exit && n !== 29 ||
        (type === events.output || type === events.stderr) && n === 21 || !Object.values(events).includes(type)) throw holderError('HOLDER_FRAME');
    const data = bytes.subarray(i + 21, i + n);
    result.push({ type, seq: bytes.readBigUInt64BE(i + 5), offset: bytes.readBigUInt64BE(i + 13),
      data, ...(type === events.human && { inputClass: inputClass(data) }) });
    i += n;
  }
  return result;
}

export function holderClient(binding, controller) {
  const id = idBytes(binding.incarnation);
  function request(method, payload = Buffer.alloc(0), timeout = 4500) {
    const message = frame(Buffer.concat([Buffer.of(protocol, methods[method]), id, payload]));
    return new Promise((resolve, reject) => {
      const socket = createConnection(binding.socket);
      const decode = frameDecoder();
      const fail = error => { socket.destroy(); reject(error); };
      socket.setTimeout(timeout, () => fail(holderError('HOLDER_TIMEOUT')));
      socket.once('error', fail);
      socket.once('close', () => fail(holderError('HOLDER_EOF')));
      socket.once('connect', () => socket.write(message));
      socket.on('data', chunk => {
        try {
          const p = decode(chunk);
          if (!p) return;
          if (!statuses[p[0]]) throw holderError('HOLDER_FRAME');
          resolve({ status: statuses[p[0]], body: p.subarray(1) });
          socket.destroy();
        } catch (error) { fail(error); }
      });
    });
  }
  const token = () => {
    if (!controller) throw holderError('HOLDER_CONTROLLER');
    return Buffer.concat([u64(controller.generation), idBytes(controller.id)]);
  };
  const mutate = (method, bytes) => request(method, Buffer.concat([token(), bytes ?? Buffer.alloc(0)]));
  const checked = ({ status, body }) => {
    if (status !== 'applied') throw holderError(status === 'gap' ? 'HOLDER_GAP' : `HOLDER_${status.toUpperCase()}`);
    return body;
  };
  return {
    async hello() { return decodeSnapshot(checked(await request('hello'))); },
    async claim() { return decodeSnapshot(checked(await mutate('claim'))); },
    async snapshot() { return decodeSnapshot(checked(await request('snapshot'))); },
    async read(after) { return decodeEvents(checked(await request('read', Buffer.concat([u64(after), u32(frameLimit - 1)])))); },
    async write(condition, bytes, id) {
      const body = Buffer.concat([u64(condition.epoch, condition.eventSeq, condition.outputOffset, condition.humanInputOffset,
        condition.minHumanQuietNs), idBytes(id), Buffer.from(bytes)]);
      const result = await mutate('write', body);
      if (result.body.length && result.body.length !== 12) throw holderError('HOLDER_FRAME');
      return { status: result.status, ...(result.body.length && {
        offset: result.body.readBigUInt64BE(), written: result.body.readUInt32BE(8),
      }) };
    },
    async resize(cols, rows) { return decodeSnapshot(checked(await mutate('resize', u32(cols, rows)))); },
    async signal(name) {
      const number = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGKILL'].indexOf(name);
      if (number < 0) throw holderError('HOLDER_SIGNAL');
      checked(await mutate('signal', Buffer.of(number)));
    },
    async handoff(generation, transaction, asset) {
      if (!/^[a-f\d]{64}$/.test(asset.digest)) throw holderError('HOLDER_DIGEST');
      checked(await mutate('handoff', Buffer.concat([u64(generation), idBytes(transaction),
        Buffer.from(asset.digest, 'hex'), Buffer.from(asset.path)])));
    },
  };
}
