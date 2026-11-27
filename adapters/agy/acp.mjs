import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function preflightAgyAcp(executable, cwd, env, launchArgs) {
  const childEnv = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([, value]) => value !== null));
  let help;
  try {
    const { stdout, stderr } = await run(executable, ['acp', '--help'], { cwd, env: childEnv, timeout: 5000 });
    help = `${stdout}\n${stderr}`;
  } catch (error) {
    throw new Error(`agy ACP preflight failed: agy acp --help (${error.code ?? error.signal ?? 'probe failed'})`);
  }
  const flags = new Set(Array.from(help.matchAll(/^\s+(--[\w-]+)(?=\s|=|$)/gm), match => match[1]));
  // OAR prepends these flags to Loom's launchArgs.
  const required = ['--dangerously-skip-permissions', '--process-per-session', ...(env.GEMINI_HOME ? ['--gemini-dir'] : []),
    ...launchArgs.filter(arg => arg.startsWith('--')).map(arg => arg.split('=', 1)[0])];
  const missing = required.filter(flag => !flags.has(flag));
  if (missing.length) throw new Error(`agy ACP preflight failed: agy acp --help does not list ${missing.join(', ')}`);
}
