import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbPath = path.join(__dirname, 'db.json')

const app = express()
const port = Number(process.env.PORT ?? 3001)

const readDb = () => {
  const raw = fs.readFileSync(dbPath, 'utf8')
  return JSON.parse(raw)
}

const allocateCountryGames = (db, country) => {
  const weights = db.country_game_model.weights_by_continent[country.continent_id]
  if (!weights) {
    return []
  }

  let allocatedUsers = 0

  return db.games.map((game, index) => {
    const isLastGame = index === db.games.length - 1
    const users = isLastGame
      ? country.total_users - allocatedUsers
      : Math.round(country.total_users * (weights[game.id] ?? 0))

    allocatedUsers += users

    return {
      id: game.id,
      name: game.name,
      users,
      share: country.total_users > 0 ? users / country.total_users : 0,
      data_status: db.dataset.country_game_users_status,
      model_id: db.country_game_model.id,
      source_ids: game.source_ids,
    }
  })
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/twin/games', (_req, res) => {
  const db = readDb()
  res.json(db.games)
})

app.get('/twin/meta', (_req, res) => {
  const db = readDb()
  res.json({ dataset: db.dataset, sources: db.sources, country_game_model: db.country_game_model })
})

app.get('/twin/validation', (_req, res) => {
  const db = readDb()
  const countries = db.countries.map((country) => {
    const gameUsers = allocateCountryGames(db, country).reduce((sum, game) => sum + game.users, 0)
    return {
      id: country.id,
      country_users: country.total_users,
      game_users: gameUsers,
      matches: gameUsers === country.total_users,
    }
  })

  const continentUsers = db.continents.map((continent) => {
    const relevantCountries = db.countries.filter((country) => country.continent_id === continent.id)
    const countryUsers = relevantCountries.reduce((sum, country) => sum + country.total_users, 0)
    const gameUsers = relevantCountries.reduce(
      (sum, country) => sum + allocateCountryGames(db, country).reduce((gameSum, game) => gameSum + game.users, 0),
      0,
    )

    return {
      id: continent.id,
      country_users: countryUsers,
      game_users: gameUsers,
      matches: countryUsers === gameUsers,
    }
  })

  res.json({
    valid: countries.every((country) => country.matches) && continentUsers.every((continent) => continent.matches),
    countries,
    continents: continentUsers,
  })
})

app.get('/twin/continents', (_req, res) => {
  const db = readDb()

  const payload = db.continents.map((continent) => {
    const countries = db.countries.filter((country) => country.continent_id === continent.id)
    const totalUsers = countries.reduce((sum, country) => sum + country.total_users, 0)

    const confidence =
      countries.length > 0 ? countries.reduce((sum, country) => sum + country.confidence, 0) / countries.length : null

    return {
      id: continent.id,
      name: continent.name,
      label_lng: continent.label_lng,
      label_lat: continent.label_lat,
      total_users: totalUsers,
      confidence,
      data_status: countries.length > 0 ? db.dataset.country_total_users_status : 'missing',
      source_ids: countries.length > 0 ? ['almedia-users-2026-06', 'almedia-rankings-2026-02'] : [],
      country_count: countries.length,
    }
  })

  res.json(payload)
})

app.get('/twin/countries', (req, res) => {
  const continentId = req.query.continent

  if (!continentId || typeof continentId !== 'string') {
    res.status(400).json({ error: 'Query parameter "continent" is required.' })
    return
  }

  const db = readDb()
  const continent = db.continents.find((entry) => entry.id === continentId)

  if (!continent) {
    res.status(404).json({ error: `Continent not found: ${continentId}` })
    return
  }

  const payload = db.countries
    .filter((country) => country.continent_id === continentId)
    .map((country) => {
      return {
        id: country.id,
        name: country.name,
        continent_id: country.continent_id,
        total_users: country.total_users,
        confidence: country.confidence,
        last_refreshed: country.last_refreshed,
        data_status: country.data_status ?? db.dataset.country_total_users_status,
        source_ids: country.source_ids ?? ['almedia-users-2026-06', 'almedia-rankings-2026-02'],
        games: allocateCountryGames(db, country),
      }
    })

  res.json({ continent: { id: continent.id, name: continent.name }, countries: payload })
})

app.listen(port, () => {
  console.log(`Twin backend listening on http://localhost:${port}`)
})
