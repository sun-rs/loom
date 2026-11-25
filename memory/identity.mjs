import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const fullSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function normalizeRemote(remote) {
  if (!remote) return null;
  const scp = /^(?:[^@/\s]+@)?(\[[^\]]+\]|[^:/\s]+):(.+)$/.exec(remote);
  const candidate = scp && !remote.includes('://')
    ? 'ssh://' + scp[1] + '/' + scp[2].replace(/^\/+/, '')
    : remote;
  try {
    const url = new URL(candidate);
    if (!url.hostname && url.protocol !== 'file:') return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
    // Preserve explicit ports, including the default port dropped by URL.port.
    const authority = /^[^:]+:\/\/([^/?#]*)/.exec(candidate)?.[1] ?? '';
    const port = /:(\d+)$/.exec(authority.split('@').at(-1))?.[1];
    return url.protocol + '//' + url.hostname.toLowerCase() + (port ? ':' + Number(port) : '') + path;
  } catch {
    return null;
  }
}

function projectId(key) {
  return createHash('sha256').update(key).digest('hex');
}

export async function identifyProject(path, { now, realpath, inspectGit, directoryId }) {
  const canonical = resolve(await realpath(path));
  const git = await inspectGit(canonical);
  const directory = await directoryId?.(canonical);
  const rootSha = git?.roots?.filter(sha => fullSha.test(sha))
    .map(sha => sha.toLowerCase()).sort()[0] ?? null;
  const remote = normalizeRemote(git?.remote);
  const subpath = git ? relative(resolve(git.worktreeRoot), canonical) : null;
  if (subpath === '..' || subpath?.startsWith('..' + sep) || (subpath && isAbsolute(subpath))) {
    throw new RangeError('Project path is outside the Git worktree');
  }
  const kind = git ? 'git' : 'path';
  const verified = !git || (!git.shallow && rootSha !== null);
  const key = !git
    ? JSON.stringify([kind, canonical])
    : JSON.stringify([kind, rootSha, remote, subpath, verified ? null : canonical]);
  const identity = { key, kind, path: canonical, rootSha, remote, subpath,
    singleCell: !git, directoryId: directory, verified };
  return {
    ...identity,
    receipt: { key, kind, path: canonical, rootSha, remote, subpath, verified,
      at: new Date(now()).toISOString() },
  };
}

const emptyRecords = () => ({ memory: [], history: [] });

function keyParts(key) {
  try {
    const parts = JSON.parse(key);
    return Array.isArray(parts) ? parts : [];
  } catch {
    return [];
  }
}

export function createIdentityStore({ bindings = [], records = new Map(), now, pathExists }) {
  const table = new Map(bindings.map(binding => [binding.path, structuredClone(binding)]));
  let pending = Promise.resolve();

  function install(identity, project) {
    const binding = { path: identity.path, key: identity.key, project,
      directoryId: identity.directoryId, updatedAt: new Date(now()).toISOString() };
    table.set(binding.path, binding);
    return { status: 'bound', binding: structuredClone(binding) };
  }

  async function reconcile(identity, { decision, binding } = {}) {
    const prior = table.get(identity.path);
    const all = [...table.values()];
    const sameKey = all.filter(row => row.key === identity.key);
    const requested = decision && all.filter(row => row.project === decision.project);
    if (binding?.role === 'super' && requested?.length) {
      if (decision.action === 'bind') return install(identity, decision.project);
      if (decision.action === 'split') {
        return install(identity, projectId(JSON.stringify([identity.key, decision.project])));
      }
      if (decision.action === 'move') {
        const sources = await Promise.all(requested.filter(row => row.path !== identity.path)
          .map(async row => ({ row, exists: await pathExists(row.path) })));
        const missing = sources.filter(({ exists }) => !exists);
        if (missing.length === 1 && (!prior || prior.project === decision.project)) {
          const result = install(identity, decision.project);
          table.delete(missing[0].row.path);
          return result;
        }
      }
    }

    if (prior?.key === identity.key) {
      return { status: 'bound', binding: structuredClone(prior) };
    }

    const sameDirectory = row => identity.directoryId != null && row.directoryId === identity.directoryId;
    const possible = all.filter(row => {
      if (row.path === identity.path || row.key === identity.key || sameDirectory(row)) return true;
      const [kind, rootSha, remote, subpath] = keyParts(row.key);
      return identity.kind === 'git' && kind === 'git' && subpath === identity.subpath &&
        ((rootSha !== null && rootSha === identity.rootSha) || (remote && remote === identity.remote));
    });
    if (prior && keyParts(prior.key)[0] === 'path' && identity.kind === 'git' && identity.verified &&
      all.filter(row => row.key === prior.key).length === 1 &&
      possible.every(row => row.project === prior.project)) {
      return install(identity, prior.project);
    }

    if (!prior) {
      const availability = await Promise.all(possible.map(async row => ({
        row, exists: await pathExists(row.path),
      })));
      const orphan = availability.some(({ row, exists }) => !exists &&
        (row.key === identity.key || sameDirectory(row)));
      if (orphan) return { status: 'orphan', candidates: structuredClone(possible) };
      if (identity.verified && sameKey.length > 0 &&
        sameKey.every(row => row.project === sameKey[0].project)) {
        return install(identity, sameKey[0].project);
      }
      if (identity.verified && possible.length === 0) return install(identity, projectId(identity.key));
    }
    return { status: 'pending', candidates: structuredClone(possible) };
  }

  return {
    reconcile(identity, options) {
      const result = pending.then(() => reconcile(identity, options));
      pending = result.catch(() => {});
      return result;
    },
    bindingAt(path) {
      return structuredClone(table.get(path));
    },
    bindSession({ path, sessionId, principal, role, cardId = null, dependencies = [],
      attachments = [], authorizedIds = { memory: [], history: [] }, ancestors }) {
      return structuredClone({ sessionId, principal: principal ?? role, role,
        project: table.get(path)?.project ?? null, cardId, dependencies, attachments,
        authorizedIds, ...(ancestors === undefined ? {} : { ancestors }) });
    },
    recordProjectData(project, data) {
      records.set(project, structuredClone(data));
    },
    readProject(project, binding) {
      if (binding?.role === 'super' ||
        (project != null && binding?.role === 'auditor' && binding.project === project)) {
        return structuredClone(records.get(project) ?? emptyRecords());
      }
      return emptyRecords();
    },
  };
}
