import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  fetchRepoUpdate,
  hasUpdateSinceOpen,
  markOpened,
  pushedAtFromRepo,
  readOpened,
  readUpdateCache,
  refreshUpdateTimes,
  type KeyValueStore,
} from '../src/updates.ts'

const CORN = '2026-10-14T20:24:42Z'
const MATH = '2026-09-28T18:35:06Z'

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem(key) {
      return items.get(key) ?? null
    },
    setItem(key, value) {
      items.set(key, value)
    },
  }
}

describe('hasUpdateSinceOpen', () => {
  it('stays quiet until the game has been opened once', () => {
    assert.equal(hasUpdateSinceOpen(CORN, null), false)
    assert.equal(hasUpdateSinceOpen(null, { seen: null, at: '2026-10-01T00:00:00.000Z' }), false)
  })

  it('badges a push that landed after the last click', () => {
    assert.equal(
      hasUpdateSinceOpen(CORN, { seen: '2026-10-01T00:00:00.000Z', at: '2026-10-01T00:00:00.000Z' }),
      true,
    )
  })

  it('clears once the click is at or after the push', () => {
    assert.equal(hasUpdateSinceOpen(CORN, { seen: null, at: CORN }), false)
    assert.equal(hasUpdateSinceOpen(CORN, { seen: null, at: '2026-10-14T21:00:00.000Z' }), false)
  })

  it('clears when the click already saw this push, even if the device clock is behind', () => {
    assert.equal(
      hasUpdateSinceOpen(CORN, { seen: CORN, at: '2026-10-14T12:00:00.000Z' }),
      false,
    )
  })

  it('stays clear when a click races a refresh and the clock is already past the new push', () => {
    assert.equal(
      hasUpdateSinceOpen(CORN, { seen: MATH, at: '2026-10-14T21:00:00.000Z' }),
      false,
    )
  })

  it('ignores unreadable timestamps', () => {
    assert.equal(hasUpdateSinceOpen('yesterday', { seen: null, at: '2026-10-01T00:00:00.000Z' }), false)
    assert.equal(hasUpdateSinceOpen(CORN, { seen: null, at: 'not-a-date' }), false)
  })
})

describe('opened storage', () => {
  it('remembers each game and skips damaged records', () => {
    const storage = memoryStore()
    markOpened(storage, 'corn-utopia', { seen: CORN, at: '2026-10-14T21:00:00.000Z' })
    markOpened(storage, 'bee-happy', { seen: null, at: '2026-08-01T00:00:00.000Z' })
    storage.setItem(
      'games.opened',
      JSON.stringify({
        ...JSON.parse(storage.items.get('games.opened') ?? '{}'),
        broken: { at: 'nope' },
        missing: 4,
      }),
    )

    assert.deepEqual(readOpened(storage), {
      'corn-utopia': { seen: CORN, at: '2026-10-14T21:00:00.000Z' },
      'bee-happy': { seen: null, at: '2026-08-01T00:00:00.000Z' },
    })
  })

  it('treats corrupt JSON as no history and ignores a full quota', () => {
    const storage = memoryStore({ 'games.opened': '{' })
    assert.deepEqual(readOpened(storage), {})
    markOpened(
      {
        getItem: () => '{',
        setItem() {
          throw new Error('quota')
        },
      },
      'corn-utopia',
      { seen: null, at: '2026-10-01T00:00:00.000Z' },
    )
  })
})

