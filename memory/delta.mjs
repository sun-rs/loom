const notice = '背景笔记，仅供参考，使用前核验';

export function renderMemoryDelta(batch) {
  if (!batch.rows.length) return '';
  const withdrawals = batch.rows.filter(row => row.operation === 'withdraw');
  const example = withdrawals.find(row => row.withdrawalTitle) ?? withdrawals[0];
  const lines = [];
  for (const row of batch.rows) {
    if (row.operation !== 'withdraw') lines.push(`[${row.operation}] ${row.line}`);
    else if (row === withdrawals[0]) {
      const summary = withdrawals.length > 1 ? `${withdrawals.length} memories withdrawn. Example: ` : '';
      lines.push(`[withdraw] ${summary}${example.line}`);
    }
  }
  if (batch.truncated) lines.push('增量已截断，剩余变更将在后续投递。');
  return '\n\n' + [notice, ...lines].join('\n');
}

export function createDeltaDelivery({
  access, binding, prefix, initialCursor = 0, send, reconcile, reschedule,
}) {
  const batches = new Map();
  let cursor = initialCursor ?? 0;
  let queue = Promise.resolve();
  const currentBinding = () => typeof binding === 'function' ? binding() : binding;

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function confirm(batch) {
    cursor = Math.max(cursor, batch.range.endCursor);
    batch.status = 'taken';
    delete batch.delivery;
  }

  async function sendBatch(batch) {
    await send(structuredClone(batch.delivery));
    return structuredClone(batch.delivery);
  }

  async function createBatch(deliveryId, body, originalDeliveryId) {
    const range = await access.delta(currentBinding(), { cursor });
    const suffix = { ...range, text: renderMemoryDelta(range) };
    const delivery = { deliveryId, prefix, body, suffix, text: prefix + body + suffix.text };
    if (originalDeliveryId !== undefined) delivery.originalDeliveryId = originalDeliveryId;
    const batch = { delivery, range, status: 'pending' };
    batches.set(deliveryId, batch);
    return batch;
  }

  return {
    deliver({ deliveryId, body }) {
      return serialize(async () => {
        let batch = batches.get(deliveryId);
        if (!batch) return sendBatch(await createBatch(deliveryId, body));

        // A lost response to the original request also retries its replacement.
        while (batch.replacementId !== undefined) {
          deliveryId = batch.replacementId;
          batch = batches.get(deliveryId);
        }
        if (batch.status === 'taken') return { deliveryId, status: 'taken' };
        if (batch.status === 'pending') {
          if (await access.canRetryDelta(currentBinding(), batch.range)) return sendBatch(batch);
          batch.status = 'reconciling';
        }
        if (batch.status === 'reconciling') {
          const status = await reconcile?.(deliveryId);
          if (status === 'taken') {
            confirm(batch);
            return { deliveryId, status };
          }
          if (status !== 'not-taken') return { deliveryId, status: 'reconciling' };
          batch.status = status;
        }

        const originalBody = batch.delivery.body;
        const replacementId = await reschedule?.({ originalDeliveryId: deliveryId, body: originalBody });
        if (!replacementId || batches.has(replacementId)) return { deliveryId, status: 'not-taken' };
        const replacement = await createBatch(replacementId, originalBody, deliveryId);
        batch.replacementId = replacementId;
        delete batch.delivery;
        return sendBatch(replacement);
      });
    },

    confirmNativeTakeover(deliveryId) {
      return serialize(() => {
        const batch = batches.get(deliveryId);
        if (batch?.delivery && batch.status !== 'not-taken') confirm(batch);
        return cursor;
      });
    },

    cursor: () => cursor,
  };
}
