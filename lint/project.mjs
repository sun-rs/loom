import { parse } from 'acorn';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { providerShellCommands, shellExecutable } from '../fixtures/command-policy.mjs';
import { isCredentialPath } from '../evidence/git.mjs';

const sourceFile = /(?:\.[cm]?js$|^bin\/loomd?$)/;
const testFile = /(?:\.(?:test|spec)|(?:^|\/)test)\.[cm]?js$|(?:^|\/)(?:test|tests|__tests__|fixtures)\//;
const netModules = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'undici', 'axios', 'node-fetch', 'ws']);
const netCalls = new Set(['fetch', 'connect', 'createConnection', 'request', 'get', 'WebSocket', 'send', 'createSocket', 'Client', 'Pool', 'Agent']);
const readCalls = /^(?:readFile(?:Sync)?|createReadStream|open(?:Sync)?|readText|localText)$/;
const writeCalls = /^(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|writeState|mkdir(?:Sync)?|rm(?:Sync)?|unlink(?:Sync)?|rename(?:Sync)?|cp(?:Sync)?|copyFile(?:Sync)?|symlink(?:Sync)?)$/;
const configPath = /^\/(?:Users|home)\/[^/]+\/(?:\.config|\.codex|\.claude|\.gemini|\.gitconfig|\.npmrc|\.zshrc|\.bashrc|\.profile)(?:$|\/)|^\/(?:etc|usr\/local\/etc|opt\/homebrew\/etc)(?:\/|$)|^(?:~|\$\{?HOME\}?|\$\{?homedir\(\)\}?|\$\{?process\.env\.(?:HOME|XDG_CONFIG_HOME)\}?)(?:\/|$)/i;
const secretPath = /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.kube|keychains?|\.env[^/]*|provider-homes|id_(?:rsa|ed25519)|(?:auth|\.?credentials|oauth_creds|tokens?)\.json)(?:\/|$)|\/(?:gh\/hosts\.yml|\.docker\/config\.json)$/i;
const fixtureProcess = 'fixtures/test-process.mjs';

function visit(node, callback) {
  if (typeof node?.type !== 'string') return;
  callback(node);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(entry => visit(entry, callback));
    else visit(child, callback);
  }
}
const builtin = value => value?.replace(/^node:/, '');
const member = node => node?.computed ? node.property?.value : node?.property?.name;
const label = node => node?.type === 'Identifier' ? node.name : member(node);
const moduleSource = node => node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ||
  node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression' ? node.source?.value :
  node.callee?.name === 'require' || member(node.callee) === 'getBuiltinModule' ? node.arguments[0]?.value : undefined;
const opensForWrite = (operation, flags) => operation.startsWith('open') &&
  (typeof flags === 'string' && /^[wa]|^r\+/.test(flags) || typeof flags === 'number' && (flags & 3) !== 0 ||
    typeof flags === 'string' && /\bO_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/.test(flags));

