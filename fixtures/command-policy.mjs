const vendor = '(?:codex|claude|agy|antigravity|opencode|hc|herdr|loom|loomd)';
const commandStart = '(?:^|[;&|\\n(])\\s*(?:(?:exec|env|command)\\s+)*';
const launch = new RegExp(commandStart + '["\']?((?:[^\\s"\';|&()]+/)?' + vendor + ')["\']?(?=\\s|[;&|)]|$)', 'gm');
const resolveOnPath = new RegExp('\\b(?:which|command\\s+-v|type\\s+-[pP])\\s+' + vendor + '(?=\\s|[;&|)]|$)');

export const shellExecutable = file => /(?:^|\/)(?:sh|bash|zsh|dash|ksh)$/.test(file);

export function providerShellCommands(script) {
  if (typeof script !== 'string') return [];
  const commands = [...script.matchAll(launch)].map(match => match[1]);
  if (resolveOnPath.test(script)) commands.push('PATH lookup');
  return commands;
}
