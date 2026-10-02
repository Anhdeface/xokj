/**
 * XOKJ - Script Injection Orchestrator Facade
 *
 * Backward-compatible root re-export of modular injector submodules:
 * - pageSandboxRunner (page-runner.ts)
 * - InjectionGuard (injection-guard.ts)
 * - PrehydratedStorageLoader (storage-loader.ts)
 * - StageScheduler (stage-scheduler.ts)
 * - ScriptInjector (index.ts)
 */

export {
  pageSandboxRunner,
  InjectionGuard,
  PrehydratedStorageLoader,
  StageScheduler,
  ScriptInjector
} from './injector/index';

export type { ScriptInjectorOptions } from './injector/index';