export function lintSource(source, path, { egress = [] } = {}) {
  const violations = [];
  const add = (node, rule, message) => violations.push({ file: path, line: node.loc?.start.line ?? 1,
    column: (node.loc?.start.column ?? 0) + 1, rule, message });
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: path.endsWith('.cjs') ? 'script' : 'module', locations: true, allowHashBang: true }); }
  catch (error) {
    return [{ file: path, line: error.loc?.line ?? 1, column: (error.loc?.column ?? 0) + 1,
      rule: 'parse', message: 'Fix the syntax so Loom can verify this source file.' }];
  }
  const bindings = new Map(), modules = new Map(), aliases = new Map();
  visit(tree, node => {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) imports(specifier.local.name, builtin(node.source.value),
        specifier.imported?.name ?? '*');
    }
    if (node.type === 'VariableDeclarator' && node.init) {
      const imported = builtin(moduleSource(node.init.type === 'AwaitExpression' ? node.init.argument : node.init));
      if (node.id.type === 'Identifier') {
        if (imported) imports(node.id.name, imported, '*');
        else bindings.set(node.id.name, node.init);
      } else if (imported && node.id.type === 'ObjectPattern') {
        for (const property of node.id.properties) {
          if (property.value?.type === 'Identifier') imports(property.value.name, imported, property.key.name ?? property.key.value);
        }
      }
    }
  });
  function imports(name, module, method) {
    if (method === '*') modules.set(name, module);
    else aliases.set(name, { module, method });
  }
  function reference(node, seen = new Set()) {
    if (node?.type === 'Identifier') {
      if (aliases.has(node.name)) return aliases.get(node.name);
      if (bindings.has(node.name) && !seen.has(node.name)) {
        seen.add(node.name);
        const origin = reference(bindings.get(node.name), seen);
        if (origin) return origin;
      }
    }
    if (node?.type === 'MemberExpression') {
      const name = label(node);
      const object = node.object.name ?? (label(node.object) === 'promises' ? node.object.object?.name : undefined);
      if (modules.has(object)) return { module: modules.get(object), method: name };
      if (['globalThis', 'global', 'window'].includes(object)) return { module: 'global', method: name };
    }
    if (node?.type === 'MemberExpression' && node.object.type === 'NewExpression') {
      const constructor = reference(node.object.callee, seen);
      if (constructor) return { ...constructor, method: label(node) };
    }
    if (node?.type === 'NewExpression') return reference(node.callee, seen);
    if (node?.type === 'CallExpression' && node.callee.name === 'promisify') return reference(node.arguments[0], seen);
  }
  function value(node, seen = new Set()) {
    if (!node) return '';
    if (node.type === 'Literal') return node.value;
    if (node.type === 'Identifier' && bindings.has(node.name) && !seen.has(node.name)) {
      const visited = new Set([...seen, node.name]);
      return value(bindings.get(node.name), visited);
    }
    if (node.type === 'BinaryExpression' && node.operator === '+') return value(node.left, seen) + value(node.right, seen);
    if (node.type === 'TemplateLiteral') return node.quasis.map((part, i) => part.value.cooked +
      String(value(node.expressions[i], seen))).join('');
    if (node.type === 'CallExpression' && ['join', 'resolve', 'URL'].includes(label(node.callee))) {
      return node.arguments.map(arg => String(value(arg, seen))).filter(Boolean).join('/');
    }
    if (node.type === 'NewExpression' && node.callee.name === 'URL') return value(node.arguments[0], seen);
    if (node.type === 'CallExpression' && node.callee.name === 'homedir' ||
        node.type === 'MemberExpression' && /^(?:process\.env\.(?:HOME|XDG_CONFIG_HOME)|process\.env\[['"](?:HOME|XDG_CONFIG_HOME)['"]\])$/.test(source.slice(node.start, node.end))) return '~';
    return '';
  }
  const allowedEgress = egress.includes(path);
  const test = testFile.test(path);
  visit(tree, node => {
    const imported = builtin(moduleSource(node));
    if (test && path !== fixtureProcess && ['child_process', 'node-pty'].includes(imported)) {
      add(node, 'test-executable', 'Import the fixture process runner. Launch a project-owned fixture with an absolute path and pass any OS fixture tools through the pinned runner.');
    }
    if (imported && netModules.has(imported) && !['net', 'http', 'https', 'http2'].includes(imported) && !allowedEgress) {
      add(node, 'network-egress', 'Move outbound networking into an explicitly allowlisted module and use a local mock in tests.');
    }
    if (!['CallExpression', 'NewExpression'].includes(node.type)) return;
    const operation = reference(node.callee);
    const method = operation?.method ?? label(node.callee);
    const localIpc = path === 'lib/unix-socket.mjs' && operation?.module === 'net' && method === 'createConnection';
    const network = operation && netModules.has(operation.module) && netCalls.has(method) ||
      ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'].includes(method) && (!operation || operation.module === 'global');
    if (!allowedEgress && network && !localIpc) {
      add(node, 'network-egress', 'Move the outbound request into an explicitly allowlisted module and assert its destination with a local mock.');
    }
    const processCall = operation?.module === 'child_process' || operation?.module?.endsWith('/fixtures/test-process.mjs');
    if (processCall) {
      const cmd = String(value(node.arguments[0]));
      const argv = node.arguments[1]?.elements?.map(arg => String(value(arg))) ?? [];
      const shell = shellExecutable(cmd);
      const commands = shell ? argv.slice(1, 2) : [cmd];
      if (test && shell && providerShellCommands(commands[0]).some(name => !isAbsolute(name))) {
        add(node, 'test-executable', 'Pass a fixture executable by absolute path. Remove provider CLI lookups or launches through the shell PATH.');
      }
      if (!allowedEgress && (commands.some(command =>
        /(?:^|[\s;|&])(?:[^\s;|&]*\/)?(?:curl|wget|nc|netcat|ssh|scp|rsync)(?:$|[\s;|&])/i.test(command) ||
        /\bgit\s+(?:fetch|pull|push|ls-remote)\b/i.test(command)) ||
        /(?:^|\/)git$/.test(cmd) && argv.some(arg => ['fetch', 'pull', 'push', 'ls-remote'].includes(arg)))) {
        add(node, 'network-egress', 'Replace the network command with the allowlisted client and mock the outbound request in tests.');
      }
      const readsFromProcess = /(?:^|\/)(?:cat|head|tail|less|more|grep|sed|source)$/.test(cmd) && argv.some(arg =>
        isCredentialPath(arg) || secretPath.test(arg));
      if (readsFromProcess) {
        add(node, 'credential-read', 'Use a synthetic fixture or an authorized provider handle instead of reading credential files.');
      }
      if (commands.some(command => /\bgit\s+config\s+--(?:global|system)\b/i.test(command) && !/--(?:get|list|show-origin)/.test(command)) ||
          /(?:^|\/)git$/.test(cmd) && argv.includes('config') && argv.some(arg => ['--global', '--system'].includes(arg)) &&
          !argv.some(arg => /^--(?:get|list|show-origin)/.test(arg))) {
        add(node, 'global-config-write', 'Use repository-local Git settings or isolated command-scoped configuration.');
      }
    }
    if (!readCalls.test(method) && !writeCalls.test(method)) return;
    const flags = value(node.arguments[1]) || (node.arguments[1] ? source.slice(node.arguments[1].start, node.arguments[1].end) : '');
    const writing = writeCalls.test(method) || opensForWrite(method, flags);
    const targets = /^(?:rename|cp|copyFile|symlink)/.test(method) ? node.arguments.slice(0, 2) : node.arguments.slice(0, 1);
    for (const [i, target] of targets.entries()) {
      const file = String(value(target)).replaceAll('\\', '/').replaceAll('//', '/');
      const writesTarget = writing && (targets.length === 1 || i === 1 || method.startsWith('rename'));
      if (!writesTarget && (isCredentialPath(file) || secretPath.test(file))) {
        add(target, 'credential-read', 'Pass an authorized provider handle or a synthetic fixture. Remove the direct read of the credential path.');
      }
      if (writesTarget && configPath.test(file)) {
        add(target, 'global-config-write', 'Write the setting inside the project or an isolated test home. Remove the write to global configuration.');
      }
    }
  });
  return violations.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}

export const lintDiagnostic = ({ file, line, column, rule, message }) => `${file}:${line}:${column} [${rule}] ${message}`;

export function lintProject(project) {
  const root = realpathSync(project);
  const configPath = join(root, 'loom.lint.json');
  const config = lstatSync(configPath, { throwIfNoEntry: false })?.isFile() && realpathSync(configPath) === configPath ?
    JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const { egress = [] } = config;
  if (!Array.isArray(egress) || egress.some(file => typeof file !== 'string' || isAbsolute(file) ||
      !sourceFile.test(file) || file.split('/').some(part => part === '..' || part === '.' || !part))) {
    throw new Error('Set loom.lint.json egress to exact project-relative module paths.');
  }
  const listing = execFileSync('/usr/bin/git', ['--no-optional-locks', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const paths = [...new Set(listing.split('\0'))].filter(path => sourceFile.test(path) && !path.startsWith('.project/') &&
    !isCredentialPath(path) && !secretPath.test(path)).sort();
  const diagnostics = [];
  let files = 0;
  for (const path of paths) {
    const absolute = join(root, path);
    if (!lstatSync(absolute, { throwIfNoEntry: false })?.isFile() || realpathSync(absolute) !== absolute) continue;
    files++;
    diagnostics.push(...lintSource(readFileSync(absolute, 'utf8'), path, { egress }));
  }
  return { ok: !diagnostics.length, files, violations: diagnostics };
}
