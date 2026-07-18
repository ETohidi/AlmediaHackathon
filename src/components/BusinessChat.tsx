import { useState, type FormEvent } from 'react'

type ResearchSource = { id: string; title: string; url: string; relevance: number }
type Message = { role: 'user' | 'assistant'; text: string; researchId?: string; sources?: ResearchSource[]; researchStatus?: 'pending' | 'approved' | 'rejected'; memoryStatus?: 'syncing' | 'pending_retry'; serviceMode?: 'primary' | 'fallback' }
const suggestions = ['Which game has the best modeled margin and risk balance?', 'Where should we invest in infrastructure first?', 'Estimate the payback of onboarding a new game.']

export function BusinessChat() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const ask = async (question: string) => {
    if (!question.trim() || loading) return
    setOpen(true); setInput(''); setMessages((current) => [...current, { role: 'user', text: question }]); setLoading(true)
    try {
      const response = await fetch('/twin/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'The business agent is unavailable.')
      setMessages((current) => [...current, { role: 'assistant', text: payload.answer, researchId: payload.research?.id, sources: payload.research?.sources, researchStatus: payload.research ? 'pending' : undefined, serviceMode: payload.service_mode }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', text: error instanceof Error ? error.message : 'The business agent is unavailable.' }])
    } finally { setLoading(false) }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(input) }
  const reviewResearch = async (messageIndex: number, action: 'apply' | 'reject') => {
    const message = messages[messageIndex]
    if (!message.researchId || message.researchStatus !== 'pending') return
    const response = await fetch(`/twin/research/${encodeURIComponent(message.researchId)}/${action}`, { method: 'POST' })
    if (!response.ok) return
    const payload = await response.json()
    setMessages((current) => current.map((entry, index) => index === messageIndex ? { ...entry, researchStatus: action === 'apply' ? 'approved' : 'rejected', memoryStatus: payload.memory?.status } : entry))
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 rounded-full border border-teal-400/50 bg-slate-950/95 px-5 py-3 text-sm font-semibold text-teal-100 shadow-xl backdrop-blur hover:bg-slate-900">Ask MetaGame</button>
  return (
    <aside className="fixed bottom-4 right-4 top-16 z-40 flex w-[min(25rem,calc(100vw-2rem))] flex-col rounded-xl border border-slate-700/70 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between border-b border-slate-800 p-4"><div><p className="text-xs uppercase tracking-[0.16em] text-teal-300">MetaGame chat</p><h2 className="mt-1 font-semibold">Ask the digital twin</h2></div><button type="button" onClick={() => setOpen(false)} className="rounded px-2 text-xl text-slate-400 hover:text-white" aria-label="Close MetaGame chat">×</button></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? <><p className="text-sm leading-6 text-slate-300">Compare game economics, infrastructure investments, onboarding payback, profit, and risk.</p><p className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100">Financial values are editable modeled assumptions, not Almedia financials.</p><div className="space-y-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void ask(suggestion)} className="block w-full rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-left text-xs text-slate-300 hover:border-teal-500/50">{suggestion}</button>)}</div></> : messages.map((message, index) => <div key={`${message.role}-${index}`} className={`rounded-lg p-3 text-sm leading-6 ${message.role === 'user' ? 'ml-8 bg-teal-900/50' : 'mr-4 bg-slate-900'}`}>{message.serviceMode === 'fallback' ? <p className="mb-2 text-[10px] uppercase tracking-wide text-amber-300">Local twin fallback</p> : null}<div className="whitespace-pre-wrap">{message.text}</div>{message.sources?.length ? <div className="mt-3 border-t border-slate-700 pt-2"><p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Web evidence</p>{message.sources.map((source, sourceIndex) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-teal-300 hover:underline">[{sourceIndex + 1}] {source.title}</a>)}{message.researchStatus === 'pending' ? <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void reviewResearch(index, 'reject')} className="rounded border border-slate-600 py-1.5 text-xs">Reject</button><button type="button" onClick={() => void reviewResearch(index, 'apply')} className="rounded bg-teal-700 py-1.5 text-xs font-semibold">Approve evidence</button></div> : <p className="mt-2 text-xs text-slate-400">Evidence {message.researchStatus} · memory {message.memoryStatus === 'syncing' ? 'syncing' : 'pending retry'}</p>}</div> : null}</div>)}
        {loading ? <div className="mr-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-400">Analyzing twin economics…</div> : null}
      </div>
      <form onSubmit={submit} className="border-t border-slate-800 p-3"><div className="flex gap-2"><input value={input} onChange={(event) => setInput(event.target.value)} maxLength={2000} placeholder="Ask about profit, costs, or risk…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-teal-500" /><button disabled={loading || !input.trim()} className="rounded-lg bg-teal-600 px-4 text-sm font-semibold hover:bg-teal-500 disabled:opacity-40">Ask</button></div></form>
    </aside>
  )
}
