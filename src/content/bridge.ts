/**
 * XOKJ - Content Script Message Bridge Facade
 *
 * Re-exports modularized ContentScriptBridge submodules from ./bridge/
 * for 100% backward compatibility.
 */

export * from './bridge/index';
export { ContentScriptBridge as default } from './bridge/index';
