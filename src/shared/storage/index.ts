/**
 * Storage Subsystem Unified Facade
 * Location: src/shared/storage/index.ts
 *
 * Aggregates and re-exports all submodules of the modular storage architecture:
 * - defaults: Storage keys, factory configurations, default sample scripts, clone/freeze utilities
 * - mutex: AsyncMutex primitive and storageMutex singleton
 * - script-record: Pure in-memory ScriptRecord normalization, validation, and type guards
 * - scripts-repo: Script CRUD, queries, filters, change listeners, seeding
 * - settings-repo: Global settings management with atomic partial merging
 * - tab-repo: Tab debugger session persistence (independent mutex)
 * - bundle: Script import/export serialization and batch parsing
 * - gm-repo: Persistent userscript Greasemonkey key-value storage engine
 */

export * from './defaults';
export * from './mutex';
export * from './script-record';
export * from './scripts-repo';
export * from './settings-repo';
export * from './tab-repo';
export * from './bundle';
export * from './gm-repo';
