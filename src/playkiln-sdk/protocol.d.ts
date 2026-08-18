import { CHANNEL, PROTOCOL_VERSION, type Envelope } from './types';
export { CHANNEL, PROTOCOL_VERSION };
export declare function isEnvelope(value: unknown): value is Envelope;
export declare function makeEnvelope(type: string, payload?: unknown, requestId?: string): Envelope;
/** Host-side: messages the game may send (for logging / routing). */
export declare const GAME_TO_HOST_TYPES: readonly ["init", "loading", "ready", "session.end", "session.request", "storage.get", "storage.set", "error"];
/** Game-side: messages the host may send. */
export declare const HOST_TO_GAME_TYPES: readonly ["init.ok", "init.error", "session.start", "session.terminate", "session.end.ok", "session.end.error", "storage.get.ok", "storage.get.error", "storage.set.ok", "storage.set.error", "audio.set"];
export type GameToHostType = (typeof GAME_TO_HOST_TYPES)[number];
//# sourceMappingURL=protocol.d.ts.map