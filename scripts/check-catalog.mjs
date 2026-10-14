import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'catalog/games.json')

function resolveIcon(href, icon) {
  const base = new URL(href)
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return new URL(icon, base)
}

const errors = []

function fail(message) {
  errors.push(message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

let catalog
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
} catch (error) {
  console.error(`catalog/games.json: ${error.message}`)
  process.exit(1)
}

if (!isObject(catalog)) {
  console.error('catalog/games.json must be a JSON object')
  process.exit(1)
}

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const colorPattern = /^#[0-9a-fA-F]{6}$/
const repoPattern = /^[^/\s]+\/[^/\s]+$/

if (!Array.isArray(catalog.categories)) {
  fail('categories must be an array')
} else {
  const seen = new Set()
  catalog.categories.forEach((category, index) => {
    const where = `categories[${index}]`
    if (!isObject(category)) {
      fail(`${where} must be an object`)
      return
    }
    if (typeof category.id !== 'string' || !idPattern.test(category.id)) {
      fail(`${where}.id must be a lowercase slug`)
    } else if (seen.has(category.id)) {
      fail(`${where}.id "${category.id}" is duplicated`)
    } else {
      seen.add(category.id)
    }
    if (typeof category.label !== 'string' || category.label.trim() === '') {
      fail(`${where}.label must be a non-empty string`)
    }
  })
}

const categoryIds = new Set(
  Array.isArray(catalog.categories)
    ? catalog.categories.filter((category) => isObject(category)).map((category) => category.id)
    : [],
)

if (!Array.isArray(catalog.games)) {
  fail('games must be an array')
} else {
  const seen = new Set()
  catalog.games.forEach((game, index) => {
    const where = `games[${index}]`
    if (!isObject(game)) {
      fail(`${where} must be an object`)
      return
    }
    if (typeof game.id !== 'string' || !idPattern.test(game.id)) {
      fail(`${where}.id must be a lowercase slug`)
    } else if (seen.has(game.id)) {
      fail(`${where}.id "${game.id}" is duplicated`)
    } else {
      seen.add(game.id)
    }
    for (const field of ['title', 'tagline']) {
      if (typeof game[field] !== 'string' || game[field].trim() === '') {
        fail(`${where}.${field} must be a non-empty string`)
      }
    }
    if (typeof game.href !== 'string' || !game.href.startsWith('https://')) {
      fail(`${where}.href must be an https URL`)
    }
    if (typeof game.repo !== 'string' || !repoPattern.test(game.repo)) {
      fail(`${where}.repo must look like owner/name`)
    }
    if (typeof game.color !== 'string' || !colorPattern.test(game.color)) {
      fail(`${where}.color must be a #rrggbb color`)
    }
    if (typeof game.icon !== 'string' || game.icon.trim() === '') {
      fail(`${where}.icon must be a path or https URL on the game's site`)
    } else if (typeof game.href === 'string' && game.href.startsWith('https://')) {
      let iconUrl
      try {
        iconUrl = resolveIcon(game.href, game.icon)
      } catch {
        iconUrl = null
      }
      if (!iconUrl || iconUrl.protocol !== 'https:') {
        fail(`${where}.icon must resolve to an https URL`)
      } else if (iconUrl.origin !== new URL(game.href).origin) {
        fail(`${where}.icon must be hosted on ${new URL(game.href).origin}`)
      }
    }
    if (!Array.isArray(game.categories) || game.categories.length === 0) {
      fail(`${where}.categories must list at least one category id`)
    } else {
      for (const categoryId of game.categories) {
        if (typeof categoryId !== 'string' || !categoryIds.has(categoryId)) {
          fail(`${where}.categories includes unknown category "${categoryId}"`)
        }
      }
    }
  })
}

if (errors.length > 0) {
  for (const message of errors) console.error(message)
  process.exit(1)
}

const count = Array.isArray(catalog.games) ? catalog.games.length : 0
console.log(`catalog ok (${count} games)`)
