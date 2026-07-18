import { useEffect, useState } from 'react'
import { WorldMap } from './components/WorldMap'
import type { GameFilter } from './components/WorldMap'

type Game = { id: string; name: string }

function App() {
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')
  const [games, setGames] = useState<Game[]>([])

  useEffect(() => {
    fetch('/twin/games')
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load games')
        return response.json() as Promise<Game[]>
      })
      .then(setGames)
      .catch(console.error)
  }, [])

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0d0d0f]">
      <WorldMap gameFilter={gameFilter} />
      <header className="fixed inset-x-0 top-0 z-20 flex h-12 items-center justify-between bg-[#0d0d0f]/80 px-4 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-wide text-slate-100">MetaGame</span>
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
      </header>
    </main>
  )
}

export default App
