const doNow = /^#{1,6}\s+(?:Do now|立即继续|接任后立即做|接任后的首个动作)\s*$/i;
const section = /^#{1,6}\s+/;
const bullet = /^\s*(?:[-*+] |\d+[.)] )(\S.*)$/;

export function extractOutstanding(text = '') {
  const background = [];
  const items = [];
  let reading = false;
  for (const line of text.split(/\r?\n/)) {
    if (section.test(line)) {
      reading = doNow.test(line);
      if (reading) continue;
    }
    if (reading) {
      const item = bullet.exec(line)?.[1].trim();
      if (item) items.push(item);
      else if (line.trim()) background.push(line);
    } else background.push(line);
  }
  return { items, background: background.join('\n').trim() };
}

const normalize = word => word.toLowerCase().replace(/^\.\//, '').replace(/\.+$/, '');
const words = text => new Set((text.match(/[./]*[\p{L}\p{N}][\p{L}\p{N}_./-]*/gu) ?? []).map(normalize));
const ordinary = new Set(['loom', 'notifications', 'complete', 'start', 'send', 'file', 'read', 'reply', 'after', 'final']);

export function startedOutstanding(item, evidence) {
  const anchors = [...item.matchAll(/`([./]*[\p{L}\p{N}][\p{L}\p{N}_./-]*)`/gu)].map(match => normalize(match[1]));
  const meaningful = [...words(item)].filter(word => word.length >= 4 && !ordinary.has(word));
  return evidence.some(action => {
    const observed = words(action);
    if (anchors.length) return anchors.some(anchor => observed.has(anchor) ||
      anchor.includes('/') && !anchor.startsWith('/') && [...observed].some(word => word.endsWith('/' + anchor)));
    return meaningful.filter(word => observed.has(word)).length >= Math.min(2, Math.max(1, meaningful.length));
  });
}
