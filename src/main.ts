import { gamesIn, iconUrl, textOn, visibleCategories, type Game } from './catalog'
import {
  hasUpdateSinceOpen,
  markOpened,
  readOpened,
  readUpdateCache,
  refreshUpdateTimes,
  updateTimesFrom,
  type KeyValueStore,
  type OpenRecord,
} from './updates'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing #app')
const app: HTMLElement = root

/** Latest known GitHub push time for each game id. */
let updateTimes: Record<string, string> = {}
let pendingUpdates: Promise<void> | null = null

function selectedCategory(): string | null {
  const cat = new URLSearchParams(location.search).get('cat')
  return cat && cat !== 'all' ? cat : null
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

function setCategory(id: string | null): void {
  const url = new URL(location.href)
  if (id) url.searchParams.set('cat', id)
  else url.searchParams.delete('cat')
  if (url.search !== location.search) history.pushState(null, '', url)
  render()
}

function render(): void {
  const categoryId = selectedCategory()
  const games = gamesIn(categoryId)
  const categories = visibleCategories()
  const storage = browserStorage()
  const opened = storage ? readOpened(storage) : {}

  app.innerHTML = ''

  const shelf = document.createElement('main')
  shelf.className = 'shelf'

  const mast = document.createElement('header')
  mast.className = 'mast'
  const title = document.createElement('h1')
  title.textContent = 'Games'
  const lede = document.createElement('p')
  lede.className = 'lede'
  lede.textContent = 'Pick a game to play.'
  mast.append(title, lede)

  const chips = document.createElement('div')
  chips.className = 'chips'
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', 'Categories')

  const all = chip('All', categoryId === null, () => setCategory(null))
  chips.append(all)
  for (const category of categories) {
    chips.append(
      chip(category.label, categoryId === category.id, () => setCategory(category.id)),
    )
  }

  shelf.append(mast, chips)

  if (games.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'Nothing in this category yet.'
    shelf.append(empty)
  } else {
    const grid = document.createElement('div')
    grid.className = 'grid'
    for (const game of games) grid.append(tile(game, opened[game.id] ?? null, storage))
    shelf.append(grid)
  }

  if (!isStandalone()) {
    const note = document.createElement('p')
    note.className = 'install'
    note.textContent =
      'To install on iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen.'
    shelf.append(note)
  }

  app.append(shelf)
}

function chip(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'chip'
  button.textContent = label
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  button.addEventListener('click', onClick)
  return button
}

function tile(game: Game, opened: OpenRecord | null, storage: KeyValueStore | null): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = 'tile'
  link.href = game.href
  link.dataset.game = game.id
  link.style.background = game.color
  link.style.color = textOn(game.color)

  const updatedAt = updateTimes[game.id] ?? null
  const unseen = hasUpdateSinceOpen(updatedAt, opened)
  if (unseen) {
    link.setAttribute(
      'aria-label',
      `${game.title}. Updated since you last opened it. ${game.tagline}`,
    )
  }

  const icon = document.createElement('img')
  icon.className = 'tile-icon'
  icon.alt = ''
  icon.width = 124
  icon.height = 124
  icon.src = iconUrl(game)
  icon.addEventListener('error', () => {
    icon.remove()
  })

  const heading = document.createElement('h2')
  heading.className = 'tile-title'
  heading.textContent = game.title

  const tagline = document.createElement('p')
  tagline.className = 'tile-tagline'
  tagline.textContent = game.tagline

  link.append(icon, heading, tagline)

  if (unseen) {
    const badge = document.createElement('span')
    badge.className = 'update-badge'
    badge.textContent = 'Updated'
    badge.setAttribute('aria-hidden', 'true')
    link.append(badge)
  }

  const remember = () => {
    if (!storage) return
    markOpened(storage, game.id, {
      seen: updateTimes[game.id] ?? null,
      at: new Date().toISOString(),
    })
    link.querySelector('.update-badge')?.remove()
    link.removeAttribute('aria-label')
  }
  link.addEventListener('click', remember)
  link.addEventListener('auxclick', (event) => {
    if (event.button === 1) remember()
  })

  return link
}

function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadUpdates(): Promise<void> {
  if (pendingUpdates) return pendingUpdates
  pendingUpdates = (async () => {
    const storage = browserStorage()
    if (!storage) return
    const times = await refreshUpdateTimes(
      gamesIn(null).map((game) => ({ id: game.id, repo: game.repo })),
      storage,
      Date.now(),
    )
    const previous = updateTimes
    updateTimes = times
    const same =
      Object.keys(previous).length === Object.keys(times).length &&
      Object.keys(previous).every((id) => previous[id] === times[id])
    if (!same) render()
  })().finally(() => {
    pendingUpdates = null
  })
  return pendingUpdates
}

window.addEventListener('popstate', render)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) render()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void loadUpdates()
})

const stored = browserStorage()
if (stored) updateTimes = updateTimesFrom(readUpdateCache(stored))
render()
void loadUpdates()
