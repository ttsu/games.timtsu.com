import catalogJson from '../catalog/games.json'

export type Category = {
  id: string
  label: string
}

export type Game = {
  id: string
  title: string
  tagline: string
  categories: string[]
  href: string
  /** GitHub `owner/name`. Used to tell when the game was pushed after the last click. */
  repo: string
  icon: string
  color: string
}

export type Catalog = {
  categories: Category[]
  games: Game[]
}

export const catalog: Catalog = catalogJson

/** Icon path or URL on the game's own site, resolved against its href. */
export function iconUrl(game: Pick<Game, 'href' | 'icon'>): string {
  const base = new URL(game.href)
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return new URL(game.icon, base).href
}

/** Categories that have at least one game, in catalog order. */
export function visibleCategories(): Category[] {
  const used = new Set(catalog.games.flatMap((game) => game.categories))
  return catalog.categories.filter((category) => used.has(category.id))
}

export function gamesIn(categoryId: string | null): Game[] {
  if (!categoryId) return catalog.games
  return catalog.games.filter((game) => game.categories.includes(categoryId))
}

/** Dark or light label color so a tile stays readable on its own color. */
export function textOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.62 ? '#1b2430' : '#f4f1ea'
}