describe('refreshUpdateTimes', () => {
  const games = [
    { id: 'corn-utopia', repo: 'ttsu/corn-utopia' },
    { id: 'mathtactics', repo: 'ttsu/mathtactics' },
  ]

  it('reuses a fresh cache without calling GitHub', async () => {
    const storage = memoryStore({
      'games.updates': JSON.stringify({
        v: 1,
        entries: {
          'corn-utopia': { pushedAt: CORN, etag: '"corn"', fetchedAt: 1_000 },
          mathtactics: { pushedAt: MATH, etag: '"math"', fetchedAt: 1_000 },
        },
      }),
    })
    let calls = 0
    const times = await refreshUpdateTimes(games, storage, 1_000 + 60_000, async () => {
      calls += 1
      return { status: 200, etag: null, pushedAt: '2099-01-01T00:00:00Z' }
    })
    assert.equal(calls, 0)
    assert.deepEqual(times, { 'corn-utopia': CORN, mathtactics: MATH })
  })

  it('refreshes a stale game, keeps a fresh one, and stores the new etag', async () => {
    const storage = memoryStore({
      'games.updates': JSON.stringify({
        v: 1,
        entries: {
          'corn-utopia': { pushedAt: '2026-10-01T00:00:00Z', etag: '"old"', fetchedAt: 0 },
          mathtactics: { pushedAt: MATH, etag: '"math"', fetchedAt: 500_000 },
        },
      }),
    })
    const seen: { repo: string; etag: string | null }[] = []
    const times = await refreshUpdateTimes(
      games,
      storage,
      500_000,
      async (repo, etag) => {
        seen.push({ repo, etag })
        return { status: 200, etag: '"new"', pushedAt: CORN }
      },
      1_000,
    )

    assert.deepEqual(seen, [{ repo: 'ttsu/corn-utopia', etag: '"old"' }])
    assert.deepEqual(times, { 'corn-utopia': CORN, mathtactics: MATH })
    assert.equal(readUpdateCache(storage)?.entries['corn-utopia']?.etag, '"new"')
  })

  it('keeps the previous push time when GitHub answers 304 or fails', async () => {
    const storage = memoryStore({
      'games.updates': JSON.stringify({
        v: 1,
        entries: {
          'corn-utopia': { pushedAt: CORN, etag: '"corn"', fetchedAt: 0 },
          mathtactics: { pushedAt: MATH, etag: '"math"', fetchedAt: 0 },
        },
      }),
    })
    const times = await refreshUpdateTimes(
      games,
      storage,
      999,
      async (repo) => {
        if (repo === 'ttsu/corn-utopia') return { status: 304, etag: '"corn-2"', pushedAt: null }
        throw new Error('offline')
      },
      1,
    )
    assert.deepEqual(times, { 'corn-utopia': CORN, mathtactics: MATH })
    const cache = readUpdateCache(storage)
    assert.equal(cache?.entries['corn-utopia']?.etag, '"corn-2"')
    assert.equal(cache?.entries['corn-utopia']?.fetchedAt, 999)
    assert.equal(cache?.entries.mathtactics?.fetchedAt, 999)

    let calls = 0
    await refreshUpdateTimes(games, storage, 999 + 1_000, async () => {
      calls += 1
      return { status: 200, etag: null, pushedAt: '2099-01-01T00:00:00Z' }
    }, 60_000)
    assert.equal(calls, 0)
  })

  it('backs off after a miss so a down API is not retried on every open', async () => {
    const storage = memoryStore()
    const times = await refreshUpdateTimes(
      [{ id: 'bee-happy', repo: 'ttsu/bee-happy' }],
      storage,
      50,
      async () => ({ status: 403, etag: null, pushedAt: null }),
    )
    assert.deepEqual(times, {})
    let calls = 0
    await refreshUpdateTimes(
      [{ id: 'bee-happy', repo: 'ttsu/bee-happy' }],
      storage,
      51,
      async () => {
        calls += 1
        return { status: 200, etag: null, pushedAt: CORN }
      },
      1_000,
    )
    assert.equal(calls, 0)
  })
})

describe('fetchRepoUpdate', () => {
  const original = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = original
  })

  it('reads pushed_at and sends a conditional etag', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      assert.equal(String(input), 'https://api.github.com/repos/ttsu/corn-utopia')
      assert.equal(headers.get('If-None-Match'), '"prev"')
      assert.equal(headers.get('Accept'), 'application/vnd.github+json')
      return new Response(JSON.stringify({ pushed_at: CORN }), {
        status: 200,
        headers: { ETag: '"abc"' },
      })
    }) as typeof fetch

    const result = await fetchRepoUpdate('ttsu/corn-utopia', '"prev"')
    assert.deepEqual(result, { status: 200, etag: '"abc"', pushedAt: CORN })
  })

  it('does not call the network for a repo slug it cannot address', async () => {
    globalThis.fetch = (() => {
      throw new Error('should not fetch')
    }) as typeof fetch
    const result = await fetchRepoUpdate('not a repo', null)
    assert.deepEqual(result, { status: 0, etag: null, pushedAt: null })
  })

  it('returns no push time for an error or an unreadable body', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
    assert.equal((await fetchRepoUpdate('ttsu/bee-happy', null)).pushedAt, null)

    globalThis.fetch = (async () => new Response('not-json', { status: 200 })) as typeof fetch
    assert.equal((await fetchRepoUpdate('ttsu/bee-happy', null)).pushedAt, null)
    assert.equal(pushedAtFromRepo({ pushed_at: 'nope' }), null)
    assert.equal(pushedAtFromRepo({}), null)
  })
})
