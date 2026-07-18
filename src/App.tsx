import { useEffect, useState } from 'react'
import { WorldMap } from './components/WorldMap'
import type { GameFilter, MapMode } from './components/WorldMap'

type Game = { id: string; name: string }
type Snapshot = { id: string; label: string }

function App() {
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')
  const [games, setGames] = useState<Game[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotId, setSnapshotId] = useState('2026-07-18')
  const [mapMode, setMapMode] = useState<MapMode>('users')

  useEffect(() => {
    fetch('/twin/games')
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load games')
        return response.json() as Promise<Game[]>
      })
      .then(setGames)
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch('/twin/snapshots')
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load snapshots')
        return response.json() as Promise<Snapshot[]>
      })
      .then(setSnapshots)
      .catch(console.error)
  }, [])

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0d0d0f]">
      <WorldMap gameFilter={gameFilter} snapshotId={snapshotId} mapMode={mapMode} />
      <header className="fixed inset-x-0 top-0 z-20 flex h-12 items-center justify-between bg-[#0d0d0f]/80 px-4 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-wide text-slate-100">MetaGame</span>
        <div className="flex items-center gap-2">
          <select
            aria-label="Select map mode"
            value={mapMode}
            onChange={(event) => setMapMode(event.target.value as MapMode)}
            className="rounded border border-slate-600/70 bg-slate-900/90 px-2.5 py-1.5 text-sm text-slate-100 outline-none"
          >
            <option value="users">Current users</option>
            <option value="potential">Growth potential</option>
            <option value="capacity">Latency &amp; capacity</option>
          </select>
          <select
            aria-label="View historical snapshot"
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            className="rounded border border-slate-600/70 bg-slate-900/90 px-2.5 py-1.5 text-sm text-slate-100 outline-none"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by game"
            value={gameFilter}
            onChange={(event) => setGameFilter(event.target.value as GameFilter)}
            className="rounded border border-slate-600/70 bg-slate-900/90 px-2.5 py-1.5 text-sm text-slate-100 outline-none"
          >
            <option value="all">All</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
      </header>
    </main>
  )
}

export default App
