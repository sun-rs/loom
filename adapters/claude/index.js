export { claude, default } from './index.mjs';

// Keep `node --test adapters/claude` usable with Node's directory entry resolution.
if (import.meta.main && process.env.NODE_TEST_CONTEXT) await import('./test.mjs');
