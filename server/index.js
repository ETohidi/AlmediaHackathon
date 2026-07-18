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

const freshnessRank = { fresh: 0, review: 1, stale: 2, missing: 3 }

const evaluateFreshness = (db, country, now = Date.now()) => {
  const ageDays = Math.max(0, (now - new Date(country.last_refreshed).getTime()) / 86_400_000)
  const policy = db.refresh_policy

  let status = 'fresh'
  if (ageDays > policy.review_max_age_days || country.confidence < policy.stale_below_confidence) {
    status = 'stale'
  } else if (ageDays > policy.fresh_max_age_days || country.confidence < policy.review_below_confidence) {
    status = 'review'
  }

  return {
    status,
    age_days: Math.round(ageDays * 10) / 10,
    reasons: [
      ...(ageDays > policy.fresh_max_age_days ? ['age'] : []),
      ...(country.confidence < policy.review_below_confidence ? ['low_confidence'] : []),
    ],
  }
}

const getSnapshot = (db, snapshotId) =>
  db.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? db.snapshots.at(-1)

const projectCountryToSnapshot = (country, snapshot) => {
  const months = snapshot.months_before_current
  if (months === 0) {
    return { ...country, snapshot_id: snapshot.id, snapshot_status: snapshot.data_status }
  }

  return {
    ...country,
    total_users: Math.round(country.total_users / Math.pow(1 + country.growth_rate_30d, months)),
    confidence: Math.max(0.3, Math.round((country.confidence - months * 0.04) * 100) / 100),
    last_refreshed: `${snapshot.id}T10:00:00.000Z`,
    snapshot_id: snapshot.id,
    snapshot_status: snapshot.data_status,
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/twin/games', (_req, res) => {
  const db = readDb()
  res.json(db.games)
})

app.get('/twin/snapshots', (_req, res) => {
  const db = readDb()
  res.json(db.snapshots)
})

app.get('/twin/meta', (_req, res) => {
  const db = readDb()
  res.json({
    dataset: db.dataset,
    sources: db.sources,
    country_game_model: db.country_game_model,
    refresh_policy: db.refresh_policy,
  })
})

app.get('/twin/attention', (_req, res) => {
  const db = readDb()
  const countries = db.countries
    .map((country) => ({
      id: country.id,
      name: country.name,
      continent_id: country.continent_id,
      confidence: country.confidence,
      freshness: evaluateFreshness(db, country),
    }))
    .filter((country) => country.freshness.status !== 'fresh')
    .sort(
      (left, right) =>
        freshnessRank[right.freshness.status] - freshnessRank[left.freshness.status] ||
        left.confidence - right.confidence,
    )

  res.json({ count: countries.length, countries })
})

app.get('/twin/validation', (req, res) => {
  const db = readDb()
  const snapshot = getSnapshot(db, req.query.asOf)
  const snapshotCountries = db.countries.map((country) => projectCountryToSnapshot(country, snapshot))
  const countries = snapshotCountries.map((country) => {
    const gameUsers = allocateCountryGames(db, country).reduce((sum, game) => sum + game.users, 0)
    return {
      id: country.id,
      country_users: country.total_users,
      game_users: gameUsers,
      matches: gameUsers === country.total_users,
    }
  })

  const continentUsers = db.continents.map((continent) => {
    const relevantCountries = snapshotCountries.filter((country) => country.continent_id === continent.id)
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
    snapshot_id: snapshot.id,
    valid: countries.every((country) => country.matches) && continentUsers.every((continent) => continent.matches),
    countries,
    continents: continentUsers,
  })
})

app.get('/twin/continents', (_req, res) => {
  const db = readDb()
  const snapshot = getSnapshot(db, _req.query.asOf)

  const payload = db.continents.map((continent) => {
    const countries = db.countries
      .filter((country) => country.continent_id === continent.id)
      .map((country) => projectCountryToSnapshot(country, snapshot))
    const totalUsers = countries.reduce((sum, country) => sum + country.total_users, 0)

    const confidence =
      countries.length > 0 ? countries.reduce((sum, country) => sum + country.confidence, 0) / countries.length : null
    const growthRate =
      totalUsers > 0
        ? countries.reduce((sum, country) => sum + country.growth_rate_30d * country.total_users, 0) / totalUsers
        : null
    const freshnessValues = countries.map((country) => evaluateFreshness(db, country))
    const freshness = freshnessValues.length
      ? freshnessValues.reduce((worst, current) =>
          freshnessRank[current.status] > freshnessRank[worst.status] ? current : worst,
        )
      : { status: 'missing', age_days: null, reasons: ['missing_data'] }

    return {
      id: continent.id,
      name: continent.name,
      label_lng: continent.label_lng,
      label_lat: continent.label_lat,
      total_users: totalUsers,
      confidence,
      growth_rate_30d: growthRate,
      growth_rate_status: countries.length > 0 ? db.dataset.growth_rate_status : 'missing',
      freshness,
      data_status: countries.length > 0 ? db.dataset.country_total_users_status : 'missing',
      source_ids: countries.length > 0 ? ['almedia-users-2026-06', 'almedia-rankings-2026-02'] : [],
      country_count: countries.length,
      snapshot_id: snapshot.id,
      snapshot_status: snapshot.data_status,
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
  const snapshot = getSnapshot(db, req.query.asOf)
  const continent = db.continents.find((entry) => entry.id === continentId)

  if (!continent) {
    res.status(404).json({ error: `Continent not found: ${continentId}` })
    return
  }

  const payload = db.countries
    .filter((country) => country.continent_id === continentId)
    .map((country) => projectCountryToSnapshot(country, snapshot))
    .map((country) => {
      return {
        id: country.id,
        name: country.name,
        continent_id: country.continent_id,
        total_users: country.total_users,
        confidence: country.confidence,
        growth_rate_30d: country.growth_rate_30d,
        growth_rate_status: db.dataset.growth_rate_status,
        freshness: evaluateFreshness(db, country),
        last_refreshed: country.last_refreshed,
        data_status: country.data_status ?? db.dataset.country_total_users_status,
        source_ids: country.source_ids ?? ['almedia-users-2026-06', 'almedia-rankings-2026-02'],
        games: allocateCountryGames(db, country),
      }
    })

  res.json({
    snapshot: { id: snapshot.id, label: snapshot.label, data_status: snapshot.data_status },
    continent: { id: continent.id, name: continent.name },
    countries: payload,
  })
})

app.listen(port, () => {
  console.log(`Twin backend listening on http://localhost:${port}`)
})
