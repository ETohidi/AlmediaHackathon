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

app.get('/health', (_req, res) => {
  res.json({ ok: true })
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
      total_users: totalUsers,
      confidence,
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

  const gamesById = new Map(db.games.map((game) => [game.id, game]))

  const payload = db.countries
    .filter((country) => country.continent_id === continentId)
    .map((country) => {
      const countryGameRows = db.country_game.filter((row) => row.country_id === country.id)

      return {
        id: country.id,
        name: country.name,
        continent_id: country.continent_id,
        total_users: country.total_users,
        confidence: country.confidence,
        last_refreshed: country.last_refreshed,
        games: countryGameRows
          .map((row) => {
            const game = gamesById.get(row.game_id)
            if (!game) {
              return null
            }

            return {
              id: game.id,
              name: game.name,
              users: row.users,
            }
          })
          .filter(Boolean),
      }
    })

  res.json({ continent: { id: continent.id, name: continent.name }, countries: payload })
})

app.listen(port, () => {
  console.log(`Twin backend listening on http://localhost:${port}`)
})
