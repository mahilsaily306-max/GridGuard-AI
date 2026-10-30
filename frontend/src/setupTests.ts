// Test setup: jsdom environment is configured in vitest.config.ts.
// getBy* queries from @testing-library/react throw on missing elements,
// so no extra DOM matchers are needed.

// idb invokes indexedDB at module scope in src/offline.ts, which jsdom
// does not provide. Mock idb so pages that transitively load offline.ts
// (e.g. Helpline) import cleanly under jsdom.
import { vi } from 'vitest'

vi.mock('idb', () => ({
  openDB: vi.fn(() =>
    Promise.resolve({
      createObjectStore: vi.fn(() => ({})),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve(undefined)),
          put: vi.fn(() => Promise.resolve()),
          add: vi.fn(() => Promise.resolve()),
          delete: vi.fn(() => Promise.resolve()),
          clear: vi.fn(() => Promise.resolve()),
        })),
      })),
    }),
  ),
}))
