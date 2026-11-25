export { default, codex } from './index.mjs';

// Node treats an explicit directory in --test as its package entry point.
if (import.meta.main) {
  await import('./parse.test.mjs');
  await import('./adapter.test.mjs');
}
