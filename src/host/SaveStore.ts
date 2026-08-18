/**
 * SaveStore — Rival's side of the Playkiln storage capability.
 *
 * The platform gives a game exactly one opaque document per player. It never
 * parses it, and it never says which tier backs it (device-local for guests,
 * account for signed-in players). So everything about the *format* lives here
 * and in `src/game/progress.ts`; everything about the *tier* lives nowhere,
 * because the game must not care.
 *
 * Three obligations, all from the game contract:
 *
 *   1. **Storage may be absent.** A host that does not advertise
 *      `HostInfo.storage` gets a store that is permanently off. Rival then runs
 *      medals-only — no personal best carried between visits, no error, no
 *      banner. The packaged medal ghosts mean there is still always a rival.
 *   2. **A corrupt document must not break the game.** Parsing is total:
 *      anything unreadable is treated as "no save", and the next personal best
 *      overwrites it.
 *   3. **Write failures are non-fatal.** They are reported with
 *      `fatal: false` and the player keeps racing.
 *
 * Deliberately free of Phaser imports, like `GameHost`.
 */
import { parseProgress, serialiseProgress, type Progress } from '../game/progress'

/** The subset of the SDK this store uses. Absent `storage` ⇒ saves are off. */
export type SaveCapableHost = {
  storage: {
    get(): Promise<string | null>
    set(value: string): Promise<void>
  }
  reportError?(error: { message: string; fatal?: boolean; details?: string }): void
}

/** What `init()` told us about the host's save support. */
export type SaveLimits = { maxBytes: number } | undefined

export class SaveStore {
  private readonly host: SaveCapableHost
  private readonly maxBytes: number | null
  /** Serialises writes so two quick personal bests cannot land out of order. */
  private queue: Promise<void> = Promise.resolve()
  /** Reported once per session at most — a broken save must not spam the host. */
  private warned = false

  /**
   * @param limits `HostInfo.storage` verbatim. Undefined means this host has no
   *   saves, and every call on this store becomes a no-op.
   */
  constructor(host: SaveCapableHost, limits: SaveLimits) {
    this.host = host
    this.maxBytes = limits ? limits.maxBytes : null
  }

  /** True when the host advertised storage. Never shown to the player. */
  get enabled(): boolean {
    return this.maxBytes !== null
  }

  /**
   * Read the saved progress, or null when there is nothing usable to read.
   *
   * Null covers all three of: no storage on this host, a first-time player, and
   * a document that will not parse. The caller treats them identically, which
   * is what keeps the medals-only path from being a special case.
   *
   * Call before `ready()` so the first session already races the right ghost.
   */
  async load(): Promise<Progress | null> {
    if (!this.enabled) return null
    try {
      const raw = await this.host.storage.get()
      if (raw === null) return null
      const progress = parseProgress(raw)
      if (!progress) {
        // Not worth troubling the host with: the recovery is automatic and the
        // player loses nothing they can see beyond an old best.
        console.warn('[rival] save document unreadable — starting fresh')
      }
      return progress
    } catch (err) {
      this.report('could not read the save document', err)
      return null
    }
  }

  /**
   * Persist progress. Fire-and-forget by design: the caller is painting an end
   * screen and must not await the network.
   *
   * Call only on a new personal best or a newly earned medal. Writing on every
   * lap is how a game makes a cheap capability look expensive.
   */
  save(progress: Progress): void {
    if (!this.enabled) return
    const body = JSON.stringify(serialiseProgress(progress))
    const bytes = new TextEncoder().encode(body).length
    if (this.maxBytes !== null && bytes > this.maxBytes) {
      // The host would reject this anyway; failing here says why.
      this.report(`save document too large (${bytes} bytes, limit ${this.maxBytes})`)
      return
    }
    this.queue = this.queue
      .then(() => this.host.storage.set(body))
      .catch((err: unknown) => {
        this.report('could not write the save document', err)
      })
  }

  /** Resolve once every queued write has settled. For tests and preview checks. */
  async flush(): Promise<void> {
    await this.queue
  }

  private report(message: string, err?: unknown): void {
    console.warn(`[rival] ${message}`, err ?? '')
    if (this.warned) return
    this.warned = true
    this.host.reportError?.({
      message: `rival: ${message}`,
      fatal: false,
      details: err instanceof Error ? err.stack : err === undefined ? undefined : String(err),
    })
  }
}
