import { useState } from 'react'
import { WorldMap } from './components/WorldMap'
import type { GameFilter } from './components/WorldMap'

const games: Array<{ id: GameFilter; name: string }> = [
  { id: 'all', name: 'All' },
  { id: 'word-collect', name: 'Word Collect' },
  { id: 'office-cat', name: 'Office Cat' },
  { id: 'monopoly-go', name: 'Monopoly GO!' },
]

function App() {
  const [gameFilter, setGameFilter] = useState<GameFilter>('all')

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
