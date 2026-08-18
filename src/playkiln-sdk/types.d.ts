/** Protocol major version for Playkiln game host contract v1. */
export declare const PROTOCOL_VERSION: 1;
export declare const CHANNEL: "playkiln";
export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type HostEnv = 'local' | 'preview' | 'production';
export type SessionOutcome = 'completed' | 'failed' | 'quit';
export type ErrorPayload = {
    code: string;
    message: string;
    retryable?: boolean;
};
export type GameCapabilities = {
    /** The game routes all audio through a master gain and honors host mute. */
    audio?: boolean;
    /** The game reads and writes its save document. */
    storage?: boolean;
};
export type AudioState = {
    muted: boolean;
};
/**
 * Present on hosts that support saves. Absent ⇒ storage is unavailable, and
 * both storage calls reject with `storage_unavailable` instead of hanging.
 */
export type StorageInfo = {
    /** Largest document the host accepts, measured in UTF-8 bytes. */
    maxBytes: number;
};
/** Codes carried by `storage.*.error`, and by the errors the SDK throws itself. */
export type StorageErrorCode = 
/** This host has no save storage. The game must still work. */
'storage_unavailable'
/** The document exceeded `StorageInfo.maxBytes`. */
 | 'storage_too_large'
/** The host tried and failed — quota, backend, anything else. */
 | 'storage_failed';
export type HostInfo = {
    env: HostEnv;
    hostOrigin: string;
    gameId: string;
    packageVersion: string;
    sdkProtocolVersion: number;
    locale: string;
    /** Present on hosts that support the sound preference. Absent ⇒ unmuted. */
    audio?: AudioState;
    /** Present on hosts that support saves. Absent ⇒ storage unavailable. */
    storage?: StorageInfo;
};
export type SessionStartContext = {
    sessionId: string;
    attempt: number;
};
export type SessionEndPayload = {
    sessionId: string;
    outcome: SessionOutcome;
    score?: number;
    durationMs?: number;
};
export type Envelope = {
    channel: typeof CHANNEL;
    v: number;
    type: string;
    requestId?: string;
    payload?: unknown;
};
export type PlaykilnSDK = {
    readonly protocolVersion: ProtocolVersion;
    init(): Promise<HostInfo>;
    loading(progress?: number): void;
    ready(): void;
    onSessionStart(handler: (ctx: SessionStartContext) => void): () => void;
    sessionEnd(result: SessionEndPayload): void;
    requestNewSession(): void;
    onTerminate(handler: () => void): () => void;
    reportError(error: {
        message: string;
        fatal?: boolean;
        details?: string;
    }): void;
    /** Current host audio state. `{ muted: false }` until the host says otherwise. */
    getAudio(): AudioState;
    /**
     * Fires when the host changes audio state (`audio.set`, and on the init.ok
     * snapshot if it differs from the default). Does not replay on registration
     * — read `getAudio()` or the `init()` result for the initial value.
     */
    onAudioChange(handler: (audio: AudioState) => void): () => void;
    /**
     * The game's save document — one opaque string per player per game.
     *
     * The platform never parses it: a game that wants JSON stringifies it, a
     * game that wants binary base64s it. Which tier backs it (device-local or
     * account) is the host's business and is never visible here.
     *
     * Both calls reject with `storage_unavailable` when the host did not
     * advertise `HostInfo.storage`, so **a game must play correctly with no
     * storage at all** — see `docs/game-contract.md` §4.
     */
    storage: {
        /** The save document, or null if the player has never written one. */
        get(): Promise<string | null>;
        /** Replace the save document. Rejects if it exceeds `StorageInfo.maxBytes`. */
        set(value: string): Promise<void>;
    };
};
export type CreateSdkOptions = {
    /** Override parent window (tests). Default: window.parent */
    targetWindow?: Window | null;
    /** Default request timeout ms. Default 15000 */
    requestTimeoutMs?: number;
    /**
     * If true, skip origin checks (only for isolated unit tests).
     * Production games must leave this false.
     */
    dangerouslyAllowAnyOrigin?: boolean;
    /** Declared to the host in the init payload. Omit ⇒ `{}` (no capabilities). */
    capabilities?: GameCapabilities;
};
//# sourceMappingURL=types.d.ts.map