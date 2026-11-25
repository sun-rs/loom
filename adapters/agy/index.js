export { agy, default } from './index.mjs';

// Node resolves an explicitly named test directory through its index.js.
if (import.meta.main && process.env.NODE_TEST_CONTEXT) await import('./adapter.test.mjs');
