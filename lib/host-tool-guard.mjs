import { basename, isAbsolute } from 'node:path';
import { nativeClaudeVersionsPattern } from '../daemon/claude-ccp.mjs';
import { resolveClaudeExecutable, resolveNativeExecutable } from '../daemon/executables.mjs';
import { recordWorkerExecutable } from '../daemon/worker-executables.mjs';
import { shellExecutables } from './shell-executables.mjs';

const protectedInput = /(?:^|[^\w.-])(?:ccp|solars|rah_os|\.?loom-next|claude-protected|\.env(?:\.[\w-]+)?|auth\.json|\.?credentials\.json|oauth_creds\.json|antigravity-oauth-token|Keychains|\.ssh)(?=$|[^\w.-])/i;
const providerCommand = /^(?:codex|claude|agy|opencode)$/i;
const networkCommand = /(?:^|[\s;&|()])(?:["'])?(?:[^\s;&|()"']*\/)?(?:curl|wget|ssh|scp|sftp|nc|ncat|telnet|osascript|hc)(?:["'])?(?=\s|[;&|()]|$)/i;

export function hostToolDenial(name, input, env = process.env) {
  if (env.LOOM_HOST_GUARD !== '1') return;
  if (Date.now() >= Number(env.LOOM_HOST_EXPIRES)) return 'The host grant expired';
  const data = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  if (protectedInput.test(data)) return 'The host grant excludes credentials, protected trees and unrelated runtimes';
  if (/^(?:WebFetch|WebSearch|web_fetch|web_search|subagent|spawn_agent|mcp__)/i.test(name ?? '')) {
    return 'This host grant does not authorize external tools or delegation';
  }
  const command = typeof input === 'string' ? input : input?.command ?? input?.cmd ?? input?.CommandLine;
  if (typeof command === 'string' && networkCommand.test(command)) return 'Use the allowed provider transport for host egress';
  const binaries = [];
  for (const candidate of shellExecutables(command)) {
    if (nativeClaudeVersionsPattern.test(candidate)) return 'Claude must be launched through the CCP entry';
    const cli = basename(candidate);
    if (!providerCommand.test(cli)) continue;
    if (!isAbsolute(candidate)) return 'Use a resolved absolute path for native CLIs';
    const normalizedCli = cli.toLowerCase();
    try {
      const path = normalizedCli === 'claude' ? resolveClaudeExecutable(candidate, { env }) : resolveNativeExecutable(candidate);
      if (path !== candidate) return normalizedCli === 'claude' ? 'Use the configured CCP Claude entry path' : 'Use the canonical native CLI path';
      binaries.push({ cli: normalizedCli, path });
    } catch { return normalizedCli === 'claude' ? 'Claude must be launched through the CCP entry' : 'This native CLI path is unavailable or protected'; }
  }
  for (const { cli, path } of binaries) {
    recordWorkerExecutable(env.LOOM_HOST_PROJECT, { addr: env.LOOM_HOST_ADDR, cli }, path, 'tool');
  }
}
