export { CHANNEL, PROTOCOL_VERSION, isEnvelope, makeEnvelope } from './protocol';
export { GAME_TO_HOST_TYPES, HOST_TO_GAME_TYPES } from './protocol';
export { createPlaykilnSDK } from './create-sdk';
export type * from './types';
import type { PlaykilnSDK } from './types';
declare global {
    interface Window {
        Playkiln?: PlaykilnSDK;
    }
}
/**
 * Install `window.Playkiln` when running in a browser.
 * Safe to call multiple times; reuses existing instance.
 */
export declare function installGlobalPlaykiln(): PlaykilnSDK;
//# sourceMappingURL=index.d.ts.map