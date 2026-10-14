/** How long a GitHub push time can be reused before the shelf asks again. */
export const UPDATE_TTL_MS = 10 * 60 * 1000

const OPENED_KEY = 'games.opened'
const UPDATES_KEY = 'games.updates'

export type KeyValueStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** A click. `seen` is the push time known at that moment; `at` is the clock time. */
export type OpenRecord = {
  seen: string | null
  at: string
}

export type OpenedMap = Record<string, OpenRecord>

export type UpdateEntry = {
  pushedAt: string | null
  etag: string | null
  fetchedAt: number
}

export type UpdateCache = {
  v: 1
  entries: Record<string, UpdateEntry>
}

export type RepoUpdateResult = {
  status: number
  etag: string | null
  pushedAt: string | null
}

/**
 * True when this game was pushed after the player last opened it.
 * A game with no recorded click stays quiet — the badge means "changed since you opened it".
 * The click stores both the revision it saw and the clock time, so a slow device clock
 * or a click that raced an in-flight refresh still clears the badge.
 */
export function hasUpdateSinceOpen(
  updatedAt: string | null | undefined,
  opened: OpenRecord | null | undefined,
): boolean {
  if (!updatedAt || !opened) return false
  const updated = Date.parse(updatedAt)
  if (Number.isNaN(updated)) return false
  const clicked = Date.parse(opened.at)
  if (Number.isNaN(clicked) || updated <= clicked) return false
  if (opened.seen) {
    const seen = Date.parse(opened.seen)
    if (!Number.isNaN(seen) && updated <= seen) return false
  }
  return true
}

export function readOpened(storage: KeyValueStore): OpenedMap {
  const parsed = readJson(storage, OPENED_KEY)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const opened: OpenedMap = {}
  for (const [id, value] of Object.entries(parsed)) {
    const record = asOpenRecord(value)
    if (record) opened[id] = record
  }
  return opened
}

export function markOpened(storage: KeyValueStore, id: string, record: OpenRecord): void {
  const opened = readOpened(storage)
  opened[id] = record
  writeJson(storage, OPENED_KEY, opened)
}

export function readUpdateCache(storage: KeyValueStore): UpdateCache | null {
  const parsed = readJson(storage, UPDATES_KEY)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const version = (parsed as { v?: unknown }).v
  const entries = (parsed as { entries?: unknown }).entries
  if (version !== 1 || !entries || typeof entries !== 'object' || Array.isArray(entries)) return null
  const cache: UpdateCache = { v: 1, entries: {} }
  for (const [id, value] of Object.entries(entries)) {
    const entry = asUpdateEntry(value)
    if (entry) cache.entries[id] = entry
  }
  return cache
}

export function updateTimesFrom(cache: UpdateCache | null): Record<string, string> {
  if (!cache) return {}
  const times: Record<string, string> = {}
  for (const [id, entry] of Object.entries(cache.entries)) {
    if (entry.pushedAt) times[id] = entry.pushedAt
  }
  return times
}

export function pushedAtFromRepo(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const pushedAt = (body as { pushed_at?: unknown }).pushed_at
  if (typeof pushedAt !== 'string' || Number.isNaN(Date.parse(pushedAt))) return null
  return pushedAt
}

export async function fetchRepoUpdate(
  repo: string,
  etag: string | null,
  signal?: AbortSignal,
): Promise<RepoUpdateResult> {
  const url = githubRepoUrl(repo)
  if (!url) return { status: 0, etag: null, pushedAt: null }
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  })
  if (etag) headers.set('If-None-Match', etag)
  const response = await fetch(url, { headers, signal })
  const nextEtag = response.headers.get('ETag')
  if (response.status === 304) {
    return { status: 304, etag: nextEtag ?? etag, pushedAt: null }
  }
  if (!response.ok) return { status: response.status, etag: nextEtag, pushedAt: null }
  try {
    return { status: response.status, etag: nextEtag, pushedAt: pushedAtFromRepo(await response.json()) }
  } catch {
    return { status: response.status, etag: nextEtag, pushedAt: null }
  }
}

/**
 * Return the latest push time for each game, refreshing any entry older than `ttlMs`.
 * A failed lookup keeps the previous time and waits out the TTL before trying again.
 */
export async function refreshUpdateTimes(
  games: { id: string; repo: string }[],
  storage: KeyValueStore,
  now: number,
  fetchRepo: (repo: string, etag: string | null) => Promise<RepoUpdateResult> = fetchRepoUpdate,
  ttlMs = UPDATE_TTL_MS,
): Promise<Record<string, string>> {
  const cache = readUpdateCache(storage) ?? { v: 1 as const, entries: {} }
  const stale = games.filter((game) => {
    const entry = cache.entries[game.id]
    return !entry || now - entry.fetchedAt >= ttlMs
  })
  if (stale.length === 0) return updateTimesFrom(cache)

  await Promise.all(
    stale.map(async (game) => {
      const previous = cache.entries[game.id]
      try {
        const result = await fetchRepo(game.repo, previous?.etag ?? null)
        if (result.status === 304 && previous?.pushedAt) {
          cache.entries[game.id] = {
            pushedAt: previous.pushedAt,
            etag: result.etag ?? previous.etag,
            fetchedAt: now,
          }
          return
        }
        if (result.pushedAt) {
          cache.entries[game.id] = { pushedAt: result.pushedAt, etag: result.etag, fetchedAt: now }
          return
        }
      } catch {
        // Keep the last known push time and back off below.
      }
      cache.entries[game.id] = {
        pushedAt: previous?.pushedAt ?? null,
        etag: previous?.etag ?? null,
        fetchedAt: now,
      }
    }),
  )

  writeJson(storage, UPDATES_KEY, cache)
  return updateTimesFrom(cache)
}

function githubRepoUrl(repo: string): string | null {
  const slash = repo.indexOf('/')
  if (slash <= 0 || slash !== repo.lastIndexOf('/') || /\s/.test(repo)) return null
  const owner = repo.slice(0, slash)
  const name = repo.slice(slash + 1)
  if (!owner || !name) return null
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

function asOpenRecord(value: unknown): OpenRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const seen = (value as { seen?: unknown }).seen
  const at = (value as { at?: unknown }).at
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null
  if (seen !== null && (typeof seen !== 'string' || Number.isNaN(Date.parse(seen)))) return null
  return { seen: typeof seen === 'string' ? seen : null, at }
}

function asUpdateEntry(value: unknown): UpdateEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as { pushedAt?: unknown; etag?: unknown; fetchedAt?: unknown }
  if (entry.pushedAt !== null && typeof entry.pushedAt !== 'string') return null
  if (typeof entry.fetchedAt !== 'number' || !Number.isFinite(entry.fetchedAt)) return null
  return {
    pushedAt: entry.pushedAt ?? null,
    etag: typeof entry.etag === 'string' ? entry.etag : null,
    fetchedAt: entry.fetchedAt,
  }
}

function readJson(storage: KeyValueStore, key: string): unknown {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function writeJson(storage: KeyValueStore, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode and a full quota both reject writes. The shelf still opens.
  }
}
