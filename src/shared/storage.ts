/**
 * Storage Subsystem Facade
 * Location: src/shared/storage.ts
 *
 * Re-exports the complete public API from the modular storage subsystem (src/shared/storage/)
 * to maintain 100% backward compatibility for all existing imports across background, popup,
 * dashboard, content scripts, and test suites.
 */

export * from './storage/index';
export type * from './storage/index';
