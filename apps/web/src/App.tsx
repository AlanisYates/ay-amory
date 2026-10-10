import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'

const TOKEN_KEY = 'ay-armory-token'
const API_BASE = ''

// ── Last-backup tracker ─────────────────────────────────────────────────
// Backups are client-side downloads, so the app records the last
// export/import in localStorage for the Home widget to show.
const BACKUP_KEY = 'ay-armory-last-backup'
const BACKUP_EVENT = 'ay-armory-backup'

type BackupRecord = { at: string; kind: 'export' | 'import'; summary: string }

function getLastBackup(): BackupRecord | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d?.at) return null
    return d as BackupRecord
  } catch { return null }
}

function recordBackup(kind: 'export' | 'import', summary: string) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), kind, summary }))
  } catch { /* private mode */ }
  window.dispatchEvent(new Event(BACKUP_EVENT))
}

// ── Types ─────────────────────────────────────────────────────────────────

type User = { id: number; email: string; firstName?: string | null }

type AmmoType = {
  id: number; userId: number; name: string; caliber: string
  grain: number | null; brand: string | null; description: string | null
}

type InventoryItem = AmmoType & { balance: number }

type CaliberGroup = {
  caliber: string
  totalBalance: number
  items: InventoryItem[]
}

type Transaction = {
  id: number; type: string; note: string | null
  occurredAt: string; price: number | null; vendor: string | null
  rangeDaySessionId?: number | null
  entries?: { id: number; ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }[]
}

type BagItem = { ammoTypeId: number; taken: number; acquired: number; inBag: number }

type RangeDayString = {
  id: number; sessionId: number; transactionId: number
  weaponId: number; ammoTypeId: number; rounds: number
  occurredAt: string; note: string | null
}

type GunLoaded = { weaponId: number; ammoTypeId: number; rounds: number; loadedAt?: string | null }

type RangeDaySession = {
  id: number; note: string | null; startedAt: string | null; endedAt: string | null
  status?: 'staged' | 'active' | 'ended'
  bag?: BagItem[]; weapons?: Weapon[]; strings?: RangeDayString[]; gunLoaded?: GunLoaded[]
}

type Weapon = {
  id: number; userId: number; name: string; caliber: string
  type: string; serialNumber: string | null; notes: string | null
  cleaningIntervalRounds: number | null; cleaningIntervalDays: number | null
  initialRounds: number
  createdAt: string; updatedAt: string
}
type WeaponCleaning = {
  id: number; weaponId: number; userId: number
  cleanedAt: string; roundCountAtCleaning: number; note: string | null; createdAt: string
}

// ── API helper ────────────────────────────────────────────────────────────

function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem(TOKEN_KEY)
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string> ?? {}),
    },
  })
}

// ── Colour helpers ────────────────────────────────────────────────────────

function balanceColor(n: number): string {
  if (n <= 0) return 'text-red-600'
  if (n < 100) return 'text-yellow-600'
  return 'text-green-700'
}

function badgeColor(type: string): string {
  switch (type) {
    case 'acquisition': return 'bg-green-100 text-green-800'
    case 'expenditure': return 'bg-red-100 text-red-800'
    case 'adjustment': return 'bg-yellow-100 text-yellow-800'
    case 'transfer': return 'bg-blue-100 text-blue-800'
    case 'range_day_start': return 'bg-purple-100 text-purple-800'
    case 'range_day_end': return 'bg-indigo-100 text-indigo-800'
    case 'range_day_load': return 'bg-blue-100 text-blue-800'
    case 'range_day_shot': return 'bg-red-100 text-red-800'
    case 'range_day_return': return 'bg-amber-100 text-amber-800'
    default: return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
  }
}

function txLabel(type: string): string {
  switch (type) {
    case 'acquisition': return 'Acquired'
    case 'expenditure': return 'Expended'
    case 'adjustment': return 'Adjusted'
    case 'transfer': return 'Transfer'
    case 'range_day_start': return 'Range Start'
    case 'range_day_end': return 'Range End'
    case 'range_day_load': return 'Loaded'
    case 'range_day_shot': return 'Shot'
    case 'range_day_return': return 'Returned'
    default: return type
  }
}

// Mechanical range-day transactions (bag/gun shuffling with no informational
// value on their own). Hidden from flat history lists; sessions surface them
// through the depletion ledger instead.
const MECHANICAL_TX_TYPES = new Set(['range_day_start', 'range_day_load', 'range_day_return'])

// Shared history grouping: range-day transactions collapse into session
// blocks, newest first; standalone transactions stay flat and interleave
// chronologically. Every block classifies as adding (in), depleting (out),
// or neutral (flat) by its net.
type HistoryRow = { tx: TxWithEntries; net: number; runningBalance: number }
type HistoryBlock =
  | { kind: 'single'; tx: TxWithEntries; net: number; runningBalance: number; newestAt: number }
  | { kind: 'session'; sessionId: number; txs: HistoryRow[]; net: number; newestAt: number }

type NetClass = 'in' | 'out' | 'flat'
function classifyNet(net: number): NetClass { return net > 0 ? 'in' : net < 0 ? 'out' : 'flat' }

function useHistoryBlocks(rows: HistoryRow[]): HistoryBlock[] {
  return useMemo<HistoryBlock[]>(() => {
    const sessionMap = new Map<number, HistoryRow[]>()
    const singles: HistoryBlock[] = []
    for (const r of rows) {
      const sid = r.tx.rangeDaySessionId
      if (sid != null) {
        if (!sessionMap.has(sid)) sessionMap.set(sid, [])
        sessionMap.get(sid)!.push(r)
      } else {
        singles.push({ kind: 'single', ...r, newestAt: new Date(r.tx.occurredAt).getTime() })
      }
    }
    const sessions: HistoryBlock[] = [...sessionMap.entries()].map(([sessionId, txs]) => ({
      kind: 'session' as const,
      sessionId,
      txs,
      net: txs.reduce((s, r) => s + r.net, 0),
      newestAt: Math.max(...txs.map(r => new Date(r.tx.occurredAt).getTime())),
    }))
    return [...sessions, ...singles].sort((a, b) => b.newestAt - a.newestAt)
  }, [rows])
}

function HistoryFilter({ value, counts, onChange }: {
  value: NetClass | 'all'
  counts: Record<NetClass | 'all', number>
  onChange: (v: NetClass | 'all') => void
}) {
  const opts: { v: NetClass | 'all'; label: string }[] = [
    { v: 'all', label: `All · ${counts.all}` },
    { v: 'in', label: `+ Adding · ${counts.in}` },
    { v: 'out', label: `− Depleting · ${counts.out}` },
    { v: 'flat', label: `= Neutral · ${counts.flat}` },
  ]
  return (
    <div className="flex gap-1.5 mb-3 flex-wrap">
      {opts.map(o => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded-full text-xs border cursor-pointer transition-colors ${value === o.v ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white' : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Shared history UI ───────────────────────────────────────────────────────
// One row language for every timeline in the app: date · chip · title ·
// subtitle · right-aligned amount, with an optional expandable body.

function TxChip({ type, label }: { type: string; label?: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badgeColor(type)}`}>
      {label ?? txLabel(type)}
    </span>
  )
}

function BurndownTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p: any) => p.value != null)
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 shadow-md text-xs min-w-[160px]">
      <p className="text-neutral-400 dark:text-neutral-500 mb-1">{label}</p>
      {rows.map((p: any) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color ?? p.stroke }} />
          <span className="text-neutral-600 dark:text-neutral-400 truncate max-w-[140px]">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function GunTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p: any) => p.value > 0)
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-2 text-xs shadow-lg">
      <p className="text-neutral-400 dark:text-neutral-500 mb-1">Wk of {label}</p>
      {rows.map((p: any) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color ?? p.fill }} />
          <span className="text-neutral-600 dark:text-neutral-400 truncate max-w-[140px]">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}


function HistoryRow({ date, chip, title, subtitle, right, expanded, onToggle, children }: {
  date: string
  chip: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
  expanded?: boolean
  onToggle?: () => void
  children?: React.ReactNode
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-400 dark:text-neutral-500 shrink-0">{date}</span>
        {chip}
        <span className="ml-auto font-semibold tabular-nums text-right">{right}</span>
        {onToggle && <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">{expanded ? '▲' : '▼'}</span>}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{title}</span>
        {subtitle ? <span> · {subtitle}</span> : null}
      </p>
      {expanded && onToggle && children != null && (
        <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">{children}</div>
      )}
    </>
  )
  if (!onToggle) {
    return <div className="px-4 py-3">{body}</div>
  }
  return (
    <button type="button" onClick={onToggle}
      className="w-full text-left px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
      {body}
      <span className="sr-only">{expanded ? 'Collapse' : 'Expand'}</span>
    </button>
  )
}

// ── Caliber data ──────────────────────────────────────────────────────────

const STANDARD_CALIBERS: { group: string; calibers: string[] }[] = [
  {
    group: 'Handgun',
    calibers: [
      '9mm', '.380 ACP', '.40 S&W', '.45 ACP',
      '.357 Magnum', '.357 SIG', '.38 Special',
      '10mm Auto', '.44 Magnum', '.22 LR',
    ],
  },
  {
    group: 'Rifle',
    calibers: [
      '5.56x45mm NATO', '.223 Remington', '.308 Winchester',
      '7.62x39mm', '6.5 Creedmoor', '.30-06 Springfield',
      '.300 Win Mag', '.300 Blackout', '.243 Winchester',
      '.270 Winchester', '7mm Rem Mag', '.338 Lapua Mag',
    ],
  },
  {
    group: 'Shotgun',
    calibers: ['12 Gauge', '20 Gauge', '.410 Bore'],
  },
]

const CUSTOM_CALIBERS_KEY = 'ay-armory-custom-calibers'

function getCustomCalibers(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CALIBERS_KEY) ?? '[]') }
  catch { return [] }
}

function saveCustomCalibers(list: string[]) {
  localStorage.setItem(CUSTOM_CALIBERS_KEY, JSON.stringify(list))
}

const ADD_CUSTOM_SENTINEL = '__add_custom__'

// ── CaliberSelect ─────────────────────────────────────────────────────────

function CaliberSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [customCalibers, setCustomCalibers] = useState<string[]>(getCustomCalibers)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')

  const allStandard = STANDARD_CALIBERS.flatMap(g => g.calibers)

  // If an existing ammo type has a caliber not in any list, surface it as custom.
  useEffect(() => {
    if (value && !allStandard.includes(value) && !customCalibers.includes(value)) {
      const updated = [...customCalibers, value]
      setCustomCalibers(updated)
      saveCustomCalibers(updated)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === ADD_CUSTOM_SENTINEL) {
      setAddingCustom(true)
      setCustomInput('')
    } else {
      onChange(e.target.value)
    }
  }

  const commitCustom = () => {
    const trimmed = customInput.trim()
    if (!trimmed) { setAddingCustom(false); return }
    if (!allStandard.includes(trimmed) && !customCalibers.includes(trimmed)) {
      const updated = [...customCalibers, trimmed]
      setCustomCalibers(updated)
      saveCustomCalibers(updated)
    }
    onChange(trimmed)
    setAddingCustom(false)
    setCustomInput('')
  }

  if (addingCustom) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          autoFocus
          placeholder="e.g. .300 Blackout"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
            if (e.key === 'Escape') setAddingCustom(false)
          }}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <button type="button" onClick={commitCustom}
          className="px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">
          Add
        </button>
        <button type="button" onClick={() => setAddingCustom(false)}
          className="px-3 py-2 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select value={value} onChange={handleSelect}
      className="px-3 py-2 border rounded-lg text-sm w-full bg-white dark:bg-neutral-900">
      {!value && <option value="" disabled>Select caliber…</option>}
      {STANDARD_CALIBERS.map(({ group, calibers }) => (
        <optgroup key={group} label={group}>
          {calibers.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ))}
      {customCalibers.length > 0 && (
        <optgroup label="Custom">
          {customCalibers.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      )}
      <option value={ADD_CUSTOM_SENTINEL}>+ Add custom caliber…</option>
    </select>
  )
}

// ── Components ────────────────────────────────────────────────────────────

function InventoryCards({ inventory, onEmpty, onCaliberClick }: {
  inventory: InventoryItem[]
  onEmpty: () => void
  onCaliberClick: (group: CaliberGroup) => void
}) {
  const groups = useMemo<CaliberGroup[]>(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const item of inventory) {
      const arr = map.get(item.caliber) ?? []
      arr.push(item)
      map.set(item.caliber, arr)
    }
    return [...map.entries()].map(([caliber, items]) => ({
      caliber,
      items,
      totalBalance: items.reduce((sum, i) => sum + i.balance, 0),
    }))
  }, [inventory])

  if (inventory.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
        <p className="text-neutral-500 dark:text-neutral-400 mb-4">No ammo types yet — create one to get started.</p>
        <button
          onClick={onEmpty}
          className="text-sm px-4 py-2 rounded-lg bg-black text-white hover:opacity-80 transition-opacity cursor-pointer"
        >
          + New Ammo Type
        </button>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {groups.map(group => (
        <button
          key={group.caliber}
          onClick={() => onCaliberClick(group)}
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 shadow-sm text-left hover:border-neutral-400 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-start justify-between mb-1">
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100 group-hover:text-neutral-700 dark:group-hover:text-neutral-300">{group.caliber}</p>
            <span className="ml-2 shrink-0 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 px-2 py-0.5 rounded-full">
              {group.items.length} type{group.items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className={`text-3xl font-bold mt-2 ${balanceColor(group.totalBalance)}`}>
            {group.totalBalance.toLocaleString()}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">rounds · tap for details</p>
        </button>
      ))}
    </div>
  )
}

// Quick action form wrapper
function QuickForm({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        <button onClick={onClose} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer text-xl leading-none">&times;</button>
      </div>
      {children}
    </div>
  )
}

type AddAmmoRow =
  | { kind: 'existing'; ammoTypeId: number; quantity: number; price: string }
  | { kind: 'new'; name: string; caliber: string; brand: string; grain: string; quantity: number; price: string }

function ExpendForm({ ammoTypes, onSuccess, onClose }: {
  ammoTypes: AmmoType[]; onSuccess: () => void; onClose: () => void
}) {
  const [ammoTypeId, setAmmoTypeId] = useState(ammoTypes[0]?.id ?? 0)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await apiFetch('/ammo/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'expenditure',
        occurredAt: new Date().toISOString(),
        note: note || null,
        entries: [{ ammoTypeId: Number(ammoTypeId), quantity: -Math.abs(Number(quantity)) }],
      }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onSuccess()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <select value={ammoTypeId} onChange={e => setAmmoTypeId(Number(e.target.value))}
        className="px-3 py-2 border rounded-lg text-sm bg-white dark:bg-neutral-900">
        {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input type="number" min="1" placeholder="Quantity" value={quantity} required
        onChange={e => setQuantity(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" placeholder="Note (e.g. Range day)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Record</button>
    </form>
  )
}

function AdjustForm({ ammoTypes, onSuccess, onClose }: {
  ammoTypes: AmmoType[]; onSuccess: () => void; onClose: () => void
}) {
  const [ammoTypeId, setAmmoTypeId] = useState(ammoTypes[0]?.id ?? 0)
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await apiFetch('/ammo/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'adjustment',
        occurredAt: new Date().toISOString(),
        note: note || null,
        entries: [{ ammoTypeId: Number(ammoTypeId), quantity: Number(quantity) }],
      }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onSuccess()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <select value={ammoTypeId} onChange={e => setAmmoTypeId(Number(e.target.value))}
        className="px-3 py-2 border rounded-lg text-sm bg-white dark:bg-neutral-900">
        {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input type="number" placeholder="Quantity (+/-)" value={quantity} required
        onChange={e => setQuantity(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" placeholder="Reason (e.g. Miscount)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Adjust</button>
    </form>
  )
}

function NewTypeForm({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [caliber, setCaliber] = useState('')
  const [grain, setGrain] = useState('')
  const [brand, setBrand] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!caliber) { setError('Please select a caliber'); return }
    const res = await apiFetch('/ammo/types', {
      method: 'POST',
      body: JSON.stringify({
        name, caliber,
        grain: grain ? Number(grain) : null,
        brand: brand || null,
        description: description || null,
      }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onSuccess()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="text" placeholder="Name (e.g. 9mm 115gr FMJ Federal)" value={name} required
        onChange={e => setName(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <CaliberSelect value={caliber} onChange={setCaliber} />
      <div className="grid grid-cols-2 gap-2">
        <input type="number" placeholder="Grain (optional)" value={grain}
          onChange={e => setGrain(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
        <input type="text" placeholder="Brand (optional)" value={brand}
          onChange={e => setBrand(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      </div>
      <input type="text" placeholder="Description (optional)" value={description}
        onChange={e => setDescription(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Create</button>
    </form>
  )
}

type AmmoRow = { ammoTypeId: number; quantity: number }

type StageInitial = {
  id?: number
  note: string | null
  weaponIds: number[]
  ammo: { ammoTypeId: number; quantity: number }[]
}

// Pack detail (weapons + bag) → wizard initial, shared by every edit path so a
// staged reload always lands on the review step with everything filled.
function packDetailToInit(id: number, d: any): StageInitial {
  return {
    id,
    note: d.note ?? null,
    weaponIds: (d.weapons ?? []).map((w: any) => w.id),
    ammo: (d.bag ?? []).map((b: any) => ({ ammoTypeId: b.ammoTypeId, quantity: b.inBag ?? b.taken ?? b.quantity ?? 0 })),
  }
}

export type RecapLine = { name: string; sub?: string; qty?: string }

// The last gate before every start (openGym's Quick check-in): recap lines,
// an honesty line about the clock/stock, a blue primary Start and a ghost
// way back to editing. Purely presentational — callers own the confirm.
function RecapSheet({ title, dateLine, guns, ammoLines, total, busy, error, disabled, disabledReason, onConfirm, onCancel, onEdit }: {
  title: string
  dateLine: string
  guns: RecapLine[]
  ammoLines: RecapLine[]
  total: string
  busy: boolean
  error: string
  disabled?: boolean
  disabledReason?: string
  onConfirm: () => void
  onCancel: () => void
  onEdit: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Ready to shoot?</h3>
          <button onClick={onCancel} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-xl leading-none cursor-pointer" aria-label="Cancel">×</button>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{title} · {dateLine}</p>
        <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-500 uppercase tracking-wide mb-1.5">Guns · {guns.length}</p>
            {guns.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">No guns packed</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {guns.map((g, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-full text-xs">
                    <span className="font-medium">{g.name}</span>
                    {g.sub && <span className="text-neutral-400 dark:text-neutral-500">{g.sub}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-500 uppercase tracking-wide mb-1.5">Ammo · {total}</p>
            {ammoLines.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500">No ammo packed</p>
            ) : (
              <div className="space-y-1">
                {ammoLines.map((a, i) => (
                  <div key={i} className="flex justify-between text-xs gap-2">
                    <span className="text-neutral-600 dark:text-neutral-400 truncate">{a.name}{a.sub ? <span className="text-neutral-400 dark:text-neutral-500"> · {a.sub}</span> : null}</span>
                    <span className="tabular-nums text-neutral-700 dark:text-neutral-300 ml-2 shrink-0">{a.qty}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-3">Clock starts on Start — stock moves from storage to your bag.</p>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <button onClick={onConfirm} disabled={busy || disabled} title={disabled ? disabledReason : undefined}
          className="mt-3 w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? 'Starting…' : 'Start range day'}
        </button>
        <button onClick={onEdit} className="mt-2 w-full text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer">
          Keep editing →
        </button>
      </div>
    </div>
  )
}

// Recap for a staged pack: fetches the pack + type names, confirms with a
// POST start. One gate for the bottom nav, Home card and Range tab alike.
function PackRecapSheet({ packId, hasActive, onStarted, onClose, onEdit }: {
  packId: number
  hasActive: boolean
  onStarted: (s: RangeDaySession) => void
  onClose: () => void
  onEdit: (init: StageInitial) => void
}) {
  const [detail, setDetail] = useState<any>(null)
  const [types, setTypes] = useState<AmmoType[]>([])
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    apiFetch(`/ammo/range-days/${packId}`).then(r => r.ok ? r.json() : null).then(d => { if (!cancelled) setDetail(d) }).catch(() => {})
    apiFetch('/ammo/types').then(r => r.ok ? r.json() : []).then(t => { if (!cancelled) setTypes(Array.isArray(t) ? t : []) }).catch(() => {})
    return () => { cancelled = true }
  }, [packId])
  const typeById = new Map(types.map(t => [t.id, t]))
  const guns: RecapLine[] = (detail?.weapons ?? []).map((w: any) => ({ name: w.name ?? `Gun #${w.id}`, sub: w.caliber ?? undefined }))
  const ammoLines: RecapLine[] = (detail?.bag ?? []).map((b: any) => {
    const t = typeById.get(b.ammoTypeId)
    const qty = b.inBag ?? b.taken ?? b.quantity ?? 0
    return { name: t?.name ?? `Type #${b.ammoTypeId}`, sub: t?.caliber, qty: `${qty.toLocaleString()} rds` }
  })
  const totalQty = (detail?.bag ?? []).reduce((s: number, b: any) => s + (b.inBag ?? b.taken ?? b.quantity ?? 0), 0)
  const start = async () => {
    setError('')
    setStarting(true)
    const res = await apiFetch(`/ammo/range-days/${packId}/start`, { method: 'POST' })
    setStarting(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not start range day'); return }
    onStarted(await res.json())
  }
  if (detail == null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="bg-white dark:bg-neutral-900 rounded-2xl p-6 text-sm text-neutral-500 dark:text-neutral-400" onClick={e => e.stopPropagation()}>Loading pack…</div>
      </div>
    )
  }
  return (
    <RecapSheet
      title={detail.note || 'Untitled pack'}
      dateLine="Today"
      guns={guns}
      ammoLines={ammoLines}
      total={`${totalQty.toLocaleString()} rds`}
      busy={starting}
      error={error}
      disabled={hasActive}
      disabledReason="End the current range day first"
      onConfirm={start}
      onCancel={onClose}
      onEdit={() => onEdit(packDetailToInit(packId, detail))}
    />
  )
}


// Fade-in on scroll into view (pack page sections), staggered on first paint.
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(true); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setShown(true); io.disconnect() }
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`reveal${shown ? ' in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
}

function RangeDayStartWizard({ onComplete, onCancel, initial = null, staged = false }: {
  onComplete: (session: RangeDaySession) => void
  onCancel: () => void
  initial?: StageInitial | null
  staged?: boolean
}) {
  const [step, setStep] = useState<1 | 2>(initial?.id != null ? 2 : 1)
  const [note, setNote] = useState(initial?.note ?? '')
  const [selectedWeapons, setSelectedWeapons] = useState<number[]>(initial?.weaponIds ?? [])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [rows, setRows] = useState<AmmoRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showRecap, setShowRecap] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/ammo/types'),
      apiFetch('/weapons'),
      apiFetch('/ammo/inventory'),
    ]).then(async ([t, w, i]) => {
      if (cancelled) return
      const types: AmmoType[] = t.ok ? await t.json() : []
      const wps: Weapon[] = w.ok ? await w.json() : []
      const inv: InventoryItem[] = i.ok ? await i.json() : []
      setAmmoTypes(types); setWeapons(wps); setInventory(inv)
      const stocked = types.filter(x => (inv.find(y => y.id === x.id)?.balance ?? 0) > 0)
      setRows([])
      if (initial?.ammo?.length) setRows(initial.ammo.map(a => ({ ammoTypeId: a.ammoTypeId, quantity: a.quantity })))
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  const balanceByType = new Map(inventory.map(i => [i.id, i.balance]))
  const availableFor = (ammoTypeId: number) => balanceByType.get(ammoTypeId) ?? 0
  const stockedTypes = ammoTypes.filter(t => availableFor(t.id) > 0)
  // Only offer ammo whose caliber matches a weapon the user put in their range bag
  // (Step 1). If no weapons were picked, fall back to showing all stocked ammo.
  const bagCalibers = new Set(
    weapons.filter(w => selectedWeapons.includes(w.id)).map(w => w.caliber)
  )
  const ammoStepTypes = bagCalibers.size > 0
    ? stockedTypes.filter(t => bagCalibers.has(t.caliber))
    : stockedTypes

  const toggleWeapon = (id: number) => {
    setSelectedWeapons(prev => prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id])
  }
  // ── Ammo "cart" helpers ──────────────────────────────────────────────
  const toggleAmmo = (id: number) => {
    setRows(prev => prev.some(r => r.ammoTypeId === id)
      ? prev.filter(r => r.ammoTypeId !== id)
      : [...prev, { ammoTypeId: id, quantity: 0 }])
  }
  const stepAmmo = (id: number, delta: number) => {
    setRows(prev => prev.flatMap(r => {
      if (r.ammoTypeId !== id) return [r]
      const next = Math.max(0, Math.min(availableFor(id), r.quantity + delta))
      return next === 0 ? [] : [{ ...r, quantity: next }]
    }))
  }
  const setAmmoQty = (id: number, val: number) => {
    if (!Number.isFinite(val) || val <= 0) { setRows(prev => prev.filter(r => r.ammoTypeId !== id)); return }
    const clamped = Math.min(availableFor(id), Math.floor(val))
    setRows(prev => prev.some(r => r.ammoTypeId === id)
      ? prev.map(r => r.ammoTypeId === id ? { ...r, quantity: clamped } : r)
      : [...prev, { ammoTypeId: id, quantity: clamped }])
  }

  const validatePack = (): string | null => {
    const ammo = rows.filter(r => r.quantity > 0)
    if (ammo.length === 0) return 'Add at least one ammo type with quantity > 0'
    if (ammo.some(r => r.quantity > availableFor(r.ammoTypeId))) return 'One or more calibers exceed what you have in storage'
    return null
  }
  const packPayload = () => {
    const ammo = rows.filter(r => r.quantity > 0)
    return { note: note || null, ammo, weapons: selectedWeapons }
  }
  const doStage = async () => {
    const err = validatePack()
    if (err) { setError(err); return }
    setError('')
    setSubmitting(true)
    const res = initial?.id != null
      ? await apiFetch(`/ammo/range-days/${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify(packPayload()),
      })
      : await apiFetch('/ammo/range-days', {
        method: 'POST',
        body: JSON.stringify({ ...packPayload(), staged: true }),
      })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onComplete(await res.json())
  }
  const doStart = async () => {
    const err = validatePack()
    if (err) { setError(err); return }
    setError('')
    setSubmitting(true)
    if (initial?.id != null) {
      const saveRes = await apiFetch(`/ammo/range-days/${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify(packPayload()),
      })
      if (!saveRes.ok) { const d = await saveRes.json(); setError(d.error || 'Error'); setSubmitting(false); return }
      const startRes = await apiFetch(`/ammo/range-days/${initial.id}/start`, { method: 'POST' })
      setSubmitting(false)
      if (!startRes.ok) { const d = await startRes.json(); setError(d.error || 'Error'); return }
      onComplete(await startRes.json())
      return
    }
    const res = await apiFetch('/ammo/range-days', {
      method: 'POST',
      body: JSON.stringify(packPayload()),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onComplete(await res.json())
  }
  const packedTotal = rows.filter(r => r.quantity > 0).reduce((s, r) => s + r.quantity, 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 1) {
      const err = validatePack()
      if (err) { setError(err); return }
      setError('')
      setStep(2)
      return
    }
    setShowRecap(true)
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 sticky top-0 z-10">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-6 h-16">
          <button onClick={onCancel} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer">← Cancel</button>
          <h1 className="text-lg font-bold tracking-tight">{initial?.id != null ? 'Edit pack list' : staged ? 'Pack for later' : 'Start Range Day'}</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Step heading */}
        <h2 className="text-xl font-semibold text-center text-neutral-900 dark:text-neutral-100 mb-6">
          {step === 1 ? 'Pack your bag' : 'Review your pack'}
        </h2>

        {loading ? (
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">Loading…</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            {step === 1 && (
              <div className="flex flex-col gap-8">
                <Reveal>
                  <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">1 · Where to</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">Give this range day a name — usually where you&apos;re shooting.</p>
                  <input type="text" autoFocus placeholder="e.g. Burro Canyon" value={note}
                    onChange={e => setNote(e.target.value)}
                    className="w-full px-4 py-3 border border-neutral-300 dark:border-neutral-600 rounded-xl text-base bg-white dark:bg-neutral-900" />
                </Reveal>
                <Reveal delay={90}>
                  <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">2 · Guns</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">Tap the weapons you&apos;re bringing. You can add more later on the Weapons tab.</p>
                {weapons.length === 0 ? (
                  <p className="text-sm text-neutral-400 dark:text-neutral-500">No weapons yet — you can skip this and add them later.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {weapons.map(w => {
                      const selected = selectedWeapons.includes(w.id)
                      return (
                        <button type="button" key={w.id} onClick={() => toggleWeapon(w.id)}
                          className={`text-left rounded-xl border p-4 flex flex-col gap-3 transition-colors cursor-pointer ${
                            selected ? 'border-black bg-neutral-50 dark:bg-neutral-800 ring-1 ring-black' : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-neutral-400'
                          }`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{w.name}</p>
                              <p className="text-xs text-neutral-400 dark:text-neutral-500 capitalize mt-0.5">{w.type} · {w.caliber}</p>
                            </div>
                            <span className="shrink-0 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 px-2 py-0.5 rounded-full">{w.caliber}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${selected ? 'bg-black text-white border-black' : 'border-neutral-300 dark:border-neutral-600 text-transparent'}`}>✓</span>
                            <span className={selected ? 'text-neutral-900 dark:text-neutral-100 font-medium' : 'text-neutral-400 dark:text-neutral-500'}>
                              {selected ? 'In your range bag' : 'Add to range bag'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                </Reveal>
                <Reveal delay={180}>
                  <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">3 · Ammo</p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">Filtered to the calibers of your guns{selectedWeapons.length === 0 ? ' — pick a gun above to narrow it down' : ''}.</p>
                  <div>
                  {ammoStepTypes.length === 0 ? (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
                      {bagCalibers.size > 0
                        ? 'No ammo in storage matches the calibers of the weapons in your range bag.'
                        : 'No rounds in storage — add inventory on the Ammo tab first.'}
                    </p>
                  ) : (
                <div className="flex flex-col gap-2">
                      {ammoStepTypes.map(t => {
                        const row = rows.find(r => r.ammoTypeId === t.id)
                        const inCart = !!row
                        const qty = row?.quantity ?? 0
                        const avail = availableFor(t.id)
                        const over = qty > avail
                        return (
                          <div key={t.id}
                            onClick={() => { if (!inCart) toggleAmmo(t.id) }}
                            className={`rounded-xl border p-4 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                              inCart ? 'border-black bg-neutral-50 dark:bg-neutral-800' : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-neutral-400'
                            }`}>
                            <div>
                              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{t.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${over ? 'bg-red-100 text-red-700' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'}`}>{t.caliber}</span>
                                <span className={`text-xs ${over ? 'text-red-500' : 'text-neutral-400 dark:text-neutral-500'}`}>{avail.toLocaleString()} in storage</span>
                              </div>
                            </div>
                            {inCart ? (
                              <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                                <QuickAdd rounds={qty} cap={avail}
                                  onChange={(n) => setAmmoQty(t.id, n)}
                                  onStep={(d) => stepAmmo(t.id, d)}
                                  steps={[5, 10, 50, 100]} step={1} inline />
                                <button type="button" onClick={() => toggleAmmo(t.id)} title="Remove"
                                  className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-red-500 hover:border-red-200 cursor-pointer">×</button>
                              </div>
                            ) : (
                              <span className="text-sm text-neutral-400 dark:text-neutral-500">Add</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <div className="mt-2">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">Total packed</span>
                    <span className="tabular-nums font-bold text-neutral-900 dark:text-neutral-100">{packedTotal.toLocaleString()} rds</span>
                  </div>
                  <button type="button" onClick={() => {
                    const err = validatePack()
                    if (err) { setError(err); return }
                    setError('')
                    setStep(2)
                  }}
                    className="w-full px-4 py-3 bg-black text-white rounded-xl text-base font-semibold hover:opacity-80 cursor-pointer">
                    Review pack →
                  </button>
                </div>
                </Reveal>
              </div>
            )}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Where to</p>
                    <button type="button" onClick={() => setStep(1)}
                      className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer">Edit</button>
                  </div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{note !== '' ? `“${note}”` : 'Untitled range day'}</p>
                </div>
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">Weapons</p>
                  {selectedWeapons.length === 0 ? (
                    <p className="text-sm text-neutral-400 dark:text-neutral-500">No weapons selected</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {weapons.filter(w => selectedWeapons.includes(w.id)).map(w => (
                        <span key={w.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full text-sm">
                          <span className="font-medium text-neutral-800 dark:text-neutral-200">{w.name}</span>
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">{w.caliber}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
                  <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">Ammo</p>
                  {rows.filter(r => r.quantity > 0).length === 0 ? (
                    <p className="text-sm text-neutral-400 dark:text-neutral-500">No ammo packed</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {rows.filter(r => r.quantity > 0).map(r => {
                        const t = ammoTypes.find(x => x.id === r.ammoTypeId)
                        return (
                          <div key={r.ammoTypeId} className="flex justify-between text-sm">
                            <span className="text-neutral-700 dark:text-neutral-300 truncate">{t?.name ?? `Type #${r.ammoTypeId}`} <span className="text-neutral-400 dark:text-neutral-500">· {t?.caliber ?? ''}</span></span>
                            <span className="tabular-nums font-semibold text-neutral-900 dark:text-neutral-100 ml-2 shrink-0">{r.quantity.toLocaleString()} rds</span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between text-sm border-t border-neutral-100 dark:border-neutral-800 pt-1.5 mt-1">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">Total</span>
                        <span className="tabular-nums font-bold text-neutral-900 dark:text-neutral-100">{rows.filter(r => r.quantity > 0).reduce((s, r) => s + r.quantity, 0).toLocaleString()} rds</span>
                      </div>
                    </div>
                  )}
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setStep(1)}
                    className="px-4 py-2 rounded-lg text-sm cursor-pointer bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700">
                    ← Back
                  </button>
                  <button type="button" onClick={() => void doStage()} disabled={submitting}
                    className="flex-1 px-4 py-2 rounded-lg text-sm cursor-pointer bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                    {initial?.id != null ? 'Save changes' : 'Stage for later'}
                  </button>
                  <button type="button" onClick={() => setShowRecap(true)} disabled={submitting}
                    className="flex-1 px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer disabled:opacity-40">
                    Start range day
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </main>
      {showRecap && (
        <RecapSheet
          title={note !== '' ? `“${note}”` : 'Untitled range day'}
          dateLine="Today"
          guns={weapons.filter(w => selectedWeapons.includes(w.id)).map(w => ({ name: w.name, sub: w.caliber }))}
          ammoLines={rows.filter(r => r.quantity > 0).map(r => {
            const t = ammoTypes.find(x => x.id === r.ammoTypeId)
            return { name: t?.name ?? `Type #${r.ammoTypeId}`, sub: t?.caliber, qty: `${r.quantity.toLocaleString()} rds` }
          })}
          total={`${rows.filter(r => r.quantity > 0).reduce((s, r) => s + r.quantity, 0).toLocaleString()} rds`}
          busy={submitting}
          error={error}
          onConfirm={() => void doStart()}
          onCancel={() => { setError(''); setShowRecap(false) }}
          onEdit={() => { setError(''); setShowRecap(false) }}
        />
      )}
    </div>
  )
}

// ── Ammo Type Manager ─────────────────────────────────────────────────────

function AmmoTypeManager({ ammoTypes, onRefresh }: {
  ammoTypes: AmmoType[]; onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<AmmoType>>({})
  const [error, setError] = useState('')

  const startEdit = (t: AmmoType) => { setEditingId(t.id); setEditData({ name: t.name, caliber: t.caliber, grain: t.grain, brand: t.brand, description: t.description }) }

  const saveEdit = async () => {
    if (editingId == null) return
    const res = await apiFetch(`/ammo/types/${editingId}`, {
      method: 'PATCH',
      body: JSON.stringify(editData),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    setEditingId(null)
    onRefresh()
  }

  const deleteType = async (id: number) => {
    if (!confirm('Delete this ammo type?')) return
    const res = await apiFetch(`/ammo/types/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error || 'Cannot delete')
      return
    }
    onRefresh()
  }

  if (ammoTypes.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">No ammo types yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-700 text-left text-neutral-500 dark:text-neutral-400">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Caliber</th>
            <th className="py-2 pr-4">Grain</th>
            <th className="py-2 pr-4">Brand</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {ammoTypes.map(t => (
            <tr key={t.id} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
              {editingId === t.id ? (
                <>
                  <td className="py-2 pr-4"><input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full" /></td>
                  <td className="py-2 pr-4 min-w-[160px]"><CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} /></td>
                  <td className="py-2 pr-4"><input type="number" value={editData.grain ?? ''} onChange={e => setEditData(d => ({ ...d, grain: e.target.value ? Number(e.target.value) : null }))} className="px-2 py-1 border rounded text-sm w-20" /></td>
                  <td className="py-2 pr-4"><input value={editData.brand ?? ''} onChange={e => setEditData(d => ({ ...d, brand: e.target.value || null }))} className="px-2 py-1 border rounded text-sm w-24" /></td>
                  <td className="py-2 flex gap-2">
                    <button onClick={saveEdit} className="text-xs px-2 py-1 bg-black text-white rounded cursor-pointer hover:opacity-80">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-4 font-medium">{t.name}</td>
                  <td className="py-2 pr-4 text-neutral-500 dark:text-neutral-400">{t.caliber}</td>
                  <td className="py-2 pr-4 text-neutral-500 dark:text-neutral-400">{t.grain ?? '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500 dark:text-neutral-400">{t.brand ?? '—'}</td>
                  <td className="py-2 flex gap-2">
                    <button onClick={() => startEdit(t)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Edit</button>
                    <button onClick={() => deleteType(t.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded cursor-pointer hover:bg-red-50">Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Transaction History ───────────────────────────────────────────────────

function TransactionHistory({ ammoTypes }: { ammoTypes: AmmoType[] }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [filterType, setFilterType] = useState('')
  const [filterAmmoTypeId, setFilterAmmoTypeId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType) params.set('type', filterType)
    if (filterAmmoTypeId) params.set('ammoTypeId', filterAmmoTypeId)
    const res = await apiFetch(`/ammo/transactions?${params}`)
    if (res.ok) setTransactions(await res.json())
    setLoading(false)
  }, [filterType, filterAmmoTypeId])

  useEffect(() => { load() }, [load])

  const loadEntries = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return }
    const res = await apiFetch(`/ammo/transactions/${id}`)
    if (res.ok) {
      const tx = await res.json()
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, entries: tx.entries } : t))
    }
    setExpandedId(id)
  }

  const typeForId = (id: number) => ammoTypes.find(t => t.id === id)?.name ?? `Type #${id}`

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white dark:bg-neutral-900">
          <option value="">All types</option>
          {['acquisition', 'expenditure', 'adjustment', 'transfer', 'range_day_start', 'range_day_end'].map(t => (
            <option key={t} value={t}>{txLabel(t)}</option>
          ))}
        </select>
        <select value={filterAmmoTypeId} onChange={e => setFilterAmmoTypeId(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white dark:bg-neutral-900">
          <option value="">All ammo types</option>
          {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading...</p>
      ) : transactions.length === 0 ? (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">No transactions yet.</p>
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm divide-y divide-neutral-100 dark:divide-neutral-800">
          {transactions.map(tx => {
            const expanded = expandedId === tx.id
            return (
              <HistoryRow key={tx.id}
                date={new Date(tx.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                chip={<TxChip type={tx.type} />}
                title={tx.note ?? txLabel(tx.type)}
                expanded={expanded}
                onToggle={() => loadEntries(tx.id)}
              >
                {tx.entries && (
                  <div className="space-y-1">
                    {tx.entries.filter(e => !e.isBalancing).map(e => (
                      <div key={e.id} className="flex items-center gap-2 text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">{typeForId(e.ammoTypeId)}</span>
                        <span className={e.quantity > 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                          {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                        </span>
                        <span className="text-neutral-400 dark:text-neutral-500 text-xs">[{e.location}]</span>
                      </div>
                    ))}
                    {tx.price != null && (
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                        Price: ${(tx.price / 100).toFixed(2)}{tx.vendor ? ` · ${tx.vendor}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </HistoryRow>
            )
          })}
        </div>
      )}
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// Ticking clock for "Xm ago" labels. Display-only: it just re-renders, no API
// traffic, and all math derives from server-persisted occurredAt timestamps,
// so a refresh or phone restart self-corrects on the next fetch.
function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function PprCalculatorModal({ onClose }: { onClose: () => void }) {
  const [roundsStr, setRoundsStr] = useState('')
  const [totalStr, setTotalStr] = useState('')
  const roundsRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    roundsRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rounds = Number(roundsStr.replace(/,/g, '').trim())
  const total = Number(totalStr.replace(/[$,\s]/g, '').trim())
  const valid = Number.isFinite(rounds) && Number.isFinite(total) && rounds > 0 && total >= 0
  const ppr = valid ? total / rounds : null
  const headline = ppr == null
    ? '— per round'
    : ppr < 1
      ? `${(ppr * 100).toFixed(1)}¢ per round`
      : `$${ppr.toFixed(2)} per round`
  const detail = ppr == null
    ? 'Enter rounds + total above'
    : `$${ppr.toFixed(4)} / rd · $${(ppr * 1000).toFixed(2)} per 1000`

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4"
      onClick={onClose}>
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-sm w-full p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Price per Round</h3>
          <button onClick={onClose} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-xl leading-none cursor-pointer">×</button>
        </div>
        <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">Rounds</label>
        <input ref={roundsRef} type="text" inputMode="numeric" placeholder="e.g. 1000"
          value={roundsStr} onChange={e => setRoundsStr(e.target.value)}
          className="w-full px-4 py-3 border rounded-xl text-lg tabular-nums mb-4" />
        <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">Total cost</label>
        <input type="text" inputMode="decimal" placeholder="e.g. 45.99"
          value={totalStr} onChange={e => setTotalStr(e.target.value)}
          className="w-full px-4 py-3 border rounded-xl text-lg tabular-nums" />
        <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-4 text-center">
          <p className="text-2xl font-bold tabular-nums">{headline}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums mt-1">{detail}</p>
        </div>
        <button type="button" onClick={() => { setRoundsStr(''); setTotalStr(''); roundsRef.current?.focus() }}
          className="mt-4 w-full px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Clear</button>
      </div>
    </div>
  )
}

function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}

// Day-complete summary (openGym FinishSummary): locked sheet after the end
// POST lands — duration/fired/guns/returned tiles, caliber bars, per-gun
// today + lifetime rows, then Nice! back to the dashboard.
function DayCompleteSheet({ note, startedAt, endedAt, strings, weapons, ammoTypes, bag, totals, onDone }: {
  note: string | null
  startedAt: string | null
  endedAt: string
  strings: RangeDayString[]
  weapons: Weapon[]
  ammoTypes: AmmoType[]
  bag: BagItem[]
  totals: Record<number, number>
  onDone: () => void
}) {
  const typeById = new Map(ammoTypes.map(t => [t.id, t]))
  const totalFired = strings.reduce((s, x) => s + x.rounds, 0)
  const returned = bag.reduce((s, b) => s + b.inBag, 0)
  const firedGuns = [...new Set(strings.map(s => s.weaponId))]
  const byGun = firedGuns.map(id => ({
    id,
    name: weapons.find(w => w.id === id)?.name ?? `Gun #${id}`,
    today: strings.filter(s => s.weaponId === id).reduce((s, x) => s + x.rounds, 0),
    lifetime: totals[id] ?? 0,
  })).sort((a, b) => b.today - a.today)
  const byCaliber = (() => {
    const map = new Map<string, number>()
    for (const s of strings) {
      const cal = typeById.get(s.ammoTypeId)?.caliber ?? 'Unknown'
      map.set(cal, (map.get(cal) ?? 0) + s.rounds)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  })()
  const maxCal = Math.max(...byCaliber.map(([, n]) => n), 1)
  const when = new Date(endedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto">
        <div className="text-center">
          <div className="flex justify-center text-green-700 dark:text-green-400"><TabIcon name="range" size={44} /></div>
          <h3 className="text-lg font-semibold mt-2">Range day complete!</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{note ? `“${note}” · ` : ''}{when}</p>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4 text-center">
          {[
            { label: 'Time', value: startedAt ? fmtDuration(new Date(endedAt).getTime() - new Date(startedAt).getTime()) : '–' },
            { label: 'Fired', value: totalFired.toLocaleString() },
            { label: 'Guns', value: `${firedGuns.length}` },
            { label: 'Back', value: returned.toLocaleString() },
          ].map(t => (
            <div key={t.label} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1 py-2.5">
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">{t.label}</p>
              <p className="text-base font-bold tabular-nums mt-0.5">{t.value}</p>
            </div>
          ))}
        </div>
        {byCaliber.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1.5">What you just shot</p>
            <div className="flex flex-col gap-1">
              {byCaliber.map(([cal, n]) => (
                <div key={cal}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{cal}</span>
                    <span className="text-sm font-semibold tabular-nums shrink-0">{n.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-neutral-800 dark:bg-neutral-200" style={{ width: `${Math.max(4, Math.round((n / maxCal) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1.5">Per gun</p>
          {byGun.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">No shots logged this time.</p>
          ) : (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
              {byGun.map(g => (
                <div key={g.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <span className="text-sm font-medium truncate">{g.name}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums shrink-0">
                    {g.today.toLocaleString()} today{g.lifetime > 0 ? ` · ${g.lifetime.toLocaleString()} all-time` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={onDone}
          className="mt-5 w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 cursor-pointer">
          Nice!
        </button>
      </div>
    </div>
  )
}

function ConfirmEndModal({ bag, strings, weapons, ammoTypes, onConfirm, onCancel }: {
  bag: BagItem[]
  strings: RangeDayString[]
  weapons: Weapon[]
  ammoTypes: AmmoType[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const leftover = bag.reduce((s, b) => s + b.inBag, 0)
  const totalAcquired = bag.reduce((s, b) => s + b.acquired, 0)

  const firedByWeapon = new Map<number, Map<number, number>>()
  let totalFired = 0
  for (const s of strings) {
    totalFired += s.rounds
    if (!firedByWeapon.has(s.weaponId)) firedByWeapon.set(s.weaponId, new Map())
    const m = firedByWeapon.get(s.weaponId)!
    m.set(s.ammoTypeId, (m.get(s.ammoTypeId) ?? 0) + s.rounds)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-1">End Range Day</h3>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
          Any ammo left in the bag (<span className="font-semibold">{leftover}</span> rounds) will be returned to storage.
          Rounds already fired are recorded as expended.
        </p>

        <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
          <div className="px-3 py-2 flex justify-between text-sm">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Fired this session</span>
            <span className="font-semibold">{totalFired}</span>
          </div>
          {[...firedByWeapon.entries()].map(([weaponId, byType]) => {
            const w = weapons.find(x => x.id === weaponId)
            const weaponTotal = [...byType.values()].reduce((a, b) => a + b, 0)
            return (
              <div key={weaponId} className="px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{w?.name ?? `Weapon #${weaponId}`}</span>
                  <span className="text-neutral-500 dark:text-neutral-400">{weaponTotal}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {[...byType.entries()].map(([ammoTypeId, rounds]) => {
                    const t = ammoTypes.find(a => a.id === ammoTypeId)
                    return (
                      <div key={ammoTypeId} className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 pl-3">
                        <span>{t?.name ?? `Type #${ammoTypeId}`}</span>
                        <span>{rounds}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div className="px-3 py-2 flex justify-between text-sm">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Bought this session</span>
            <span className="font-semibold">{totalAcquired}</span>
          </div>
          {bag.filter(b => b.acquired > 0).map(b => {
            const t = ammoTypes.find(a => a.id === b.ammoTypeId)
            return (
              <div key={b.ammoTypeId} className="px-3 py-1.5 flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{t?.name ?? `Type #${b.ammoTypeId}`}</span>
                <span>{b.acquired}</span>
              </div>
            )
          })}

          <div className="px-3 py-2 flex justify-between text-sm">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">Returning to storage</span>
            <span className="font-semibold">{leftover}</span>
          </div>
          {bag.filter(b => b.inBag > 0).map(b => {
            const t = ammoTypes.find(a => a.id === b.ammoTypeId)
            return (
              <div key={b.ammoTypeId} className="px-3 py-1.5 flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>{t?.name ?? `Type #${b.ammoTypeId}`}</span>
                <span>{b.inBag}</span>
              </div>
            )
          })}
        </div>

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={onCancel}
            className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Keep shooting</button>
          <button type="button" onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer">End Range Day</button>
        </div>
      </div>
    </div>
  )
}

function WeaponRangeCard({ weapon, bag, ammoTypes, gunLoaded, strings, onAction, typeForId, lastLoad, onSetLastLoad }: {
  weapon: Weapon
  bag: BagItem[]
  ammoTypes: AmmoType[]
  gunLoaded: GunLoaded[]
  strings: RangeDayString[]
  onAction: (action: 'load' | 'shoot' | 'return', weaponId: number, ammoTypeId: number, rounds: number, note: string) => Promise<string | null>
  typeForId: (id: number) => AmmoType | undefined
  lastLoad: { ammoTypeId: number; quantity: number } | null
  onSetLastLoad: (v: { ammoTypeId: number; quantity: number } | null) => void
}) {
  const [ammoTypeId, setAmmoTypeId] = useState<number>(bag[0]?.ammoTypeId ?? 0)
  const [rounds, setRounds] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [stage, setStage] = useState<'load' | 'shoot'>(
    gunLoaded.some(g => g.weaponId === weapon.id && g.rounds > 0) ? 'shoot' : 'load'
  )
  const [showEndDialog, setShowEndDialog] = useState(false)
  const [showPartial, setShowPartial] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  useNow(30000)

  useEffect(() => {
    if (stage === 'load') {
      if (!bag.some(b => b.ammoTypeId === ammoTypeId)) {
        const matches = bag.filter(b => {
          const t = typeForId(b.ammoTypeId)
          return !!t && t.caliber === weapon.caliber && b.inBag > 0
        })
        setAmmoTypeId(matches.length > 0 ? matches[0].ammoTypeId : 0)
      }
    } else if (stage === 'shoot') {
      const activeLoaded = loaded.find(g => g.ammoTypeId === ammoTypeId)?.rounds ?? 0
      if (loaded.length && (activeLoaded === 0 || !loaded.some(g => g.ammoTypeId === ammoTypeId))) {
        const next = loaded.find(g => g.rounds > 0)
        if (next) setAmmoTypeId(next.ammoTypeId)
      }
      // auto-flip to load when nothing left to shoot
      if (stage === 'shoot' && loaded.every(g => g.rounds === 0) && loaded.length > 0) {
        // keep stage as shoot but will show empty; parent will handle via act
      }
    }
  }, [bag, gunLoaded, ammoTypeId, stage])

  const loaded = gunLoaded.filter(g => g.weaponId === weapon.id)
  useEffect(() => {
    if (stage === 'shoot' && loaded.length === 0) {
      setStage('load')
    }
  }, [loaded, stage])
  const availableMatch = bag.filter(b => {
    const t = typeForId(b.ammoTypeId)
    return !!t && t.caliber === weapon.caliber && b.inBag > 0
  })
  const selectOptions = stage === 'shoot' ? loaded : availableMatch
  const selectedValid = selectOptions.some(o => o.ammoTypeId === ammoTypeId)
  const activeTypeId = selectedValid ? ammoTypeId : (selectOptions[0]?.ammoTypeId ?? 0)
  const autoMatch = availableMatch.length === 1 ? availableMatch[0] : null
  const loadTypeId = autoMatch ? autoMatch.ammoTypeId : activeTypeId
  const inBag = bag.find(b => b.ammoTypeId === loadTypeId)?.inBag ?? 0
  const loadedForAmmo = loaded.find(g => g.ammoTypeId === activeTypeId)?.rounds ?? 0
  const firedForAmmo = strings
    .filter(s => s.weaponId === weapon.id && s.ammoTypeId === activeTypeId)
    .reduce((s, x) => s + x.rounds, 0)
  const cap = stage === 'shoot' ? loadedForAmmo : inBag
  const setRoundsClamped = (n: number) => {
    if (!Number.isFinite(n) || n < 0) setRounds(0)
    else setRounds(Math.min(cap, Math.floor(n)))
  }
  const step = (d: number) => setRoundsClamped(rounds + d)
  const act = async (action: 'load' | 'shoot' | 'return', useAll = false) => {
    setError('')
    const id = stage === 'load' ? loadTypeId : activeTypeId
    const amount = useAll ? (action === 'load' ? inBag : loadedForAmmo) : rounds
    if (!id) { setError('Select an ammo type'); return }
    if (action === 'load') {
      if (inBag === 0) { setError('No ammo of this type in the bag'); return }
      if (amount <= 0) { setError('Enter a positive round count'); return }
      if (amount > inBag) { setError(`Only ${inBag} in the bag`); return }
    } else {
      if (loadedForAmmo === 0) { setError('Nothing loaded for this ammo'); return }
      if (amount <= 0) { setError('Enter a positive round count'); return }
      if (amount > loadedForAmmo) { setError(`Only ${loadedForAmmo} loaded`); return }
    }
    const err = await onAction(action, weapon.id, id, amount, note)
    if (err) { setError(err); return }
    if (action === 'load') onSetLastLoad({ ammoTypeId: id, quantity: amount })
    setRounds(0)
    setNote('')
    setShowPartial(false)
    if (action === 'load') {
      setStage('shoot')
    } else if (action === 'shoot' && useAll) {
      const remaining = loadedForAmmo - amount
      if (remaining <= 0) setStage('load')
      setToast(`Shot ${amount} RDS`)
      setTimeout(() => setToast(null), 2200)
    } else if (action === 'shoot') {
      setToast(`Shot ${amount} RDS`)
      setTimeout(() => setToast(null), 2000)
    }
  }
  const endRound = () => {
    const remaining = loaded.filter(g => g.rounds > 0)
    if (remaining.length === 0) { setStage('load'); return }
    setShowEndDialog(true)
  }
  const confirmEndRound = async () => {
    setShowEndDialog(false)
    setError('')
    for (const g of loaded) {
      if (g.rounds <= 0) continue
      const err = await onAction('return', weapon.id, g.ammoTypeId, g.rounds, note)
      if (err) { setError(err); return }
    }
    setNote('')
    setRounds(0)
    setShowPartial(false)
    setStage('load')
  }
  const remainingEntries = loaded.filter(g => g.rounds > 0)
  const remainingTotal = remainingEntries.reduce((s, g) => s + g.rounds, 0)
  const firedTotal = strings.filter(s => s.weaponId === weapon.id).reduce((s, x) => s + x.rounds, 0)
  const inventoryItems = (stage === 'load'
    ? availableMatch.map(b => ({ ammoTypeId: b.ammoTypeId, rounds: b.inBag }))
    : loaded.map(g => ({ ammoTypeId: g.ammoTypeId, rounds: g.rounds }))
  ).filter(x => x.rounds > 0)
  const inventoryTotal = inventoryItems.reduce((s, x) => s + x.rounds, 0)
  const selectedTypeId = stage === 'load' ? loadTypeId : activeTypeId
  const redoAmmo = lastLoad ? typeForId(lastLoad.ammoTypeId) : null
  const redoAvail = lastLoad ? (bag.find(b => b.ammoTypeId === lastLoad.ammoTypeId)?.inBag ?? 0) : 0
  const canRedo = lastLoad ? redoAvail >= lastLoad.quantity : false
  // ── In-progress round status: the persistent "did I shoot what I loaded?"
  // answer. Latest load time (server-persisted `loadedAt`, survives refresh)
  // vs the latest recorded shot for this weapon.
  const weaponStrings = strings.filter(s => s.weaponId === weapon.id)
  const lastShot = weaponStrings.length
    ? weaponStrings.reduce((a, b) => (new Date(a.occurredAt) > new Date(b.occurredAt) ? a : b))
    : null
  const loadedAtList = loaded.map(g => g.loadedAt).filter((x): x is string => !!x)
  const lastLoadAt = loadedAtList.length ? loadedAtList.reduce((a, b) => (a > b ? a : b)) : null
  // Date-object comparison (never lexicographic): one non-ISO timestamp must
  // not silently flip the ordering.
  const lastLoadTime = lastLoadAt ? new Date(lastLoadAt).getTime() : null
  const lastShotTime = lastShot ? new Date(lastShot.occurredAt).getTime() : null
  // A load is "fresh" only if it is newer than the latest recorded shot.
  // Missing load timestamp (legacy loads) never counts as fresh.
  const loadIsFresh = remainingTotal > 0 && lastLoadTime != null && (lastShotTime == null || lastLoadTime >= lastShotTime)
  const loadIsPending = remainingTotal > 0 && (loadIsFresh || lastLoadTime == null)
  const lastShotAmmo = lastShot ? typeForId(lastShot.ammoTypeId) : null

  return (
    <>
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 flex flex-col">
      {/* Weapon hero top, Loaded/Fired underneath like before */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-6 py-5 text-center">
        <div className="mx-auto w-full max-w-[220px] h-24 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center text-[11px] text-neutral-400 dark:text-neutral-500">
          Photo
        </div>
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mt-3">{weapon.name}</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full">{weapon.caliber}</span>
          <span className="text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full capitalize">{weapon.type}</span>
        </div>
        {firedTotal > 0 && (
          <p className="text-xs font-semibold text-red-600 mt-2">{firedTotal.toLocaleString()} RDS total this session</p>
        )}
        {lastShot && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Last: {lastShot.rounds} RDS{lastShotAmmo ? ` · ${lastShotAmmo.name}` : ''} · {relativeTime(lastShot.occurredAt)}
          </p>
        )}
        {firedTotal > 0 && (
          <button type="button" onClick={() => setShowBreakdown(v => !v)} className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 underline cursor-pointer">
            {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
          </button>
        )}
        {showBreakdown && firedTotal > 0 && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {(() => {
              const byAmmo = new Map<number, number>()
              for (const s of strings) if (s.weaponId === weapon.id) byAmmo.set(s.ammoTypeId, (byAmmo.get(s.ammoTypeId) ?? 0) + s.rounds)
              return [...byAmmo.entries()].map(([aid, rounds]) => {
                const t = typeForId(aid)
                return <span key={aid} className="text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-700">{t?.name ?? `Type #${aid}`} · {rounds} RDS</span>
              })
            })()}
          </div>
        )}
      </div>
      {toast && (
        <div role="status" className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm font-medium text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
          <span>{toast}</span>
        </div>
      )}
      {/* Persistent round status — survives distraction AND refresh (never toast-only).
          "Nothing shot yet" is claimed ONLY when no shot is recorded at all;
          otherwise we show both timestamps and let the user judge. */}
      {loadIsPending ? (
        <div role="status" className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2.5 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
          <span>Round in progress — {remainingTotal} loaded{lastLoadAt ? ` · ${relativeTime(lastLoadAt)}` : ''}{!lastShot ? ' · nothing shot yet' : ` · last shot ${relativeTime(lastShot.occurredAt)}`}</span>
        </div>
      ) : lastShot && (
        <div role="status" className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm font-medium text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
          <span>Last: shot {lastShot.rounds} RDS · {relativeTime(lastShot.occurredAt)}{remainingTotal > 0 ? ` · ${remainingTotal} still loaded` : ''}</span>
        </div>
      )}
      <div className="mt-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3">
        <div className="mb-3">
          {inventoryItems.length > 1 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {inventoryItems.map(it => {
                const t = typeForId(it.ammoTypeId)
                const sel = it.ammoTypeId === selectedTypeId
                return (
                  <button type="button" key={it.ammoTypeId}
                    onClick={() => { setAmmoTypeId(it.ammoTypeId); setRounds(0) }}
                    className={`px-3 py-1.5 rounded-full border text-sm cursor-pointer ${sel ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800'}`}>
                    {t?.name ?? `Type #${it.ammoTypeId}`} · {it.rounds}
                  </button>
                )
              })}
            </div>
          ) : inventoryItems.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">{stage === 'load' ? 'No matching ammo in the bag.' : 'Nothing loaded.'}</p>
          ) : null}
        </div>
        {stage === 'shoot' && (() => {
          const active = typeForId(selectedTypeId)
          return active ? (
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">Ammo</span>
              <span className="text-xs bg-black text-white px-3 py-1 rounded-full font-medium">{active.name}</span>
            </div>
          ) : null
        })()}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-center dark:border-amber-700 dark:bg-amber-950">
            <p className="text-xs font-semibold tracking-wide text-amber-800 dark:text-amber-200 uppercase">{stage === 'load' ? 'In Bag' : 'Loaded'}</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{stage === 'load' ? inBag.toLocaleString() : loadedForAmmo.toLocaleString()}<span className="text-xs font-bold ml-1">RDS</span></p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-center dark:border-red-800 dark:bg-red-950">
            <p className="text-xs font-semibold tracking-wide text-red-700 dark:text-red-300 uppercase">Fired</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{firedForAmmo.toLocaleString()}<span className="text-xs font-bold ml-1">RDS</span></p>
          </div>
        </div>
      </div>

      {stage === 'load' ? (
        <>
          <div className="flex items-center justify-center gap-4 mt-4">
            <button type="button" onClick={() => step(-1)} disabled={rounds <= 0}
              className="w-12 h-12 flex items-center justify-center border rounded-xl text-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">−</button>
            <QtyInput value={rounds} onCommit={setRoundsClamped}
              className="w-24 text-center text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100 border-0 focus:outline-none bg-transparent" />
            <button type="button" onClick={() => step(1)} disabled={rounds >= cap}
              className="w-12 h-12 flex items-center justify-center border rounded-xl text-xl hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">+</button>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-3">
            {[5, 10, 50].map(n => (
              <button type="button" key={n} onClick={() => setRoundsClamped(rounds + n)} disabled={rounds + n > cap}
                className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">+{n}</button>
            ))}
            {cap > 0 && (
              <button type="button" onClick={() => setRoundsClamped(cap)}
                className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">All</button>
            )}
          </div>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          <button type="button" onClick={() => act('load')}
            disabled={rounds === 0 || inBag === 0}
            className="w-full mt-4 py-4 bg-black text-white rounded-xl text-base font-semibold hover:opacity-80 cursor-pointer disabled:opacity-40">Load {rounds > 0 ? `${rounds}` : ''}</button>
          {lastLoad && (
            <button type="button" onClick={async () => {
              const err = await onAction('load', weapon.id, lastLoad.ammoTypeId, lastLoad.quantity, '')
              if (err) { setError(err); return }
              setStage('shoot')
              setToast(`Loaded ${lastLoad.quantity} RDS`)
              setTimeout(() => setToast(null), 2200)
            }} disabled={!canRedo}
              aria-label={`Repeat last load: ${lastLoad.quantity} rounds${redoAmmo ? ` of ${redoAmmo.name}` : ''}`}
              className="w-full mt-2 min-h-[48px] py-3 bg-amber-100 dark:bg-amber-950 border-2 border-amber-400 dark:border-amber-600 rounded-xl text-base font-semibold text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-900 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 01-4 4H3" /></svg>
              <span>Repeat: {lastLoad.quantity} RDS{redoAmmo ? ` · ${redoAmmo.name}` : ''}</span>
            </button>
          )}

        </>
      ) : (
        <>
          <div className="flex mt-4 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700">
            <button type="button" onClick={() => act('shoot', true)}
              disabled={loadedForAmmo === 0}
              className="flex-1 py-5 bg-red-600 text-white text-lg font-bold hover:bg-red-700 cursor-pointer disabled:opacity-40 flex items-center justify-center">
              Shoot All — {loadedForAmmo.toLocaleString()} RDS
            </button>
            <button type="button" onClick={() => setShowPartial(v => !v)} aria-label="Partial shoot options"
              className="w-12 bg-red-700 hover:bg-red-800 text-white flex items-center justify-center border-l border-red-800 cursor-pointer shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showPartial ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          {showPartial && (
            <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3">
              <div className="flex items-center justify-center gap-4">
                <button type="button" onClick={() => step(-1)} disabled={rounds <= 0}
                  className="w-10 h-10 flex items-center justify-center border bg-white dark:bg-neutral-900 rounded-lg text-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">−</button>
                <QtyInput value={rounds} onCommit={setRoundsClamped}
                  className="w-20 text-center text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100 border-0 bg-transparent focus:outline-none" />
                <button type="button" onClick={() => step(1)} disabled={rounds >= cap}
                  className="w-10 h-10 flex items-center justify-center border bg-white dark:bg-neutral-900 rounded-lg text-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">+</button>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {[5, 10].map(n => (
                  <button type="button" key={n} onClick={() => setRoundsClamped(rounds + n)} disabled={rounds + n > cap}
                    className="px-3 py-1.5 border bg-white dark:bg-neutral-900 rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40">+{n}</button>
                ))}
                <button type="button" onClick={() => setRoundsClamped(cap)}
                  className="px-3 py-1.5 border bg-white dark:bg-neutral-900 rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">All</button>
              </div>
              <input type="text" placeholder="Note for this string (optional)" value={note}
                onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-full mt-3 bg-white dark:bg-neutral-900" />
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => act('shoot')}
                  disabled={rounds === 0 || loadedForAmmo === 0}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl text-base font-bold hover:bg-red-700 cursor-pointer disabled:opacity-40">Shoot {rounds > 0 ? `${rounds} RDS` : ''}</button>
                <button type="button" onClick={endRound}
                  className="px-4 py-3 border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 rounded-xl text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">End Round</button>
              </div>
            </div>
          )}
          {!showPartial && (
            <button type="button" onClick={endRound}
              className="w-full mt-3 py-3 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">End Round — return {remainingTotal} to bag</button>
          )}
        </>
      )}
    </div>
    {showEndDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 max-w-sm w-full">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">End round?</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">You have <span className="font-semibold">{remainingTotal}</span> round(s) still in {weapon.name}. Return them to your bag?</p>
          {remainingEntries.length > 0 && (
            <ul className="mt-3 space-y-1">
              {remainingEntries.map(g => {
                const t = typeForId(g.ammoTypeId)
                return <li key={g.ammoTypeId} className="text-sm text-neutral-600 dark:text-neutral-400 flex justify-between"><span>{t?.name ?? `Type #${g.ammoTypeId}`}</span><span className="font-medium">{g.rounds}</span></li>
              })}
            </ul>
          )}
          {firedTotal > 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-3">You've fired {firedTotal} round(s) so far this session.</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowEndDialog(false)} className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Cancel</button>
            <button type="button" onClick={confirmEndRound} className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Return to bag</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}



function QuickAdd({ rounds, cap, onChange, onStep, onMax, steps = [5, 10, 30], step = 1, inline = false }: {
  rounds: number
  cap: number
  onChange: (n: number) => void
  onStep: (d: number) => void
  onMax?: () => void
  steps?: number[]
  step?: number
  inline?: boolean
}) {
  const chip = "px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
  const stepBtn = "w-9 h-9 border rounded-lg text-lg leading-none hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
  if (inline) {
    return (
      <div className="flex flex-col gap-1.5 items-end sm:flex-row sm:items-center sm:gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => onStep(-step)} disabled={rounds <= 0} className={stepBtn} aria-label="Decrease">−</button>
          <QtyInput value={rounds} onCommit={onChange} />
          <button type="button" onClick={() => onStep(step)} disabled={rounds >= cap} className={stepBtn} aria-label="Increase">+</button>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {steps.map(n => (
            <button type="button" key={n} onClick={() => onChange(rounds + n)} disabled={rounds + n > cap} className={chip}>+{n}</button>
          ))}
          {onMax && (
            <button type="button" onClick={onMax} disabled={cap === 0} className={chip}>All</button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {steps.map(n => (
          <button type="button" key={n} onClick={() => onChange(rounds + n)} disabled={rounds + n > cap}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+{n}</button>
        ))}
        {onMax && (
          <button type="button" onClick={onMax} disabled={cap === 0}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">All</button>
        )}
      </div>
      <div className="flex items-center gap-1 mt-2">
        <button type="button" onClick={() => onStep(-step)} disabled={rounds <= 0}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
        <QtyInput value={rounds} onCommit={onChange} />
        <button type="button" onClick={() => onStep(step)} disabled={rounds >= cap}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+</button>
      </div>
      {rounds === 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">No rounds selected</p>}
    </div>
  )
}

// Quantity field with deferred commit: typing only edits local text and
// commits on blur/Enter, so clearing the field to retype never deletes the
// row out from under you. Empty/invalid reverts to the last value.
function QtyInput({ value, onCommit, className }: { value: number; onCommit: (n: number) => void; className?: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { setText(null) }, [value])
  const commit = (raw: string) => {
    setText(null)
    const trimmed = raw.trim()
    if (trimmed === '') return
    const n = Math.floor(Number(trimmed))
    if (!Number.isFinite(n) || n < 0) return
    onCommit(n)
  }
  return (
    <input
      type="text" inputMode="numeric" pattern="[0-9]*"
      value={text ?? String(value)}
      onChange={e => setText(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={className ?? 'w-20 px-2 py-2 border rounded-lg text-base text-center tabular-nums'}
    />
  )
}

function AddAmmoModal({ ammoTypes, caption, onSubmit, onClose, allowNew = true }: {
  ammoTypes: AmmoType[]
  caption: string
  onSubmit: (rows: AddAmmoRow[], note: string) => void
  onClose: () => void
  allowNew?: boolean
}) {
  const [qty, setQty] = useState<Record<number, string>>({})
  const [price, setPrice] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newTypes, setNewTypes] = useState<Extract<AddAmmoRow, { kind: 'new' }>[]>([])
  const [draft, setDraft] = useState({ name: '', caliber: '', brand: '', grain: '', quantity: '', price: '' })

  const existingRows: AddAmmoRow[] = ammoTypes
    .map(t => ({ kind: 'existing' as const, ammoTypeId: t.id, quantity: Number(qty[t.id] || 0), price: price[t.id] ?? '' }))
    .filter(r => r.quantity > 0)

  const submit = () => {
    const rows = [...existingRows, ...newTypes.filter(r => r.quantity > 0)]
    if (rows.length === 0) return
    onSubmit(rows, note)
  }

  const addNewType = () => {
    const quantity = Number(draft.quantity) || 0
    if (!draft.name || !draft.caliber || quantity <= 0) return
    setNewTypes(prev => [...prev, {
      kind: 'new', name: draft.name, caliber: draft.caliber,
      brand: draft.brand, grain: draft.grain, quantity, price: draft.price,
    }])
    setDraft({ name: '', caliber: '', brand: '', grain: '', quantity: '', price: '' })
    setShowNew(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6 max-w-sm w-full">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Add Ammo</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{caption}</p>

        <div className="mt-4 space-y-2.5 max-h-80 overflow-y-auto">
          {ammoTypes.map(t => (
            <div key={t.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-medium text-sm truncate">{t.name}</p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">{t.caliber}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">Rounds</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={qty[t.id] ?? ''} placeholder="1000"
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
                      setQty(prev => ({ ...prev, [t.id]: v }))
                    }}
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-base tabular-nums" />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">Total cost</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 text-base pointer-events-none">$</span>
                    <input type="text" inputMode="decimal" value={price[t.id] ?? ''} placeholder="0.00"
                      onChange={e => {
                        let v = e.target.value.replace(/[^0-9.]/g, '')
                        const p = v.split('.')
                        if (p.length > 2) v = p[0] + '.' + p.slice(1).join('')
                        if (p[1]?.length > 2) v = p[0] + '.' + p[1].slice(0, 2)
                        setPrice(prev => ({ ...prev, [t.id]: v }))
                      }}
                      className="w-full pl-7 pr-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-base tabular-nums" />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {newTypes.length > 0 && (
            <div className="pt-1 space-y-1">
              {newTypes.map((nt, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-neutral-50 dark:bg-neutral-800 rounded-lg px-3 py-2">
                  <span className="font-medium">{nt.name} <span className="text-neutral-400 dark:text-neutral-500 font-normal">· {nt.caliber}</span></span>
                  <span className="text-neutral-500 dark:text-neutral-400">{nt.quantity} · {nt.price ? `$${Number(nt.price).toFixed(2)}` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showNew && (
          <div className="mt-3 border rounded-lg p-3 space-y-2">
            <input placeholder="Name" value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className="px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm w-full" />
            <div className="flex gap-2">
              <CaliberSelect value={draft.caliber} onChange={v => setDraft(d => ({ ...d, caliber: v }))} />
              <input placeholder="Brand" value={draft.brand}
                onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))} className="px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm w-24" />
            </div>
            <div className="flex gap-2">
              <input placeholder="Grain" value={draft.grain}
                onChange={e => setDraft(d => ({ ...d, grain: e.target.value.replace(/\D/g, '') }))} className="px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm w-20" />
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Qty" value={draft.quantity}
                onChange={e => setDraft(d => ({ ...d, quantity: e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '') }))} className="px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm w-20" />
              <div className="relative w-20">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 text-sm pointer-events-none">$</span>
                <input type="text" inputMode="decimal" placeholder="0.00" value={draft.price}
                  onChange={e => {
                    let v = e.target.value.replace(/[^0-9.]/g, '')
                    const p = v.split('.')
                    if (p.length > 2) v = p[0] + '.' + p.slice(1).join('')
                    if (p[1]?.length > 2) v = p[0] + '.' + p[1].slice(0, 2)
                    setDraft(d => ({ ...d, price: v }))
                  }} className="w-full pl-5 pr-2 py-2 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addNewType}
                className="flex-1 px-2 py-1.5 bg-black text-white rounded-lg text-sm cursor-pointer hover:opacity-80">Add</button>
              <button type="button" onClick={() => setShowNew(false)}
                className="px-2 py-1.5 border rounded-lg text-sm cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
            </div>
          </div>
        )}
        {allowNew && !showNew && (
          <button type="button" onClick={() => setShowNew(true)}
            className="text-sm text-neutral-600 dark:text-neutral-400 mt-3 cursor-pointer hover:text-neutral-900 dark:text-neutral-100">+ Add a new ammo type</button>
        )}

        <input type="text" placeholder="Note (optional)" value={note}
          onChange={e => setNote(e.target.value)} className="px-4 py-2.5 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm w-full mt-4" />

        {ammoTypes.length === 1 && (() => {
          const t = ammoTypes[0]
          const q = Number(qty[t.id] ?? 0)
          const c = Number(price[t.id] ?? NaN)
          if (!(q > 0) || !Number.isFinite(c) || c < 0) return null
          const ppr = c / q
          return (
            <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-4 text-center">
              <p className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{ppr < 1 ? `${(ppr * 100).toFixed(1)}¢ per round` : `$${ppr.toFixed(2)} per round`}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums mt-1">{q.toLocaleString()} rds · ${c.toFixed(2)} total</p>
            </div>
          )
        })()}

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose}
            className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Cancel</button>
          <button type="button" onClick={submit}
            className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Add</button>
        </div>
      </div>
    </div>
  )
}

// Full-card empty state for a gun with nothing left (0 loaded + 0 in bag for
// its caliber). Rendered INSTEAD of the firing card — a state, not a modal —
// so it shows once and never nags. Offers the next gun with ammo in one tap.
function OutOfAmmoCard({ weapon, firedTotal, lastShotAt, next, onNext, onBuyMore }: {
  weapon: Weapon
  firedTotal: number
  lastShotAt: string | null
  next: { weapon: Weapon; readyRounds: number } | null
  onNext: () => void
  onBuyMore: () => void
}) {
  return (
    <div className="rounded-xl border-2 border-red-200 dark:border-red-800 bg-white dark:bg-neutral-900 p-4 flex flex-col">
      <div className="rounded-xl bg-red-50 dark:bg-red-950 px-6 py-5 text-center">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{weapon.name}</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-xs bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full">{weapon.caliber}</span>
          <span className="text-xs bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full capitalize">{weapon.type}</span>
        </div>
        <p className="text-2xl font-bold text-red-600 mt-3">Out of ammo</p>
        <p className="text-xs text-red-500 mt-1">0 loaded · 0 in bag for {weapon.caliber}</p>
        {firedTotal > 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Fired {firedTotal.toLocaleString()} RDS this session{lastShotAt ? ` · last ${relativeTime(lastShotAt)}` : ''}
          </p>
        )}
      </div>
      {next ? (
        <button type="button" onClick={onNext}
          className="w-full mt-4 min-h-[56px] py-4 bg-black text-white rounded-xl text-base font-semibold hover:opacity-80 cursor-pointer flex items-center justify-center gap-2">
          <span>Next: {next.weapon.name} · {next.readyRounds} RDS ready</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
        </button>
      ) : (
        <>
          <div className="mt-4 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2.5 text-sm text-center text-neutral-600 dark:text-neutral-300">
            All guns are out of ammo.
          </div>
          <button type="button" onClick={onBuyMore}
            className="w-full mt-2 min-h-[48px] py-3 bg-black text-white rounded-xl text-base font-semibold hover:opacity-80 cursor-pointer">
            + Buy More Ammo
          </button>
        </>
      )}
    </div>
  )
}

function RangeDayView({ session: initialSession, ammoTypes: initialAmmoTypes, onSessionEnd, onBack }: {
  session: RangeDaySession
  ammoTypes: AmmoType[]
  onSessionEnd: () => void
  onBack: () => void
}) {
  const [session, setSession] = useState(initialSession)
  const [bag, setBag] = useState<BagItem[]>(initialSession.bag ?? [])
  const [weapons, setWeapons] = useState<Weapon[]>(initialSession.weapons ?? [])
  const [gunLoaded, setGunLoaded] = useState<GunLoaded[]>(initialSession.gunLoaded ?? [])
  const [strings, setStrings] = useState<RangeDayString[]>(initialSession.strings ?? [])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>(initialAmmoTypes)

  const [showEndModal, setShowEndModal] = useState(false)
  const [completeData, setCompleteData] = useState<{ endedAt: string; totals: Record<number, number> } | null>(null)
  const [showAcquire, setShowAcquire] = useState(false)
  const [bagOpen, setBagOpen] = useState(false)
  const [activeWeaponId, setActiveWeaponId] = useState<number | null>(null)
  // Redo-last memory, persisted per session so a refresh doesn't lose it.
  // Validated on read; cleared on End Range Day so revisits don't offer stale repeats.
  const lastLoadKey = `ay-armory-last-load:${initialSession.id}`
  const [lastLoadByWeapon, setLastLoadByWeapon] = useState<Record<number, { ammoTypeId: number; quantity: number }>>(() => {
    try {
      const raw = localStorage.getItem(lastLoadKey)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const clean: Record<number, { ammoTypeId: number; quantity: number }> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const id = Number(k)
        if (!Number.isFinite(id)) continue
        if (!v || typeof v !== 'object') continue
        const { ammoTypeId, quantity } = v as { ammoTypeId?: unknown; quantity?: unknown }
        if (typeof ammoTypeId !== 'number' || !Number.isFinite(ammoTypeId)) continue
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) continue
        clean[id] = { ammoTypeId, quantity }
      }
      return clean
    } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem(lastLoadKey, JSON.stringify(lastLoadByWeapon)) } catch { /* ignore */ }
  }, [lastLoadKey, lastLoadByWeapon])
  // Live clock for "Xm ago" labels (display-only, see useNow).
  useNow(30000)
  const sessionFiredTotal = strings.reduce((s, x) => s + x.rounds, 0)
  const sessionLastShot = strings.length
    ? strings.reduce((a, b) => (new Date(a.occurredAt) > new Date(b.occurredAt) ? a : b))
    : null
  const bagTotal = bag.reduce((s, b) => s + b.inBag, 0)

  useEffect(() => {
    let cancelled = false
    apiFetch('/ammo/types')
      .then(r => (r.ok ? r.json() : Promise.resolve([] as AmmoType[])))
      .then((data: AmmoType[]) => { if (!cancelled) setAmmoTypes(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const typeForId = (id: number) => ammoTypes.find(t => t.id === id)
  const weaponForId = (id: number) => weapons.find(w => w.id === id)

  // Each weapon card owns its own form, so the weapon is implicit here.
  const doAction = async (
    action: 'load' | 'shoot' | 'return',
    weaponId: number,
    ammoTypeId: number,
    rounds: number,
    note: string,
  ): Promise<string | null> => {
    const res = await apiFetch(`/ammo/range-days/${session.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        weaponId, ammoTypeId, rounds,
        ...(action === 'shoot' && note ? { note } : {}),
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({ error: 'Error' }))
      return d.error || 'Error'
    }
    const data = await res.json()
    setBag(data.bag ?? [])
    setGunLoaded(data.gunLoaded ?? [])
    if (action === 'shoot' && data.string) setStrings(prev => [...prev, data.string])
    if (action === 'return') setStrings(prev => [...prev, ...(data.strings ?? [])])
    return null
  }

  const deleteString = async (id: number) => {
    const res = await apiFetch(`/ammo/range-days/${session.id}/strings/${id}`, { method: 'DELETE' })
    if (res.ok) {
      const data = await res.json()
      setBag(data.bag ?? [])
      setGunLoaded(data.gunLoaded ?? [])
      setStrings(data.strings ?? [])
    }
  }

  const handleAddAmmo = async (rows: AddAmmoRow[], note: string) => {
    for (const r of rows) {
      let ammoTypeId: number
      if (r.kind === 'existing') {
        ammoTypeId = r.ammoTypeId
      } else {
        const res = await apiFetch('/ammo/types', {
          method: 'POST',
          body: JSON.stringify({
            name: r.name,
            caliber: r.caliber,
            ...(r.brand ? { brand: r.brand } : {}),
            ...(r.grain ? { grain: Number(r.grain) } : {}),
          }),
        })
        if (!res.ok) continue
        const t = await res.json()
        ammoTypeId = t.id
        setAmmoTypes(prev => [...prev, t])
      }
      const acqRes = await apiFetch(`/ammo/range-days/${session.id}/acquire`, {
        method: 'POST',
        body: JSON.stringify({
          ammo: [{ ammoTypeId, quantity: r.quantity }],
          note: note || null,
          ...(r.price ? { price: Math.round(Number(r.price) * 100) } : {}),
        }),
      })
      if (acqRes.ok) {
        const data = await acqRes.json().catch(() => null)
        if (data?.bag) setBag(data.bag)
      }
    }
    const res = await apiFetch(`/ammo/range-days/${session.id}`)
    if (res.ok) {
      const d = await res.json()
      setBag(d.bag ?? [])
    }
    setShowAcquire(false)
  }

  const handleEnd = async () => {
    const res = await apiFetch(`/ammo/range-days/${session.id}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!res.ok) { alert('Error ending session'); return }
    const body = await res.json().catch(() => null)
    const endedAt: string = body?.session?.endedAt ?? new Date().toISOString()
    let totals: Record<number, number> = {}
    try {
      const r = await apiFetch('/weapons/firing-summary')
      if (r.ok) {
        const arr: { weaponId: number; totalRounds: number }[] = await r.json()
        for (const t of arr) totals[t.weaponId] = t.totalRounds
      }
    } catch { /* summary shows today-only without lifetime */ }
    try { localStorage.removeItem(lastLoadKey) } catch { /* ignore */ }
    setShowEndModal(false)
    setCompleteData({ endedAt, totals })
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {showEndModal && (
        <ConfirmEndModal bag={bag} strings={strings} weapons={weapons} ammoTypes={ammoTypes}
          onConfirm={handleEnd} onCancel={() => setShowEndModal(false)} />
      )}

      {completeData && (
        <DayCompleteSheet
          note={session.note}
          startedAt={session.startedAt}
          endedAt={completeData.endedAt}
          strings={strings}
          weapons={weapons}
          ammoTypes={ammoTypes}
          bag={bag}
          totals={completeData.totals}
          onDone={onSessionEnd}
        />
      )}

      {showAcquire && (
        <AddAmmoModal ammoTypes={ammoTypes}
          caption="Adds to your inventory and this range day's bag."
          onSubmit={handleAddAmmo} onClose={() => setShowAcquire(false)} />
      )}

      <header className="border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
        <div className="mx-auto max-w-4xl flex items-center justify-between px-6 min-h-16 py-2">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={onBack} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer">← Back</button>
            <h1 className="text-lg font-bold tracking-tight">Range Day</h1>
            {session.note && <span className="text-neutral-500 dark:text-neutral-400 text-sm">· {session.note}</span>}
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">Active</span>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold border border-neutral-300 dark:border-neutral-600 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200" title="Rounds still in the bag">
              🎒 {bagTotal.toLocaleString()} in bag
            </span>
            {sessionFiredTotal > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-bold border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300" title="Rounds fired this session">
                {sessionFiredTotal.toLocaleString()} fired{sessionLastShot ? ` · last ${relativeTime(sessionLastShot.occurredAt)}` : ''}
              </span>
            )}
          </div>
          <button onClick={() => setShowEndModal(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 cursor-pointer shrink-0">
            End Range Day
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Per-weapon Load / Shoot / Return — single active focus */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Weapons</h2>
          {weapons.length === 0 ? (
            <p className="text-neutral-400 dark:text-neutral-500 text-sm">No weapons selected for this range day.</p>
          ) : (
            (() => {
              const ordered = [...weapons].sort((a, b) => {
                if (a.id === activeWeaponId) return -1
                if (b.id === activeWeaponId) return 1
                return 0
              })
              const activeId = activeWeaponId ?? ordered[0]?.id ?? null
              const ammoFor = (ww: Weapon) => {
                const loaded = gunLoaded.filter(g => g.weaponId === ww.id).reduce((s, g) => s + g.rounds, 0)
                const inBag = bag.filter(b => {
                  const t = typeForId(b.ammoTypeId)
                  return !!t && t.caliber === ww.caliber
                }).reduce((s, b) => s + b.inBag, 0)
                return { loaded, inBag, total: loaded + inBag }
              }
              // Next gun with ammo after the active one (wraps around).
              const activeIdx = Math.max(0, ordered.findIndex(w => w.id === activeId))
              let nextWithAmmo: { weapon: Weapon; readyRounds: number } | null = null
              for (let i = 1; i <= ordered.length; i++) {
                const cand = ordered[(activeIdx + i) % ordered.length]
                if (cand.id === activeId) continue
                const a = ammoFor(cand)
                if (a.total > 0) { nextWithAmmo = { weapon: cand, readyRounds: a.total }; break }
              }
              return (
                <div className="flex flex-col gap-3">
                  {ordered.map(w => {
                    const isActive = w.id === activeId
                    const loadedForW = gunLoaded.filter(g => g.weaponId === w.id).reduce((s, g) => s + g.rounds, 0)
                    const hasBagForCaliber = bag.some(b => {
                      const t = typeForId(b.ammoTypeId)
                      return !!t && t.caliber === w.caliber && b.inBag > 0
                    })
                    const isOut = loadedForW === 0 && !hasBagForCaliber
                    const isLoaded = loadedForW > 0
                    const wStrings = strings.filter(s => s.weaponId === w.id)
                    const wFired = wStrings.reduce((s, x) => s + x.rounds, 0)
                    const wLastShotAt = wStrings.length
                      ? wStrings.reduce((a, b) => (new Date(a.occurredAt) > new Date(b.occurredAt) ? a : b)).occurredAt
                      : null
                    return (
                      <div key={w.id} onClick={() => !isActive && setActiveWeaponId(w.id)}
                        role={!isActive ? 'button' : undefined} tabIndex={!isActive ? 0 : undefined}
                        aria-label={!isActive ? `Switch to ${w.name}` : undefined}
                        onKeyDown={!isActive ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveWeaponId(w.id) } }) : undefined}
                        className={isActive ? '' : 'cursor-pointer'}>
                        {isActive ? (
                          isOut ? (
                            <OutOfAmmoCard weapon={w} firedTotal={wFired} lastShotAt={wLastShotAt}
                              next={nextWithAmmo} onNext={() => nextWithAmmo && setActiveWeaponId(nextWithAmmo.weapon.id)}
                              onBuyMore={() => setShowAcquire(true)} />
                          ) : (
                            <WeaponRangeCard weapon={w} bag={bag} ammoTypes={ammoTypes} gunLoaded={gunLoaded} strings={strings} onAction={doAction} typeForId={typeForId} lastLoad={lastLoadByWeapon[w.id] ?? null} onSetLastLoad={v => setLastLoadByWeapon(m => { const n = { ...m }; if (v) n[w.id] = v; else delete n[w.id]; return n })} />
                          )
                        ) : (
                          <div className={`rounded-xl border p-3 flex items-center justify-between ${isOut ? 'border-red-200 bg-red-50 opacity-100 dark:border-red-800 dark:bg-red-950' : isLoaded ? 'border-amber-300 bg-amber-50 opacity-100 dark:border-amber-700 dark:bg-amber-950' : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 opacity-60 hover:opacity-100'}`}>
                            <div>
                              <p className={`text-sm font-semibold ${isOut ? 'text-red-700 dark:text-red-300' : isLoaded ? 'text-amber-800 dark:text-amber-200' : 'text-neutral-900 dark:text-neutral-100'}`}>{w.name}</p>
                              <p className={`text-xs ${isOut ? 'text-red-500 dark:text-red-400' : isLoaded ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500 dark:text-neutral-400'}`}>{w.caliber} · {w.type}{isOut ? ' · Out of ammo' : isLoaded ? ' · Loaded' : ''}</p>
                            </div>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${isOut ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-800' : isLoaded ? 'bg-amber-500 text-white border-amber-500' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700'}`}>{isOut ? 'Out' : `${loadedForW} RDS`}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()
          )}
        </section>

        {/* Shooting strings — directly under the firing view; shows the last round first */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Shooting Log{sessionFiredTotal > 0 ? ` — ${sessionFiredTotal.toLocaleString()} RDS this session` : ''}</h2>
          {strings.length === 0 ? (
            <p className="text-neutral-400 dark:text-neutral-500 text-sm">No shots recorded yet.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
              {strings.slice().reverse().map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {weaponForId(s.weaponId)?.name ?? `Weapon #${s.weaponId}`}
                      <span className="text-neutral-400 dark:text-neutral-500 font-normal"> · {typeForId(s.ammoTypeId)?.name ?? `Type #${s.ammoTypeId}`}</span>
                    </p>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      {s.rounds} rounds · {relativeTime(s.occurredAt)}
                      {s.note ? ` · ${s.note}` : ''}
                    </p>
                  </div>
                  <button onClick={() => deleteString(s.id)}
                    className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-500 cursor-pointer">Delete</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Bag collapsed out of the firing view — full table one tap away */}
        <section>
          <details onToggle={e => setBagOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="flex items-center justify-between cursor-pointer">
              <span className="text-lg font-semibold">🎒 Bag — {bagTotal.toLocaleString()} RDS</span>
              <span className="text-sm text-neutral-500 dark:text-neutral-400 underline">{bagOpen ? 'Hide contents' : 'Show contents'}</span>
            </summary>
            <div className="flex items-center justify-end mt-3 mb-3">
              <button onClick={() => setShowAcquire(true)}
                className="text-sm px-3 py-1.5 bg-black text-white rounded-lg hover:opacity-80 cursor-pointer">+ Buy More Ammo</button>
            </div>
            {bag.length === 0 ? (
              <p className="text-neutral-400 dark:text-neutral-500 text-sm">No ammo in bag.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700 text-left text-neutral-500 dark:text-neutral-400">
                      <th className="px-4 py-3">Ammo Type</th>
                      <th className="px-4 py-3">Caliber</th>
                      <th className="px-4 py-3 text-right">Taken</th>
                      <th className="px-4 py-3 text-right">Acquired</th>
                      <th className="px-4 py-3 text-right font-semibold text-neutral-700 dark:text-neutral-300">In Bag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bag.map(b => {
                      const type = typeForId(b.ammoTypeId)
                      return (
                        <tr key={b.ammoTypeId} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                          <td className="px-4 py-3 font-medium">{type?.name ?? `Type #${b.ammoTypeId}`}</td>
                          <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{type?.caliber ?? '—'}</td>
                          <td className="px-4 py-3 text-right text-neutral-600 dark:text-neutral-400">{b.taken}</td>
                          <td className="px-4 py-3 text-right text-neutral-600 dark:text-neutral-400">{b.acquired}</td>
                          <td className={`px-4 py-3 text-right font-bold ${balanceColor(b.inBag)}`}>{b.inBag}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </section>
      </main>
    </div>
  )
}

// ── Ammo Type Detail ──────────────────────────────────────────────────────

type EntryRow = { id: number; ammoTypeId: number; quantity: number; location: string; isBalancing: boolean; weaponId?: number | null }
type TxWithEntries = Omit<Transaction, 'entries'> & { entries: EntryRow[] }

function AmmoTypeDetailView({ item, onBack, refreshKey = 0, onWeaponClick, onChanged }: { item: InventoryItem; onBack: () => void; refreshKey?: number; onWeaponClick?: (weaponId: number) => void; onChanged?: () => void }) {
  const [transactions, setTransactions] = useState<TxWithEntries[]>([])
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSessions, setExpandedSessions] = useState<number[] | null>(null)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/ammo/types/${item.id}/transactions`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false))
  }, [item.id, refreshKey])

  useEffect(() => {
    apiFetch('/weapons')
      .then(r => r.ok ? r.json() : [])
      .then(setWeapons)
      .catch(() => {})
  }, [])

  // Net change per transaction = sum of ALL non-balancing entries for this ammo type.
  // Equity (balancing) entries are excluded — they're accounting artefacts, not real rounds.
  // This gives the true real-world impact per transaction:
  //   acquisition  → +500   (rounds gained)
  //   expenditure  → -100   (rounds consumed)
  //   range_start  →    0   (moved storage→bag, nothing gained/lost overall)
  //   range_end    →  -50   (net rounds consumed at the range)
  //   on-site buy  → +200   (rounds added to bag, never hit storage)
  //   adjustment   →  ±X
  function netChange(tx: TxWithEntries): number {
    return tx.entries
      .filter(e => !e.isBalancing && e.ammoTypeId === item.id)
      .reduce((sum, e) => sum + e.quantity, 0)
  }

  // Sort oldest→newest to compute running balance, then reverse for display
  const rows = useMemo(() => {
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    )
    let running = 0
    const withBalance = sorted.map(tx => {
      const net = netChange(tx)
      running += net
      return { tx, net, runningBalance: running }
    })
    return withBalance.reverse()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions])

  // Group range-day transactions (start → shots → end) into collapsible
  // session blocks, newest first; standalone transactions stay flat.
  const blocks = useHistoryBlocks(rows)
  const [historyFilter, setHistoryFilter] = useState<NetClass | 'all'>('all')
  const [showBuy, setShowBuy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<AmmoType>>({})
  const [editError, setEditError] = useState('')
  const saveEdit = async () => {
    setEditError('')
    const res = await apiFetch(`/ammo/types/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify(editData),
    })
    if (!res.ok) {
      try { const d = await res.json(); setEditError(d.error || 'Error') } catch { setEditError('Error') }
      return
    }
    setEditing(false)
    onChanged?.()
  }
  const handleBuy = async (rows: AddAmmoRow[], note: string) => {
    for (const r of rows) {
      if (r.kind === 'existing') {
        await apiFetch('/ammo/transactions', {
          method: 'POST',
          body: JSON.stringify({
            type: 'acquisition',
            occurredAt: new Date().toISOString(),
            note: note || null,
            ...(r.price ? { price: Math.round(Number(r.price) * 100) } : {}),
            entries: [{ ammoTypeId: r.ammoTypeId, quantity: r.quantity }],
          }),
        })
      } else {
        const res = await apiFetch('/ammo/types', {
          method: 'POST',
          body: JSON.stringify({
            name: r.name,
            caliber: r.caliber,
            ...(r.brand ? { brand: r.brand } : {}),
            ...(r.grain ? { grain: Number(r.grain) } : {}),
          }),
        })
        if (!res.ok) continue
        const t = await res.json()
        await apiFetch('/ammo/transactions', {
          method: 'POST',
          body: JSON.stringify({
            type: 'acquisition',
            occurredAt: new Date().toISOString(),
            note: note || null,
            ...(r.price ? { price: Math.round(Number(r.price) * 100) } : {}),
            entries: [{ ammoTypeId: t.id, quantity: r.quantity }],
          }),
        })
      }
    }
    setShowBuy(false)
    onChanged?.()
  }

  const historyCounts = useMemo(() => {
    const counts: Record<NetClass | 'all', number> = { all: blocks.length, in: 0, out: 0, flat: 0 }
    for (const b of blocks) counts[classifyNet(b.net)] += 1
    return counts
  }, [blocks])
  const visibleBlocks = historyFilter === 'all' ? blocks : blocks.filter(b => classifyNet(b.net) === historyFilter)

  const defaultExpanded = blocks.find(b => b.kind === 'session')
  const expandedIds = expandedSessions ?? (defaultExpanded && defaultExpanded.kind === 'session' ? [defaultExpanded.sessionId] : [])
  const toggleSession = (sessionId: number) => {
    const base = expandedSessions ?? (defaultExpanded && defaultExpanded.kind === 'session' ? [defaultExpanded.sessionId] : [])
    setExpandedSessions(base.includes(sessionId) ? base.filter(id => id !== sessionId) : [...base, sessionId])
  }

  const sessionMeta = (txs: HistoryRow[]) => {
    const start = txs.find(r => r.tx.type === 'range_day_start')
    const note = start?.tx.note ?? txs.find(r => r.tx.note)?.tx.note ?? 'Range day'
    const oldest = txs[txs.length - 1].tx.occurredAt
    return { note, oldest, balance: txs[0].runningBalance }
  }

  const renderTxRow = ({ tx, net, runningBalance }: HistoryRow) => {
    const shotW = shotWeaponName(tx)
    return (
      <tr key={tx.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
        <td className="px-3 sm:px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
          {new Date(tx.occurredAt).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </td>
        <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
          <TxChip type={tx.type} />
        </td>
        <td className="px-3 sm:px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[200px] truncate">
          {shotW
            ? <span>{shotW}{tx.note ? <span className="text-neutral-400 dark:text-neutral-500"> · {tx.note}</span> : null}</span>
            : (tx.note ?? <span className="text-neutral-300">—</span>)}
        </td>
        <td className="px-3 sm:px-4 py-3 text-right tabular-nums whitespace-nowrap">
          {tx.price != null ? (
            <span className="text-neutral-700 dark:text-neutral-300">
              ${(tx.price / 100).toFixed(2)}
              {net > 0 && <span className="text-neutral-400 dark:text-neutral-500 text-xs ml-1">(${(tx.price / net / 100).toFixed(2)}/rd)</span>}
            </span>
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </td>
        <td className="px-3 sm:px-4 py-3 text-right">
          {netLabel(net, tx)}
        </td>
        <td className="px-3 sm:px-4 py-3 text-right font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
          {runningBalance.toLocaleString()}
        </td>
      </tr>
    )
  }

  const renderSessionNet = (net: number) => net === 0
    ? <span className="text-neutral-400 dark:text-neutral-500 text-sm">—</span>
    : (
      <span className={`font-semibold tabular-nums ${net > 0 ? 'text-green-700' : 'text-red-600'}`}>
        {net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
      </span>
    )

  // Depletion ledger prototype: start (in) → shots (out) → end (back/gone).
  const renderSessionLedger = (sessionId: number, txs: HistoryRow[]) => {
    const chronological = [...txs].reverse()
    const tookIn = chronological
      .filter(r => r.tx.type === 'range_day_start')
      .flatMap(r => r.tx.entries)
      .filter(e => !e.isBalancing && e.ammoTypeId === item.id && e.location === 'bag' && e.quantity > 0)
      .reduce((s, e) => s + e.quantity, 0)
    const shots = chronological.flatMap(r => r.tx.type === 'range_day_shot'
      ? [{ at: r.tx.occurredAt, rounds: r.tx.entries.filter(e => !e.isBalancing && e.ammoTypeId === item.id && e.quantity < 0).reduce((s, e) => s - e.quantity, 0), weapon: shotWeaponName(r.tx), note: r.tx.note }]
      : [])
    const returned = chronological
      .filter(r => r.tx.type === 'range_day_end')
      .flatMap(r => r.tx.entries)
      .filter(e => !e.isBalancing && e.ammoTypeId === item.id && e.location === 'storage' && e.quantity > 0)
      .reduce((s, e) => s + e.quantity, 0)
    return (
      <tr key={`ledger-${sessionId}`}>
        <td colSpan={6} className="px-3 sm:px-4 py-3 bg-neutral-50/60 dark:bg-neutral-800/40">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">IN</span>
            <span className="text-neutral-600 dark:text-neutral-400">took {tookIn.toLocaleString()} to bag</span>
            <span className="ml-auto font-semibold tabular-nums text-green-700">+{tookIn.toLocaleString()}</span>
          </div>
          <div className="mt-2 ml-1 border-l-2 border-neutral-200 dark:border-neutral-700 pl-3">
            <div className="space-y-1">
              {shots.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-800">OUT</span>
                  <span className="text-neutral-600 dark:text-neutral-400 truncate">
                    {s.rounds.toLocaleString()} rds{s.weapon ? ` · ${s.weapon}` : ''}{s.note ? ` · ${s.note}` : ''}
                    <span className="text-neutral-400 dark:text-neutral-500"> · {new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  <span className="ml-auto font-semibold tabular-nums text-red-600">−{s.rounds.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm mt-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-800">BACK</span>
            <span className="text-neutral-600 dark:text-neutral-400">returned {returned.toLocaleString()} · gone {(tookIn - returned).toLocaleString()}</span>
            <span className="ml-auto font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{(tookIn - returned) <= 0 ? '±0' : `−${(tookIn - returned).toLocaleString()}`}</span>
          </div>
        </td>
      </tr>
    )
  }
  const avgPrice = useMemo(() => {
    let totalCents = 0
    let totalRounds = 0
    for (const tx of transactions) {
      if (tx.price == null) continue
      const net = tx.entries.filter(e => !e.isBalancing && e.ammoTypeId === item.id).reduce((s, e) => s + e.quantity, 0)
      if (net > 0) { totalCents += tx.price; totalRounds += net }
    }
    if (totalRounds === 0) return null
    return { perRound: totalCents / totalRounds / 100, totalCents, totalRounds }
  }, [transactions, item.id])

  // Rounds fired per weapon — from range_day_shot entries (exact; end-of-day
  // auto-unloads never carry the range_day_shot type so they can't leak in).
  const byWeapon = useMemo(() => {
    const m = new Map<number, number>()
    for (const tx of transactions) {
      if (tx.type !== 'range_day_shot') continue
      for (const e of tx.entries) {
        if (!e.isBalancing && e.ammoTypeId === item.id && e.weaponId != null && e.quantity < 0) {
          m.set(e.weaponId, (m.get(e.weaponId) ?? 0) + -e.quantity)
        }
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [transactions, item.id])

  const weaponName = (id: number) => weapons.find(w => w.id === id)?.name ?? `Weapon #${id}`

  const shotWeaponName = (tx: TxWithEntries) => {
    if (tx.type !== 'range_day_shot') return null
    const wId = tx.entries.find(e => !e.isBalancing && e.ammoTypeId === item.id && e.weaponId != null)?.weaponId
    return wId != null ? weaponName(wId) : null
  }

  // Rounds fired per week, last 12 weeks.
  const usage = useMemo(() => {
    const now = Date.now()
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      rounds: 0,
      start: now - (11 - i) * 7 * 86400000 - 6 * 86400000,
    }))
    for (const tx of transactions) {
      if (tx.type !== 'range_day_shot') continue
      const rounds = tx.entries
        .filter(e => !e.isBalancing && e.ammoTypeId === item.id && e.weaponId != null && e.quantity < 0)
        .reduce((s, e) => s - e.quantity, 0)
      if (rounds <= 0) continue
      const idx = 11 - Math.floor((now - new Date(tx.occurredAt).getTime()) / (7 * 86400000))
      if (idx >= 0 && idx < 12) buckets[idx].rounds += rounds
    }
    return buckets.map((b, i) => ({
      key: i,
      rounds: b.rounds,
      label: new Date(b.start).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    }))
  }, [transactions, item.id])

  const usageTotal = usage.reduce((s, w) => s + w.rounds, 0)
  // Weekly rounds stacked by firearm (top 3 guns + other) for the usage chart.
  const usageByGun: any = useMemo(() => {
    const tops = byWeapon.slice(0, 3).map(([id]) => id)
    const rows: any[] = usage.map(u => {
      const r: any = { key: u.key, label: u.label, other: 0 }
      for (const t of tops) r[`w${t}`] = 0
      return r
    })
    const now = Date.now()
    for (const tx of transactions) {
      if (tx.type !== 'range_day_shot') continue
      const idx = 11 - Math.floor((now - new Date(tx.occurredAt).getTime()) / (7 * 86400000))
      if (idx < 0 || idx >= 12) continue
      for (const e of tx.entries) {
        if (!e.isBalancing && e.ammoTypeId === item.id && e.weaponId != null && e.quantity < 0) {
          const k = tops.includes(e.weaponId) ? `w${e.weaponId}` : 'other'
          rows[idx][k] += -e.quantity
        }
      }
    }
    const totals = new Map<number, number>(byWeapon)
    const series: any[] = tops.map((id, i) => ({ key: `w${id}`, weaponId: id, name: weaponName(id), color: GUN_COLORS[i % GUN_COLORS.length], rounds: totals.get(id) ?? 0 }))
    const otherTotal = rows.reduce((s: number, r: any) => s + r.other, 0)
    if (otherTotal > 0) series.push({ key: 'other', weaponId: null, name: 'Other', color: '#71717a', rounds: otherTotal })
    return { rows, series, tops }
  }, [transactions, item.id, usage, byWeapon])
  const totalFired = byWeapon.reduce((s, [, r]) => s + r, 0)

  const totalBought = useMemo(() => {
    let sum = 0
    for (const tx of transactions) {
      if (tx.type !== 'acquisition') continue
      const net = tx.entries.filter(e => !e.isBalancing && e.ammoTypeId === item.id).reduce((s, e) => s + e.quantity, 0)
      if (net > 0) sum += net
    }
    return sum
  }, [transactions, item.id])

  function netLabel(net: number, tx: TxWithEntries): React.ReactNode {
    if (net === 0) {
      // range_day_start moves rounds between locations — show how many moved
      if (tx.type === 'range_day_start') {
        const bagEntry = tx.entries
          .find(e => e.location === 'bag' && !e.isBalancing && e.ammoTypeId === item.id)
        const took = bagEntry ? Math.abs(bagEntry.quantity) : 0
        return <span className="text-neutral-400 dark:text-neutral-500 text-sm italic">moved {took} to bag</span>
      }
      return <span className="text-neutral-400 dark:text-neutral-500 text-sm">—</span>
    }
    return (
      <span className={`font-semibold tabular-nums ${net > 0 ? 'text-green-700' : 'text-red-600'}`}>
        {net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
      </span>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer transition-colors"
        >
          ← Inventory
        </button>
      </div>

      {/* Hero — identity + lifetime */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mt-4">
        {editing ? (
          <div className="flex flex-col gap-2">
            {editError && <p className="text-red-500 text-sm">{editError}</p>}
            <input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} placeholder="Name"
              className="text-sm px-2 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100" />
            <CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={editData.grain ?? ''} onChange={e => setEditData(d => ({ ...d, grain: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="Grain"
                className="text-sm px-2 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100" />
              <input value={editData.brand ?? ''} onChange={e => setEditData(d => ({ ...d, brand: e.target.value }))} placeholder="Brand"
                className="text-sm px-2 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100" />
            </div>
            <input value={editData.description ?? ''} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} placeholder="Description (optional)"
              className="text-sm px-2 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100" />
            <div className="flex gap-2 mt-1">
              <button onClick={saveEdit} className="text-xs px-3 py-1.5 bg-black text-white rounded-lg cursor-pointer hover:opacity-80">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
            </div>
          </div>
        ) : (
          <>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
<div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 truncate">{item.name}</h2>
              <button onClick={() => { setEditData({ name: item.name, caliber: item.caliber, grain: item.grain, brand: item.brand, description: item.description }); setEditing(true) }}
                className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 shrink-0 cursor-pointer" aria-label="Edit ammo type">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              <span className="bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">{item.caliber}</span>
              {item.grain && <span>{item.grain}gr</span>}
              {item.brand && <span>· {item.brand}</span>}
              {item.description && <span>· {item.description}</span>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{item.balance.toLocaleString()}</p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mt-0.5">in storage</p>
            <button onClick={() => setShowBuy(true)} className="mt-2 text-sm px-4 py-2 bg-black text-white rounded-lg cursor-pointer hover:opacity-80">+ Log buy</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-3 text-center">
            <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{avgPrice ? `$${avgPrice.perRound.toFixed(2)}` : '—'}</p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">AVG PAID · $</p>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-3 text-center">
            <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{totalBought > 0 ? `${totalBought.toLocaleString()}` : '—'}</p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">BOUGHT · RDS</p>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-3 text-center">
            <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{avgPrice ? `$${(avgPrice.totalCents / 100).toFixed(2)}` : '—'}</p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">SPENT · $</p>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-3 text-center">
            <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{totalFired > 0 ? `${totalFired.toLocaleString()}` : '—'}</p>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-500">FIRED · RDS</p>
          </div>
        </div>
          </>
        )}
      </div>
      {showBuy && (
        <div className="mt-4">
          <AddAmmoModal ammoTypes={[item]} allowNew={false} caption={`Log a purchase of ${item.name}. Adds to your inventory.`} onSubmit={handleBuy} onClose={() => setShowBuy(false)} />
        </div>
      )}

      {/* Usage by firearm */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mt-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Usage by firearm</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">{usageTotal.toLocaleString()} rds / 12 wks</p>
        </div>
        {usageByGun.series.length > 0 ? (
          <>
            <div className="h-[190px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usageByGun.rows} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: 'var(--chart-tick)', fontSize: 11 }} />
                  <YAxis hide />
                  <Tooltip content={<GunTooltip />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.35 }} />
                  {usageByGun.series.map((s: any, si: number) => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} stackId="rounds" fill={s.color} radius={si === usageByGun.series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5 mt-3">
              {usageByGun.series.map((s: any) => s.weaponId != null ? (
                <button key={s.key} type="button" onClick={() => onWeaponClick?.(s.weaponId)}
                  className="flex items-center gap-2 text-sm rounded-md px-1 -mx-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate text-neutral-700 dark:text-neutral-300 font-medium">{s.name}</span>
                  <span className="ml-auto font-semibold tabular-nums text-neutral-900 dark:text-neutral-100 shrink-0">{s.rounds.toLocaleString()} rds</span>
                  <span className="text-neutral-300">›</span>
                </button>
              ) : (
                <div key={s.key} className="flex items-center gap-2 text-sm rounded-md px-1 -mx-1 py-0.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate text-neutral-700 dark:text-neutral-300 font-medium">{s.name}</span>
                  <span className="ml-auto font-semibold tabular-nums text-neutral-900 dark:text-neutral-100 shrink-0">{s.rounds.toLocaleString()} rds</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">No shots recorded yet.</p>
        )}
      </div>

      {/* Transaction history */}
      <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
        Transaction History
      </h3>

      {loading ? (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-700 p-8 text-center">
          <p className="text-neutral-400 dark:text-neutral-500 text-sm">No transactions yet for this ammo type.</p>
        </div>
      ) : (
        <HistoryFilter value={historyFilter} counts={historyCounts} onChange={setHistoryFilter} />
      )}
      {!loading && blocks.length > 0 && visibleBlocks.length === 0 && (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">No matching events for this filter.</p>
      )}
      {!loading && visibleBlocks.length > 0 && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-auto shadow-sm max-h-[70vh]">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-[1]">
              <tr className="border-b border-neutral-100 dark:border-neutral-800 text-left text-xs text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                <th className="px-3 sm:px-4 py-3">Date</th>
                <th className="px-3 sm:px-4 py-3">Type</th>
                <th className="px-3 sm:px-4 py-3">Note</th>
                <th className="px-3 sm:px-4 py-3 text-right">Price paid</th>
                <th className="px-3 sm:px-4 py-3 text-right">Change</th>
                <th className="px-3 sm:px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleBlocks.flatMap(block => block.kind === 'single' ? (
                [renderTxRow(block)]
              ) : (() => {
                const meta = sessionMeta(block.txs)
                const expanded = expandedIds.includes(block.sessionId)
                return [
                  (
                    <tr key={`session-${block.sessionId}`} onClick={() => toggleSession(block.sessionId)}
                      className="border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                      <td className="px-3 sm:px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                        {new Date(meta.oldest).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">
                          Range day
                        </span>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[200px] truncate">
                        {meta.note} <span className="text-neutral-400 dark:text-neutral-500">· {block.txs.length} events</span>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        <span className="text-neutral-300">—</span>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right">
                        {renderSessionNet(block.net)}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right font-medium tabular-nums text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                        {meta.balance.toLocaleString()}
                        <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">{expanded ? '▲' : '▼'}</span>
                      </td>
                    </tr>
                  ),
                  ...(expanded ? [renderSessionLedger(block.sessionId, block.txs)] : []),
                ]
              })())}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Caliber Detail View ───────────────────────────────────────────────────

function CaliberDetailView({ group, refreshKey = 0, onBack, onWeaponClick, onChanged, viewingItemId, onViewItem }: { group: CaliberGroup; refreshKey?: number; onBack: () => void; onWeaponClick?: (weaponId: number) => void; onChanged?: () => void; viewingItemId?: number | null; onViewItem?: (id: number | null) => void }) {
  const [txMap, setTxMap] = useState<Map<number, TxWithEntries>>(new Map())
  const [loading, setLoading] = useState(true)
  const [expandedSessions, setExpandedSessions] = useState<number[] | null>(null)
  const [historyFilter, setHistoryFilter] = useState<NetClass | 'all'>('all')

  const typeIds = useMemo(() => new Set(group.items.map(i => i.id)), [group])

  useEffect(() => {
    setLoading(true)
    Promise.all(
      group.items.map(item =>
        apiFetch(`/ammo/types/${item.id}/transactions`)
          .then(r => r.ok ? r.json() as Promise<TxWithEntries[]> : Promise.resolve([] as TxWithEntries[]))
      )
    ).then(results => {
      const map = new Map<number, TxWithEntries>()
      for (const txList of results) {
        for (const tx of txList) {
          if (!map.has(tx.id)) map.set(tx.id, tx)
        }
      }
      setTxMap(map)
      setLoading(false)
    })
  // refreshKey is intentionally included so a new transaction triggers a re-fetch.
  // group.caliber guards against fetching when the caliber hasn't changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.caliber, refreshKey])

  const rows = useMemo(() => {
    const sorted = [...txMap.values()].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    )
    let running = 0
    return sorted.map(tx => {
      const net = tx.entries
        .filter(e => !e.isBalancing && typeIds.has(e.ammoTypeId))
        .reduce((sum, e) => sum + e.quantity, 0)
      running += net
      return { tx, net, runningBalance: running }
    }).reverse()
  }, [txMap, typeIds])

  const blocks = useHistoryBlocks(rows)

  const historyCounts = useMemo(() => {
    const counts: Record<NetClass | 'all', number> = { all: blocks.length, in: 0, out: 0, flat: 0 }
    for (const b of blocks) counts[classifyNet(b.net)] += 1
    return counts
  }, [blocks])
  const visibleBlocks = historyFilter === 'all' ? blocks : blocks.filter(b => classifyNet(b.net) === historyFilter)

  const defaultExpanded = blocks.find(b => b.kind === 'session')
  const expandedIds = expandedSessions ?? (defaultExpanded && defaultExpanded.kind === 'session' ? [defaultExpanded.sessionId] : [])
  const toggleSession = (sessionId: number) => {
    const base = expandedSessions ?? (defaultExpanded && defaultExpanded.kind === 'session' ? [defaultExpanded.sessionId] : [])
    setExpandedSessions(base.includes(sessionId) ? base.filter(id => id !== sessionId) : [...base, sessionId])
  }

  const sessionMeta = (txs: HistoryRow[]) => {
    const start = txs.find(r => r.tx.type === 'range_day_start')
    const note = start?.tx.note ?? txs.find(r => r.tx.note)?.tx.note ?? 'Range day'
    const oldest = txs[txs.length - 1].tx.occurredAt
    return { note, oldest, balance: txs[0].runningBalance }
  }

  // Burn-down: per-ammo-type running balance over time, shaped for Recharts.
  const burndown = useMemo(() => {
    const perType = group.items.map(item => {
      const pts = [...txMap.values()]
        .map(tx => ({
          at: new Date(tx.occurredAt).getTime(),
          net: tx.entries.filter(e => !e.isBalancing && e.ammoTypeId === item.id).reduce((s, e) => s + e.quantity, 0),
        }))
        .filter(p => p.net !== 0)
        .sort((a, b) => a.at - b.at)
      let run = 0
      return { item, steps: pts.map(p => { run += p.net; return { at: p.at, bal: run } }) }
    }).filter(s => s.steps.length > 0)
    if (perType.length === 0) return null
    const times = [...new Set(perType.flatMap(s => s.steps.map(p => p.at)))].sort((a, b) => a - b)
    const bals = new Map<number, number>()
    const rows = times.map(at => {
      const row: Record<string, number | string | null> = {
        t: at,
        label: new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      }
      for (const s of perType) {
        for (const p of s.steps) {
          if (p.at <= at) bals.set(s.item.id, p.bal)
        }
        row[`a${s.item.id}`] = bals.has(s.item.id) ? bals.get(s.item.id)! : null
      }
      return row
    })
    const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
    return {
      rows,
      lines: perType.map((s, i) => ({
        key: `a${s.item.id}`,
        name: s.item.name,
        color: colors[i % colors.length],
        current: s.steps[s.steps.length - 1].bal,
      })),
      minLabel: new Date(times[0]).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      maxLabel: new Date(times[times.length - 1]).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    }
  }, [txMap, group.items])

  const renderCaliberRow = ({ tx, net, runningBalance }: HistoryRow) => (
    <tr key={tx.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
      <td className="px-3 sm:px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
        {new Date(tx.occurredAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
        })}
      </td>
      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
        <TxChip type={tx.type} />
      </td>
      <td className="px-3 sm:px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[200px] truncate">
        {tx.note ?? <span className="text-neutral-300">—</span>}
      </td>
      <td className="px-3 sm:px-4 py-3 text-right">
        {net === 0
          ? <span className="text-neutral-400 dark:text-neutral-500 text-sm">—</span>
          : (
            <span className={`font-semibold tabular-nums ${net > 0 ? 'text-green-700' : 'text-red-600'}`}>
              {net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
            </span>
          )
        }
      </td>
      <td className="px-3 sm:px-4 py-3 text-right font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
        {runningBalance.toLocaleString()}
      </td>
    </tr>
  )

  const renderCaliberSessionNet = (net: number) => net === 0
    ? <span className="text-neutral-400 dark:text-neutral-500 text-sm">—</span>
    : (
      <span className={`font-semibold tabular-nums ${net > 0 ? 'text-green-700' : 'text-red-600'}`}>
        {net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
      </span>
    )

  if (viewingItemId != null) {
    const liveItem = group.items.find(i => i.id === viewingItemId) ?? null
    if (liveItem) {
    return <AmmoTypeDetailView item={liveItem} refreshKey={refreshKey} onBack={() => onViewItem?.(null)} onWeaponClick={onWeaponClick} onChanged={onChanged} />
    }
  }

  return (
    <div>
      {/* Back */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer transition-colors"
        >
          ← Inventory
        </button>
      </div>

      {/* Caliber summary card */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mb-6">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{group.caliber}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              {group.items.length} ammo type{group.items.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-4xl font-bold ${balanceColor(group.totalBalance)}`}>
              {group.totalBalance.toLocaleString()}
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">total rounds in storage</p>
          </div>
        </div>
      </div>

      {/* Burn-down per ammo type */}
      {burndown && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Burn-down</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">{burndown.minLabel} → {burndown.maxLabel}</p>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={burndown.rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="t" tickLine={false} axisLine={false} minTickGap={40}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} />
                <YAxis tickLine={false} axisLine={false} width={44}
                  tick={{ fill: 'var(--chart-tick)', fontSize: 12 }}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`} />
                <Tooltip content={<BurndownTooltip />} cursor={{ stroke: 'var(--chart-grid)' }} />
                {burndown.lines.map(l => (
                  <Line key={l.key} dataKey={l.key} name={l.name} type="stepAfter"
                    stroke={l.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {burndown.lines.map(l => (
              <span key={l.key} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                <span className="truncate max-w-[160px] text-neutral-700 dark:text-neutral-300 font-medium">{l.name}</span>
                <span className="tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">{l.current.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-type breakdown */}
      <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">Ammo types</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {group.items.map(item => (
          <button
            key={item.id}
            onClick={() => onViewItem?.(item.id)}
            className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 shadow-sm text-left hover:border-neutral-400 hover:shadow-md transition-all cursor-pointer group"
          >
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate group-hover:text-neutral-900 dark:group-hover:text-neutral-100">{item.name}</p>
            {(item.grain || item.brand) && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 truncate">
                {[item.grain ? `${item.grain}gr` : null, item.brand].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className={`text-2xl font-bold mt-2 ${balanceColor(item.balance)}`}>{item.balance.toLocaleString()}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">rounds · tap for history</p>
          </button>
        ))}
      </div>

      {/* Merged transaction history */}
      <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
        Transaction History
      </h3>

      {loading ? (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-700 p-8 text-center">
          <p className="text-neutral-400 dark:text-neutral-500 text-sm">No transactions yet for this caliber.</p>
        </div>
      ) : (
        <HistoryFilter value={historyFilter} counts={historyCounts} onChange={setHistoryFilter} />
      )}
      {!loading && blocks.length > 0 && visibleBlocks.length === 0 && (
        <p className="text-neutral-400 dark:text-neutral-500 text-sm">No matching events for this filter.</p>
      )}
      {!loading && visibleBlocks.length > 0 && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-auto shadow-sm max-h-[70vh]">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-[1]">
              <tr className="border-b border-neutral-100 dark:border-neutral-800 text-left text-xs text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">
                <th className="px-3 sm:px-4 py-3">Date</th>
                <th className="px-3 sm:px-4 py-3">Type</th>
                <th className="px-3 sm:px-4 py-3">Note</th>
                <th className="px-3 sm:px-4 py-3 text-right">Change</th>
                <th className="px-3 sm:px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visibleBlocks.flatMap(block => block.kind === 'single' ? (
                [renderCaliberRow(block)]
              ) : (() => {
                const meta = sessionMeta(block.txs)
                const expanded = expandedIds.includes(block.sessionId)
                return [
                  (
                    <tr key={`session-${block.sessionId}`} onClick={() => toggleSession(block.sessionId)}
                      className="border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/60 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                      <td className="px-3 sm:px-4 py-3 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                        {new Date(meta.oldest).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-800">
                          Range day
                        </span>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-neutral-600 dark:text-neutral-400 max-w-[200px] truncate">
                        {meta.note} <span className="text-neutral-400 dark:text-neutral-500">· {block.txs.length} events</span>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right">
                        {renderCaliberSessionNet(block.net)}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right font-medium tabular-nums text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                        {meta.balance.toLocaleString()}
                        <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">{expanded ? '▲' : '▼'}</span>
                      </td>
                    </tr>
                  ),
                  ...(expanded ? block.txs.filter(r => !MECHANICAL_TX_TYPES.has(r.tx.type)).map(renderCaliberRow) : []),
                ]
              })())}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function NewWeaponForm({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [caliber, setCaliber] = useState('')
  const [type, setType] = useState('handgun')
  const [serialNumber, setSerialNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [initialRounds, setInitialRounds] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name || !caliber) { setError('Name and caliber are required'); return }
    const res = await apiFetch('/weapons', {
      method: 'POST',
      body: JSON.stringify({
        name, caliber, type,
        serialNumber: serialNumber || null,
        notes: notes || null,
        initialRounds: initialRounds ? Math.max(0, Math.floor(Number(initialRounds))) : 0,
      }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onSuccess()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="text" placeholder="Name (e.g. Glock 19)" value={name} required
        onChange={e => setName(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <CaliberSelect value={caliber} onChange={setCaliber} />
      <select value={type} onChange={e => setType(e.target.value)}
        className="px-3 py-2 border rounded-lg text-sm bg-white dark:bg-neutral-900">
        <option value="handgun">Handgun</option>
        <option value="rifle">Rifle</option>
        <option value="shotgun">Shotgun</option>
      </select>
      <input type="text" placeholder="Serial number (optional)" value={serialNumber}
        onChange={e => setSerialNumber(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Initial rounds fired before tracking (optional)" value={initialRounds}
        onChange={e => setInitialRounds(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))} className="px-3 py-2 border rounded-lg text-sm" />
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 -mt-2">If you already know this gun has e.g. 500 rounds, set it here. It will count toward total and cleaning due.</p>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Create</button>
    </form>
  )
}

function CleaningModal({ weapon, totalRounds, cleanings, onClose, onSaved }: {
  weapon: Weapon; totalRounds: number; cleanings: WeaponCleaning[]; onClose: () => void; onSaved: () => void
}) {
  const latest = cleanings[0] ?? null
  const [intervalRounds, setIntervalRounds] = useState<string>(weapon.cleaningIntervalRounds?.toString() ?? '')
  const [intervalDays, setIntervalDays] = useState<string>(weapon.cleaningIntervalDays?.toString() ?? '')
  const [customRounds, setCustomRounds] = useState(false)
  const [customDays, setCustomDays] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [logging, setLogging] = useState(false)

  const baselineRounds = latest?.roundCountAtCleaning ?? 0
  const baselineDate = latest ? new Date(latest.cleanedAt) : new Date(weapon.createdAt)
  const roundsSince = totalRounds - baselineRounds
  const daysSince = Math.max(0, Math.floor((Date.now() - baselineDate.getTime()) / 86400000))
  const rInt = intervalRounds ? Number(intervalRounds) : null
  const dInt = intervalDays ? Number(intervalDays) : null
  const dueRounds = rInt != null ? rInt - roundsSince : null
  const dueDays = dInt != null ? dInt - daysSince : null
  const pctRounds = rInt ? Math.min(100, Math.max(0, (roundsSince / rInt) * 100)) : 0
  const pctDays = dInt ? Math.min(100, Math.max(0, (daysSince / dInt) * 100)) : 0
  const overdue = (dueRounds != null && dueRounds <= 0) || (dueDays != null && dueDays <= 0)

  const saveIntervals = async () => {
    setSaving(true)
    const body: Record<string, unknown> = {
      cleaningIntervalRounds: intervalRounds ? Number(intervalRounds) : null,
      cleaningIntervalDays: intervalDays ? Number(intervalDays) : null,
    }
    const res = await apiFetch(`/weapons/${weapon.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    setSaving(false)
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Error'); return }
    await onSaved()
    onClose()
  }

  const logNow = async () => {
    setLogging(true)
    const res = await apiFetch(`/weapons/${weapon.id}/cleanings`, {
      method: 'POST',
      body: JSON.stringify({ roundCountAtCleaning: totalRounds, note: note || null }),
    })
    setLogging(false)
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Error'); return }
    setNote('')
    await onSaved()
  }

  const chip = (active: boolean) => `px-2.5 py-1 rounded-full text-xs border cursor-pointer ${active ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Cleaning — {weapon.name}</h3>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{weapon.type} · {weapon.caliber} · {totalRounds.toLocaleString()} rds fired</p>
            </div>
            <button onClick={onClose} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-xl leading-none cursor-pointer">×</button>
          </div>

          <div className="mt-4 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-500 dark:text-neutral-400">Since clean: <span className="font-semibold text-neutral-900 dark:text-neutral-100">{roundsSince.toLocaleString()} rds</span> · {daysSince}d</span>
              <span className={overdue ? 'text-red-600 font-semibold' : 'text-neutral-500 dark:text-neutral-400'}>
                {overdue ? `Overdue by ${dueRounds != null && dueRounds <= 0 ? Math.abs(dueRounds) + ' rds' : ''}${dueRounds != null && dueRounds <= 0 && dueDays != null && dueDays <= 0 ? ' · ' : ''}${dueDays != null && dueDays <= 0 ? Math.abs(dueDays) + 'd' : ''}` : `${dueRounds != null ? `Due in ${dueRounds} rds` : ''}${dueRounds != null && dueDays != null ? ' · ' : ''}${dueDays != null ? `in ${dueDays}d` : ''}${dueRounds == null && dueDays == null ? 'No interval set' : ''}`}
              </span>
            </div>
            {rInt != null && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500 mb-1"><span>Rounds</span><span>{roundsSince}/{rInt}</span></div>
                <div className="h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden"><div className={`h-full ${overdue && dueRounds != null && dueRounds <= 0 ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-100'}`} style={{ width: `${pctRounds}%` }} /></div>
              </div>
            )}
            {dInt != null && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-neutral-400 dark:text-neutral-500 mb-1"><span>Time</span><span>{daysSince}/{dInt}d</span></div>
                <div className="h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden"><div className={`h-full ${overdue && dueDays != null && dueDays <= 0 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pctDays}%` }} /></div>
              </div>
            )}
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2">Last: {latest ? `${new Date(latest.cleanedAt).toLocaleDateString()} @ ${latest.roundCountAtCleaning.toLocaleString()} rds` : `Never — since ${new Date(weapon.createdAt).toLocaleDateString()} @ 0 rds`}</p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Interval — rounds</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[250, 500, 1000].map(n => (
                <button key={n} type="button" onClick={() => { setIntervalRounds(String(n)); setCustomRounds(false) }} className={chip(intervalRounds === String(n))}>{n}</button>
              ))}
              <button type="button" onClick={() => setCustomRounds(v => !v)} className={chip(customRounds)}>Custom</button>
              <button type="button" onClick={() => { setIntervalRounds(''); setCustomRounds(false) }} className={chip(intervalRounds === '')}>None</button>
            </div>
            {customRounds && (
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 750" value={intervalRounds} onChange={e => setIntervalRounds(e.target.value.replace(/\D/g, ''))} className="mt-2 w-32 px-2 py-1 border rounded text-sm" />
            )}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Interval — time</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[30, 90, 180, 365].map(n => (
                <button key={n} type="button" onClick={() => { setIntervalDays(String(n)); setCustomDays(false) }} className={chip(intervalDays === String(n))}>{n}d</button>
              ))}
              <button type="button" onClick={() => setCustomDays(v => !v)} className={chip(customDays)}>Custom</button>
              <button type="button" onClick={() => { setIntervalDays(''); setCustomDays(false) }} className={chip(intervalDays === '')}>None</button>
            </div>
            {customDays && (
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 60" value={intervalDays} onChange={e => setIntervalDays(e.target.value.replace(/\D/g, ''))} className="mt-2 w-32 px-2 py-1 border rounded text-sm" />
            )}
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">Quick chips: 30d / 90d (3mo) / 180d / 365d</p>
          </div>

          <div className="mt-5 pt-5 border-t border-neutral-100 dark:border-neutral-800">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Log a cleaning</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">Records a cleaning now at <span className="font-semibold">{totalRounds.toLocaleString()} RDS</span>.</p>
            <input type="text" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="mt-2 w-full px-3 py-2 border rounded-lg text-sm" />
            <button type="button" onClick={logNow} disabled={logging} className="mt-2 w-full px-4 py-3 bg-blue-600 text-white rounded-xl text-base font-semibold hover:bg-blue-700 disabled:opacity-40 cursor-pointer">{logging ? 'Logging…' : 'Log Cleaning'}</button>
          </div>

          {cleanings.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">History ({cleanings.length})</p>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-800">
                {cleanings.map(c => (
                  <HistoryRow key={c.id}
                    date={new Date(c.cleanedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    chip={<span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-blue-600 text-white">CLEANED</span>}
                    title={`@ ${c.roundCountAtCleaning.toLocaleString()} rds`}
                    subtitle={c.note ?? undefined}
                    right=""
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-6">
            <button type="button" onClick={onClose} className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Cancel</button>
            <button type="button" onClick={saveIntervals} disabled={saving} className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 disabled:opacity-40 cursor-pointer">Save intervals</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WeaponManager({ weapons, onRefresh, onWeaponClick }: { weapons: Weapon[]; onRefresh: () => void; onWeaponClick: (weaponId: number) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Weapon>>({})
  const [error, setError] = useState('')
  const [totals, setTotals] = useState<Record<number, number>>({})
  const [totalsLoading, setTotalsLoading] = useState(true)
  const [cleanings, setCleanings] = useState<Record<number, WeaponCleaning[]>>({})
  const [cleaningsLoading, setCleaningsLoading] = useState(true)
  const [cleaningWeapon, setCleaningWeapon] = useState<Weapon | null>(null)

  useEffect(() => {
    let cancelled = false
    setTotalsLoading(true)
    apiFetch('/weapons/firing-summary')
      .then(r => (r.ok ? r.json() : Promise.resolve([])))
      .then((arr: { weaponId: number; totalRounds: number }[]) => {
        if (cancelled) return
        const map: Record<number, number> = {}
        for (const t of arr) map[t.weaponId] = t.totalRounds
        setTotals(map)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTotalsLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (weapons.length === 0) { setCleaningsLoading(false); return }
    let cancelled = false
    setCleaningsLoading(true)
    Promise.all(weapons.map(w => apiFetch(`/weapons/${w.id}/cleanings`).then(r => r.ok ? r.json() : []).then((arr: WeaponCleaning[]) => ({ id: w.id, arr })).catch(() => ({ id: w.id, arr: [] }))))
      .then(results => {
        if (cancelled) return
        const map: Record<number, WeaponCleaning[]> = {}
        for (const r of results) map[r.id] = r.arr
        setCleanings(map)
      })
      .finally(() => { if (!cancelled) setCleaningsLoading(false) })
    return () => { cancelled = true }
  }, [weapons])

  const reloadCleanings = async (weaponId: number) => {
    const res = await apiFetch(`/weapons/${weaponId}/cleanings`)
    if (res.ok) {
      const arr: WeaponCleaning[] = await res.json()
      setCleanings(m => ({ ...m, [weaponId]: arr }))
    }
  }

  const startEdit = (w: Weapon) => {
    setEditingId(w.id)
    setEditData({ name: w.name, caliber: w.caliber, type: w.type, serialNumber: w.serialNumber, notes: w.notes, initialRounds: w.initialRounds })
  }

  const saveEdit = async () => {
    if (editingId == null) return
    const res = await apiFetch(`/weapons/${editingId}`, {
      method: 'PATCH',
      body: JSON.stringify(editData),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    setEditingId(null)
    onRefresh()
  }

  const deleteWeapon = async (id: number) => {
    if (!confirm('Delete this weapon?')) return
    const res = await apiFetch(`/weapons/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error || 'Cannot delete')
      return
    }
    onRefresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Your Weapons</h3>
        <button onClick={() => setShowForm(s => !s)}
          className="text-sm px-3 py-1.5 bg-black text-white rounded-lg cursor-pointer hover:opacity-80">
          + New Weapon
        </button>
      </div>

      {showForm && (
        <QuickForm title="New Weapon" onClose={() => setShowForm(false)}>
          <NewWeaponForm onSuccess={() => { setShowForm(false); onRefresh() }} onClose={() => setShowForm(false)} />
        </QuickForm>
      )}

      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

      {weapons.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No weapons yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {weapons.map(w => {
            const total = totals[w.id]
            return (
              <div key={w.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm p-5 flex flex-col h-full">
                {editingId === w.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Name" />
                    <CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} />
                    <select value={editData.type ?? 'handgun'} onChange={e => setEditData(d => ({ ...d, type: e.target.value }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900">
                      <option value="handgun">Handgun</option>
                      <option value="rifle">Rifle</option>
                      <option value="shotgun">Shotgun</option>
                    </select>
                    <input value={editData.serialNumber ?? ''} onChange={e => setEditData(d => ({ ...d, serialNumber: e.target.value || null }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Serial" />
                    <input value={editData.notes ?? ''} onChange={e => setEditData(d => ({ ...d, notes: e.target.value || null }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Notes" />
                    <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">Initial rounds (pre-app)
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={editData.initialRounds ?? ''} onChange={e => setEditData(d => ({ ...d, initialRounds: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : 0 }))} className="mt-1 px-2 py-1 border rounded text-sm w-full" placeholder="0" />
                    </label>
                    <div className="flex gap-2 mt-1">
                      <button onClick={saveEdit} className="text-xs px-2 py-1 bg-black text-white rounded cursor-pointer hover:opacity-80">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onWeaponClick(w.id)}
                      className="w-full text-left rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer -m-1 p-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{w.name}</p>
                          <p className="text-xs text-neutral-400 dark:text-neutral-500 capitalize mt-0.5">{w.type} · {w.caliber}</p>
                        </div>
                        <span className="shrink-0 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 px-2 py-0.5 rounded-full">{w.caliber}</span>
                      </div>
                    </button>

                    <div className="mt-4">
                      {totalsLoading && total === undefined ? (
                        <div className="h-8 w-20 bg-neutral-100 dark:bg-neutral-800 animate-pulse rounded" />
                      ) : (
                        <p className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{total?.toLocaleString() ?? '0'}</p>
                      )}
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">rounds fired · total</p>
                      {(w.initialRounds ?? 0) > 0 && !totalsLoading && (
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
                          {w.initialRounds.toLocaleString()} prior + {Math.max(0, (total ?? 0) - w.initialRounds).toLocaleString()} tracked
                        </p>
                      )}
                    </div>

                    {w.serialNumber && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-3">S/N: {w.serialNumber}</p>}
                    {w.notes && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 truncate">{w.notes}</p>}

                    {(() => {
                      if (totalsLoading || cleaningsLoading || total === undefined || !(w.id in cleanings)) {
                        return (
                          <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
                            <div className="h-3 w-24 bg-neutral-100 dark:bg-neutral-800 animate-pulse rounded" />
                            <div className="mt-2 h-2 bg-neutral-100 dark:bg-neutral-800 animate-pulse rounded" />
                          </div>
                        )
                      }
                      const totalRounds = totals[w.id] ?? 0
                      const cls = cleanings[w.id] ?? []
                      const latest = cls[0] ?? null
                      const baselineRounds = latest?.roundCountAtCleaning ?? 0
                      const baselineDate = latest ? new Date(latest.cleanedAt) : new Date(w.createdAt)
                      const roundsSince = Math.max(0, totalRounds - baselineRounds)
                      const daysSince = Math.max(0, Math.floor((Date.now() - baselineDate.getTime()) / 86400000))
                      const rInt = w.cleaningIntervalRounds
                      const dInt = w.cleaningIntervalDays
                      const hasSchedule = rInt != null || dInt != null
                      if (!hasSchedule) {
                        return (
                          <div className="mt-3">
                            <button onClick={() => setCleaningWeapon(w)} className="w-full text-xs px-3 py-2 border border-dashed border-neutral-300 dark:border-neutral-600 rounded-lg text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer">
                              No cleaning schedule · Set up →
                            </button>
                          </div>
                        )
                      }
                      const dueRounds = rInt != null ? rInt - roundsSince : null
                      const dueDays = dInt != null ? dInt - daysSince : null
                      const overdue = (dueRounds != null && dueRounds <= 0) || (dueDays != null && dueDays <= 0)
                      const pctRounds = rInt ? Math.min(100, Math.max(0, (roundsSince / rInt) * 100)) : 0
                      const pctDays = dInt ? Math.min(100, Math.max(0, (daysSince / dInt) * 100)) : 0
                      return (
                        <div className={`mt-3 rounded-lg border p-3 ${overdue ? 'bg-red-50 border-red-200' : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-semibold ${overdue ? 'text-red-700' : 'text-neutral-700 dark:text-neutral-300'}`}>{overdue ? 'Overdue' : 'Cleaning due'}</span>
                            <button onClick={() => setCleaningWeapon(w)} className="text-[11px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 underline cursor-pointer">Manage →</button>
                          </div>
                          {rInt != null && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400 mb-1"><span>{roundsSince}/{rInt} rds</span><span>{dueRounds! > 0 ? `${dueRounds} left` : `${Math.abs(dueRounds!)} over`}</span></div>
                              <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden"><div className={`h-full ${dueRounds != null && dueRounds <= 0 ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-100'}`} style={{ width: `${pctRounds}%` }} /></div>
                            </div>
                          )}
                          {dInt != null && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400 mb-1"><span>{daysSince}/{dInt}d</span><span>{dueDays! > 0 ? `${dueDays}d left` : `${Math.abs(dueDays!)}d over`}</span></div>
                              <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden"><div className={`h-full ${dueDays != null && dueDays <= 0 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pctDays}%` }} /></div>
                            </div>
                          )}
                          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2">Last: {latest ? `${new Date(latest.cleanedAt).toLocaleDateString()} @ ${latest.roundCountAtCleaning.toLocaleString()} rds` : `Never`}{latest?.note ? ` · ${latest.note}` : ''}</p>
                        </div>
                      )
                    })()}

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex-wrap">
                      <button onClick={() => onWeaponClick(w.id)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
                        Details
                      </button>
                      <button onClick={() => setCleaningWeapon(w)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700">Log Cleaning</button>
                      <button onClick={() => startEdit(w)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Edit</button>
                      <button onClick={() => deleteWeapon(w.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded cursor-pointer hover:bg-red-50">Delete</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {cleaningWeapon && (
        <CleaningModal
          weapon={cleaningWeapon}
          totalRounds={totals[cleaningWeapon.id] ?? 0}
          cleanings={cleanings[cleaningWeapon.id] ?? []}
          onClose={() => setCleaningWeapon(null)}
          onSaved={async () => {
            await reloadCleanings(cleaningWeapon.id)
            onRefresh()
            const res = await apiFetch(`/weapons/${cleaningWeapon.id}`)
            if (res.ok) {
              const updated: Weapon = await res.json()
              setCleaningWeapon(updated)
            }
          }}
        />
      )}
    </div>
  )
}

const AMMO_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#71717a']
const GUN_COLORS = ['#3b82f6', '#22c55e', '#f59e0b']


function WeaponDetailView({ weaponId, onBack, onRefresh }: {
  weaponId: number; onBack: () => void; onRefresh: () => void
}) {
  const [weapon, setWeapon] = useState<Weapon | null>(null)
  const [history, setHistory] = useState<any>(null)
  const [cleanings, setCleanings] = useState<WeaponCleaning[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Weapon>>({})
  const [error, setError] = useState('')
  const [showCleaning, setShowCleaning] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [activeAmmo, setActiveAmmo] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [wRes, hRes, cRes] = await Promise.all([
      apiFetch(`/weapons/${weaponId}`),
      apiFetch(`/weapons/${weaponId}/history`),
      apiFetch(`/weapons/${weaponId}/cleanings`),
    ])
    if (wRes.ok) setWeapon(await wRes.json())
    if (hRes.ok) setHistory(await hRes.json())
    if (cRes.ok) setCleanings(await cRes.json())
    setLoading(false)
  }, [weaponId])

  useEffect(() => { load() }, [load])

  const saveEdit = async () => {
    const res = await apiFetch(`/weapons/${weaponId}`, {
      method: 'PATCH',
      body: JSON.stringify(editData),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    setEditing(false)
    onRefresh()
    load()
  }

  const deleteWeapon = async () => {
    const res = await apiFetch(`/weapons/${weaponId}`, { method: 'DELETE' })
    setShowDeleteConfirm(false)
    if (!res.ok) {
      const d = await res.json()
      alert(d.error || 'Cannot delete')
      return
    }
    onRefresh()
    onBack()
  }

  type TimelineEvent =
    | { kind: 'shot'; id: string; at: string; rounds: number; ammoName: string; sessionNote: string | null }
    | { kind: 'cleaned'; id: string; at: string; roundCount: number; note: string | null }

  const practice = useMemo(() => {
    const sessions: any[] = history?.sessions ?? []
    const totalRounds: number = history?.totalRounds ?? 0
    const now = Date.now()
    let last30 = 0, last90 = 0, lastShot: string | null = null
    for (const s of sessions) {
      for (const st of (s.strings ?? [])) {
        const age = now - new Date(st.occurredAt).getTime()
        if (age <= 30 * 86400000) last30 += st.rounds
        if (age <= 90 * 86400000) last90 += st.rounds
        if (!lastShot || new Date(st.occurredAt) > new Date(lastShot)) lastShot = st.occurredAt
      }
    }
    return { last30, last90, lastShot, perSession: sessions.length > 0 ? Math.round(totalRounds / sessions.length) : 0 }
  }, [history])

  const timeline = useMemo<TimelineEvent[]>(() => {
    const sessions: any[] = history?.sessions ?? []
    const events: TimelineEvent[] = []
    for (const s of sessions) {
      for (const st of (s.strings ?? [])) {
        events.push({ kind: 'shot', id: `shot-${st.id}`, at: st.occurredAt, rounds: st.rounds, ammoName: st.ammoName, sessionNote: s.note ?? null })
      }
    }
    for (const c of cleanings) {
      events.push({ kind: 'cleaned', id: `clean-${c.id}`, at: c.cleanedAt, roundCount: c.roundCountAtCleaning, note: c.note })
    }
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [history, cleanings])


  const weeks = useMemo(() => {
    const sessions: any[] = history?.sessions ?? []
    const now = Date.now()
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      rounds: 0,
      start: now - (11 - i) * 7 * 86400000 - 6 * 86400000,
    }))
    for (const s of sessions) {
      for (const st of (s.strings ?? [])) {
        const idx = 11 - Math.floor((now - new Date(st.occurredAt).getTime()) / (7 * 86400000))
        if (idx >= 0 && idx < 12) buckets[idx].rounds += st.rounds
      }
    }
    return buckets.map((b, i) => ({
      key: i,
      rounds: b.rounds,
      label: new Date(b.start).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    }))
  }, [history])

  if (loading) return <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading weapon…</p>
  if (!weapon) return (
    <div>
      <button onClick={onBack} className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer transition-colors">← Back</button>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-4">Weapon not found.</p>
    </div>
  )

  const total: number = history?.totalRounds ?? 0
  const initial: number = weapon.initialRounds ?? history?.weapon?.initialRounds ?? 0
  const tracked = Math.max(0, total - initial)

  const latest = cleanings[0] ?? null
  const baselineRounds = latest?.roundCountAtCleaning ?? 0
  const baselineDate = latest ? new Date(latest.cleanedAt) : new Date(weapon.createdAt)
  const roundsSince = Math.max(0, total - baselineRounds)
  const daysSince = Math.max(0, Math.floor((Date.now() - baselineDate.getTime()) / 86400000))
  const rInt = weapon.cleaningIntervalRounds
  const dInt = weapon.cleaningIntervalDays
  const hasSchedule = rInt != null || dInt != null
  const overdue = hasSchedule && ((rInt != null && rInt - roundsSince <= 0) || (dInt != null && dInt - daysSince <= 0))

  const byAmmoType: any[] = history?.byAmmoType ?? []

  const weekMax = Math.max(1, ...weeks.map(w => w.rounds))
  const activityTotal = weeks.reduce((s, w) => s + w.rounds, 0)


  const coarseTime = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const verdict = (() => {
    if (!practice.lastShot) return { dot: 'bg-neutral-300', text: 'No range time logged yet' }
    const ageDays = (Date.now() - new Date(practice.lastShot).getTime()) / 86400000
    if (ageDays <= 14 && practice.last30 >= 100) return { dot: 'bg-green-500', text: `Active · ${practice.last30.toLocaleString()} rds in 30d · last shot ${coarseTime(practice.lastShot)}` }
    if (ageDays <= 90) return { dot: 'bg-amber-400', text: `Recent · ${practice.last90.toLocaleString()} rds in 90d · last shot ${coarseTime(practice.lastShot)}` }
    return { dot: 'bg-neutral-300', text: `Idle · last shot ${coarseTime(practice.lastShot)}` }
  })()

  const cleaningStatus = !hasSchedule
    ? 'Set up'
    : overdue
      ? 'Overdue'
      : rInt != null
        ? `${(rInt - roundsSince).toLocaleString()} rds left`
        : `${(dInt! - daysSince).toLocaleString()}d left`

  return (
    <div>
      {/* Back */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer transition-colors"
        >
          ← Back
        </button>
      </div>

      {/* Weapon overview + ammo side by side on wide screens */}
      <div className="md:grid md:grid-cols-3 md:gap-6 md:items-stretch mb-8">
      <div className="min-w-0 md:col-span-2">
      {/* Weapon overview card */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mb-8 md:mb-0 h-full">
        {editing ? (
          <div className="flex flex-col gap-2">
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Name" />
            <CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} />
            <select value={editData.type ?? 'handgun'} onChange={e => setEditData(d => ({ ...d, type: e.target.value }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900">
              <option value="handgun">Handgun</option>
              <option value="rifle">Rifle</option>
              <option value="shotgun">Shotgun</option>
            </select>
            <input value={editData.serialNumber ?? ''} onChange={e => setEditData(d => ({ ...d, serialNumber: e.target.value || null }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Serial" />
            <input value={editData.notes ?? ''} onChange={e => setEditData(d => ({ ...d, notes: e.target.value || null }))} className="px-2 py-1 border rounded text-sm bg-white dark:bg-neutral-900" placeholder="Notes" />
            <label className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">Initial rounds (pre-app)
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={editData.initialRounds ?? ''} onChange={e => setEditData(d => ({ ...d, initialRounds: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : 0 }))} className="mt-1 px-2 py-1 border rounded text-sm w-full" placeholder="0" />
            </label>
            <div className="flex gap-2 mt-1">
              <button onClick={saveEdit} className="text-xs px-2 py-1 bg-black text-white rounded cursor-pointer hover:opacity-80">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
              <button onClick={() => setShowDeleteConfirm(true)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded cursor-pointer hover:bg-red-50">Delete weapon</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{weapon.name}</h2>
                <button onClick={() => { setEditData({ name: weapon.name, caliber: weapon.caliber, type: weapon.type, serialNumber: weapon.serialNumber, notes: weapon.notes, initialRounds: weapon.initialRounds }); setEditing(true) }} title="Edit weapon"
                  className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07A4.5 4.5 0 018.738 17.5l-3.5.875.875-3.5a4.5 4.5 0 011.447-1.843L16.862 4.487z" /></svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                <span className="bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full capitalize">{weapon.type}</span>
                <span className="bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">{weapon.caliber}</span>
                {weapon.serialNumber && <span>S/N: {weapon.serialNumber}</span>}
              </div>
              {weapon.notes && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">{weapon.notes}</p>}
            {/* Rotation status */}
            <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <span className={`w-2 h-2 rounded-full shrink-0 ${verdict.dot}`} />
              <span className="truncate">{verdict.text}</span>
            </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {[
                  { value: total.toLocaleString(), label: 'fired', sub: initial > 0 ? `${initial.toLocaleString()} prior + ${tracked.toLocaleString()} tracked` : '' },
                  { value: practice.perSession.toLocaleString(), label: 'avg/session', sub: '' },
                  { value: practice.last30.toLocaleString(), label: 'last 30d', sub: '' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2.5 text-left">
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">{s.label}</p>
                    <p className="text-2xl font-bold tabular-nums mt-0.5">{s.value}</p>
                    {s.sub !== '' && <p className="text-[11px] leading-tight text-neutral-400 dark:text-neutral-500 tabular-nums mt-0.5">{s.sub}</p>}
                  </div>
                ))}
              </div>
            {/* Cleaning */}
            <div onClick={() => setShowCleaning(true)} className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2.5 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700/60 transition-colors">
              <div className="flex justify-between items-baseline text-xs mb-1.5">
                <span className="text-neutral-500 dark:text-neutral-400">{cleanings.length > 0 ? `Last cleaned ${daysSince}d ago` : 'Never cleaned yet'}</span>
                <span className={`font-semibold shrink-0 ml-2 ${overdue ? 'text-red-600' : 'text-neutral-700 dark:text-neutral-300'}`}>{cleaningStatus} →</span>
              </div>
              {hasSchedule ? (
                <>
                  <div className="flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400 mb-1 tabular-nums">
                    <span>{rInt != null ? `${roundsSince.toLocaleString()}/${rInt.toLocaleString()} rds` : `${daysSince}/${dInt}d`}</span>
                  </div>
                  <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                    <div className={`h-full ${overdue ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-100'}`} style={{ width: `${Math.min(100, Math.max(0, (rInt != null ? roundsSince / rInt : daysSince / (dInt ?? 1)) * 100))}%` }} />
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">No cleaning schedule · tap to set up</p>
              )}
            </div>
            </div>
          </>
        )}
      </div>
      </div>
      {!editing && (
      <div className="min-w-0 flex flex-col gap-4 h-full">
            {/* Ammo through this gun */}
            {byAmmoType.length > 0 && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm flex-1">
                <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">Ammo</p>
<div className="flex flex-col gap-2">
                  <div className="relative mx-auto w-full max-w-[220px]">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={byAmmoType} dataKey="rounds" nameKey="name" innerRadius={62} outerRadius={85} paddingAngle={3} strokeWidth={0} onMouseEnter={(_: any, i: number) => setActiveAmmo(i)} onMouseLeave={() => setActiveAmmo(null)}>
                          {byAmmoType.map((a: any, i: number) => (
                            <Cell key={a.ammoTypeId} fill={AMMO_COLORS[i % AMMO_COLORS.length]} opacity={activeAmmo == null || activeAmmo === i ? 1 : 0.3} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{(activeAmmo != null && byAmmoType[activeAmmo] ? byAmmoType[activeAmmo].rounds : total).toLocaleString()}</span>
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400 max-w-[130px] truncate">{activeAmmo != null && byAmmoType[activeAmmo] ? byAmmoType[activeAmmo].name : 'rds fired'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 mt-1">
                    {byAmmoType.map((a: any, i: number) => {
                      const pct = total > 0 ? Math.round((a.rounds / total) * 100) : 0
                      return (
                        <div key={a.ammoTypeId} onMouseEnter={() => setActiveAmmo(i)} onMouseLeave={() => setActiveAmmo(null)}
                          className={`flex items-center gap-1.5 text-xs rounded-md px-1 -mx-1 py-0.5 cursor-default ${activeAmmo === i ? 'bg-neutral-100 dark:bg-neutral-800' : ''}`}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: AMMO_COLORS[i % AMMO_COLORS.length] }} />
                          <span className="truncate text-neutral-700 dark:text-neutral-300">{a.name}</span>
                          <span className="ml-auto tabular-nums text-neutral-500 dark:text-neutral-400 shrink-0">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
      </div>
      )}
      </div>

      {/* Activity — last 12 weeks */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 shadow-sm mb-8">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Activity</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">{activityTotal.toLocaleString()} rds / 12 wks</p>
        </div>
        <div className="flex items-end gap-1.5 h-20">
          {weeks.map(w => (
            <div key={w.key} title={`Wk of ${w.label} · ${w.rounds.toLocaleString()} rds`} className="flex-1 flex flex-col justify-end h-full">
              <div className={`${w.rounds > 0 ? 'bg-neutral-900 dark:bg-neutral-100' : 'bg-neutral-200 dark:bg-neutral-700'} rounded-sm w-full`} style={{ height: `${w.rounds > 0 ? Math.max(8, (w.rounds / weekMax) * 100) : 6}%` }} />
            </div>
          ))}
        </div>
      </div>

      {/* History — shots and cleanings, newest first */}
      <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
        History
      </h3>
      {timeline.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-700 p-8 text-center">
          <p className="text-neutral-400 dark:text-neutral-500 text-sm">No history yet — shots and cleanings will appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm divide-y divide-neutral-100 dark:divide-neutral-800">
          {timeline.map(e => {
            const date = new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            return e.kind === 'shot' ? (
              <HistoryRow key={e.id}
                date={date}
                chip={<span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-neutral-800 text-white">SHOT</span>}
                title={e.ammoName}
                subtitle={e.sessionNote ?? undefined}
                right={`${e.rounds.toLocaleString()} rds`}
              />
            ) : (
              <HistoryRow key={e.id}
                date={date}
                chip={<span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-blue-600 text-white">CLEANED</span>}
                title={`@ ${e.roundCount.toLocaleString()} rds`}
                subtitle={e.note ?? undefined}
                right=""
              />
            )
          })}
        </div>
      )}

      {showCleaning && (
        <CleaningModal
          weapon={weapon}
          totalRounds={total}
          cleanings={cleanings}
          onClose={() => setShowCleaning(false)}
          onSaved={async () => {
            const res = await apiFetch(`/weapons/${weaponId}/cleanings`)
            if (res.ok) setCleanings(await res.json())
            onRefresh()
            const wRes = await apiFetch(`/weapons/${weaponId}`)
            if (wRes.ok) setWeapon(await wRes.json())
          }}
        />
      )}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-sm w-full p-6"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Delete {weapon.name}?</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              This permanently deletes the weapon and its history. This can't be undone.
            </p>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer">Cancel</button>
              <button type="button" onClick={deleteWeapon}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Home widgets ────────────────────────────────────────────────────────
// Live range-day card (tap = resume), per-pack staged cards with a blue
// Start CTA (tap body = review), and the last completed day. Transient
// action cards render only when they exist — no empty-state widget.

function LiveRangeCard({ session, onResume }: { session: RangeDaySession; onResume: () => void }) {
  const rounds = (session.strings ?? []).reduce((s, x) => s + x.rounds, 0)
  const guns = (session.weapons ?? []).map(w => w.name)
  return (
    <button type="button" onClick={onResume}
      className="w-full text-left rounded-2xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-600" />
          </span>
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">Range day live</p>
        </div>
        {session.startedAt && (
          <p className="text-xl font-bold tabular-nums text-green-800 dark:text-green-200">
            <TabElapsed start={session.startedAt} />
          </p>
        )}
      </div>
      {session.note && <p className="text-sm text-green-700 dark:text-green-400 mt-1 italic">“{session.note}”</p>}
      <p className="text-xs text-green-700 dark:text-green-400 mt-1">
        {rounds.toLocaleString()} rds fired{guns.length > 0 ? ` · ${guns.slice(0, 2).join(', ')}${guns.length > 2 ? ` +${guns.length - 2} more` : ''}` : ''}
      </p>
      <p className="text-xs font-semibold text-green-800 dark:text-green-300 mt-2">Resume →</p>
    </button>
  )
}

function StagedHomeCard({ pack, hasActive, onStart, onReview }: {
  pack: { id: number; note: string | null }
  hasActive: boolean
  onStart: (id: number) => void
  onReview: (id: number) => void
}) {
  const [detail, setDetail] = useState<any>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch(`/ammo/range-days/${pack.id}`).then(r => r.ok ? r.json() : null).then(d => { if (!cancelled) setDetail(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [pack.id])
  const guns: string[] = (detail?.weapons ?? []).map((w: any) => w.name ?? `Gun #${w.id}`)
  const total = ((detail?.bag ?? []) as any[]).reduce((s, b) => s + (b.inBag ?? b.taken ?? b.quantity ?? 0), 0)
  const typeCount = ((detail?.bag ?? []) as any[]).length
  return (
    <div className="rounded-2xl border-2 border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{pack.note || 'Untitled pack'}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Packed at home · clock hasn&apos;t started</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">Staged</span>
      </div>
      {detail == null ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">Loading pack…</p>
      ) : (
        <>
          {guns.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {guns.map((g, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300">{g}</span>
              ))}
            </div>
          )}
          {typeCount > 0 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 tabular-nums">{total.toLocaleString()} rds packed · {typeCount} type{typeCount !== 1 ? 's' : ''}</p>
          )}
        </>
      )}
      <button onClick={() => onStart(pack.id)} disabled={hasActive} title={hasActive ? 'End the current range day first' : undefined}
        className="mt-3 w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
        Start range day
      </button>
      <button onClick={() => onReview(pack.id)} className="mt-2 w-full text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer">
        Review pack →
      </button>
    </div>
  )
}

// Combined activity card (openGym weight-card anatomy): headline stats,
// streak, last session, 8-week bars and top calibers in one — a single
// exit to the Range tab. Bars and streak come from the sessions list we
// already fetch; only the last session's rounds/guns need one detail call.
function RangeActivityCard({ pastCount, lifetimeFired, sessionDates, lastEnded, onViewRange }: {
  pastCount: number
  lifetimeFired: number
  sessionDates: string[]
  lastEnded: { id: number; note: string | null; startedAt: string | null; endedAt: string | null } | null
  onViewRange: () => void
}) {
  const [lastDetail, setLastDetail] = useState<any>(null)
  useEffect(() => {
    if (lastEnded == null) { setLastDetail(null); return }
    let cancelled = false
    apiFetch(`/ammo/range-days/${lastEnded.id}`).then(r => r.ok ? r.json() : null).then(d => { if (!cancelled) setLastDetail(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [lastEnded])
  const lastRounds = lastDetail ? ((lastDetail.strings ?? []) as { rounds: number }[]).reduce((s, x) => s + x.rounds, 0) : null
  const lastGuns: string[] = lastDetail ? (lastDetail.weapons ?? []).map((w: any) => w.name ?? `Gun #${w.id}`) : []
  const lastWhen = lastEnded?.endedAt ? new Date(lastEnded.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null

  // Monday-start week buckets for the last 8 weeks (oldest → newest).
  const { buckets, starts, streak, thisWeek } = useMemo(() => {
    const day = 86400000
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const starts = Array.from({ length: 8 }, (_, i) => monday.getTime() - (7 - i) * 7 * day)
    const times = sessionDates.map(d => new Date(d).getTime()).filter(t => Number.isFinite(t))
    const counts = starts.map(s => times.filter(t => t >= s && t < s + 7 * day).length)
    let streak = 0
    for (let i = counts.length - 1; i >= 0; i--) {
      if (counts[i] > 0) streak++
      else if (i === counts.length - 1) continue
      else break
    }
    return { buckets: counts, starts, streak, thisWeek: counts[counts.length - 1] }
  }, [sessionDates])

  if (pastCount === 0) return null
  const maxBar = Math.max(...buckets, 1)
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">Range activity</p>
      <p className="text-3xl font-bold tabular-nums mt-1">{pastCount} <span className="text-lg font-semibold">session{pastCount !== 1 ? 's' : ''}</span></p>
      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 tabular-nums">
        {lifetimeFired.toLocaleString()} rds fired{streak > 0 ? ` · ${streak}-wk streak` : ''} · {thisWeek} this week
      </p>
      {lastEnded && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 truncate">
          Last: {lastWhen ?? 'past session'}{lastRounds != null ? ` · ${lastRounds.toLocaleString()} rds` : ''}{lastGuns.length > 0 ? ` · ${lastGuns.slice(0, 2).join(', ')}${lastGuns.length > 2 ? ` +${lastGuns.length - 2} more` : ''}` : ''}{lastEnded.note ? ` · “${lastEnded.note}”` : ''}
        </p>
      )}
      <div className="mt-4">
        <div>
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-1.5">Sessions per week</p>
          <div className="flex items-end gap-1.5 h-20" role="img" aria-label="Sessions per week, last 8 weeks">
            {buckets.map((c, i) => {
              const s = new Date(starts[i])
              const e = new Date(starts[i] + 6 * 86400000)
              const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              const edge = i === 0 ? 'left-0' : i === buckets.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              return (
                <div key={i} className="flex-1 h-full flex flex-col justify-end relative group">
                  <span className={`pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:block whitespace-nowrap rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[11px] text-neutral-600 dark:text-neutral-300 shadow-md z-10 ${edge}`}>
                    {fmt(s)} – {fmt(e)} · <span className="font-semibold tabular-nums">{c} session{c !== 1 ? 's' : ''}</span>
                  </span>
                  <div className={`w-full rounded-sm ${c > 0 ? 'bg-blue-600 dark:bg-blue-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}
                    style={{ height: c > 0 ? `${Math.max(10, Math.round((c / maxBar) * 100))}%` : '4px' }} />
                </div>
              )
            })}
          </div>
          <div className="flex gap-1.5 mt-1" aria-hidden="true">
            {starts.map((s, i) => {
              const d = new Date(s)
              const label = `${d.getMonth() + 1}/${d.getDate()}`
              const current = i === starts.length - 1
              return (
                <span key={i} className={`flex-1 text-center text-[10px] tabular-nums whitespace-nowrap ${current ? 'font-semibold text-neutral-700 dark:text-neutral-300' : 'text-neutral-400 dark:text-neutral-500'}`}>
                  {label}
                </span>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button onClick={onViewRange} className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 underline cursor-pointer">All sessions →</button>
      </div>
    </div>
  )
}

function LastBackupWidget({ onOpen }: { onOpen: () => void }) {
  const [record, setRecord] = useState<BackupRecord | null>(getLastBackup)
  useEffect(() => {
    const refresh = () => setRecord(getLastBackup())
    window.addEventListener(BACKUP_EVENT, refresh)
    return () => window.removeEventListener(BACKUP_EVENT, refresh)
  }, [])
  const stale = record ? (Date.now() - new Date(record.at).getTime()) > 30 * 86400000 : false
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3 mt-3 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full shrink-0 ${record == null || stale ? 'bg-amber-500' : 'bg-green-600'}`} />
      <span className="min-w-0">
        <span className="block text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">Last backup</span>
        <span className="block text-sm font-semibold truncate mt-0.5">
          {record == null
            ? 'Never backed up'
            : `${new Date(record.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${record.kind === 'export' ? 'exported' : 'restored'}`}
        </span>
        <span className="block text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 truncate">
          {record == null ? 'Protect your data — back up now' : record.summary}
        </span>
      </span>
      <span className="ml-auto text-neutral-300 dark:text-neutral-600 shrink-0">›</span>
    </button>
  )
}

function InventoryDashboard({ inventory, weapons, totals, cleanings, activeSession, stagedPacks, lastEnded, pastCount, sessionDates, onResume, onStartPack, onReviewPacks, onViewRange, onViewBackup, onCaliberClick, onWeaponClick, onViewAmmo, onViewWeapons }: {
  inventory: InventoryItem[]; weapons: Weapon[]; totals: Record<number, number>; cleanings: Record<number, WeaponCleaning[]>
  activeSession: RangeDaySession | null
  stagedPacks: { id: number; note: string | null }[]
  lastEnded: { id: number; note: string | null; startedAt: string | null; endedAt: string | null } | null
  pastCount: number
  sessionDates: string[]
  onResume: () => void
  onStartPack: (id: number) => void
  onReviewPacks: (id: number) => void
  onViewRange: () => void
  onViewBackup: () => void
  onCaliberClick: (group: CaliberGroup) => void
  onWeaponClick: (weaponId: number) => void
  onViewAmmo: () => void; onViewWeapons: () => void
}) {
  const totalRounds = useMemo(() => inventory.reduce((s, i) => s + i.balance, 0), [inventory])
  const lifetimeFired = useMemo(() => Object.values(totals).reduce((s, n) => s + n, 0), [totals])
  const topWeapon = useMemo(() => {
    if (weapons.length === 0) return null
    return [...weapons].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))[0]
  }, [weapons, totals])
  const topCaliber = useMemo<CaliberGroup | null>(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const item of inventory) {
      const arr = map.get(item.caliber) ?? []
      arr.push(item)
      map.set(item.caliber, arr)
    }
    let best: CaliberGroup | null = null
    for (const [caliber, items] of map) {
      const g = { caliber, items, totalBalance: items.reduce((sum, i) => sum + i.balance, 0) }
      if (!best || g.totalBalance > best.totalBalance) best = g
    }
    return best
  }, [inventory])
  const cleaningDue = useMemo(() => {
    let c = 0
    for (const w of weapons) {
      const total = totals[w.id] ?? 0
      const cls = cleanings[w.id] ?? []
      const latest = cls[0] ?? null
      const baselineRounds = latest?.roundCountAtCleaning ?? 0
      const baselineDate = latest ? new Date(latest.cleanedAt) : new Date(w.createdAt)
      const roundsSince = Math.max(0, total - baselineRounds)
      const daysSince = Math.max(0, Math.floor((Date.now() - baselineDate.getTime()) / 86400000))
      const rInt = w.cleaningIntervalRounds
      const dInt = w.cleaningIntervalDays
      if ((rInt != null && rInt - roundsSince <= 0) || (dInt != null && dInt - daysSince <= 0)) c++
    }
    return c
  }, [weapons, totals, cleanings])

  return (
    <div>
      {activeSession && (
        <div className="mb-4">
          <LiveRangeCard session={activeSession} onResume={onResume} />
        </div>
      )}
      {stagedPacks.length > 0 && (
        <div className="flex flex-col gap-3 mb-6">
          {stagedPacks.map(p => (
            <StagedHomeCard key={p.id} pack={p} hasActive={activeSession != null} onStart={onStartPack} onReview={onReviewPacks} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button type="button" onClick={onViewAmmo}
          className="text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer">
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">Rounds</p>
          <p className="text-2xl font-bold tabular-nums mt-0.5">{totalRounds >= 1000 ? `${(totalRounds / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${totalRounds}`}</p>
        </button>
        <button type="button" onClick={onViewWeapons}
          className="text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer">
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">Guns</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-2xl font-bold tabular-nums">{weapons.length}</p>
            {cleaningDue > 0 && (
              <>
                <span className="w-px h-6 bg-neutral-200 dark:bg-neutral-700 shrink-0" aria-hidden="true" />
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 rounded-lg px-2 py-1">
                  <TabIcon name="alert" size={14} /> {cleaningDue} to clean
                </span>
              </>
            )}
          </div>
        </button>
      </div>

      <RangeActivityCard
        pastCount={pastCount}
        lifetimeFired={lifetimeFired}
        sessionDates={sessionDates}
        lastEnded={lastEnded}
        onViewRange={onViewRange}
      />

      {(topWeapon || topCaliber) && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {topWeapon && (
            <button type="button" onClick={() => onWeaponClick(topWeapon.id)}
              className="text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide truncate">Top weapon</p>
                <span className="ml-auto text-neutral-300 dark:text-neutral-600 shrink-0">›</span>
              </div>
              <p className="text-base font-bold truncate mt-0.5">{topWeapon.name}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 tabular-nums">{(totals[topWeapon.id] ?? 0).toLocaleString()} rds fired</p>
            </button>
          )}
          {topCaliber && (
            <button type="button" onClick={() => onCaliberClick(topCaliber)}
              className="text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide truncate">Top caliber</p>
                <span className="ml-auto text-neutral-300 dark:text-neutral-600 shrink-0">›</span>
              </div>
              <p className="text-base font-bold truncate mt-0.5">{topCaliber.caliber}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5 tabular-nums">{topCaliber.totalBalance.toLocaleString()} rds stored</p>
            </button>
          )}
        </div>
      )}

      <LastBackupWidget onOpen={onViewBackup} />
    </div>
  )
}

function RangeDayDetailDrawer({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [txs, setTxs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiFetch(`/ammo/range-days/${sessionId}`).then(r => r.ok ? r.json() : null),
      apiFetch(`/ammo/range-days/${sessionId}/transactions`).then(r => r.ok ? r.json() : []),
      apiFetch('/ammo/types').then(r => r.ok ? r.json() : []),
    ]).then(([d, t, a]) => {
      if (cancelled) return
      setDetail(d)
      setTxs(Array.isArray(t) ? t : [])
      setAmmoTypes(Array.isArray(a) ? a : [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [sessionId])

  const typeById = useMemo(() => new Map(ammoTypes.map(t => [t.id, t])), [ammoTypes])

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl p-6">Loading session…</div>
    </div>
  )
  if (!detail) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl p-6">Not found <button onClick={onClose} className="ml-4 text-sm underline cursor-pointer">Close</button></div>
    </div>
  )

  const started = detail.startedAt ? new Date(detail.startedAt) : null
  const ended = detail.endedAt ? new Date(detail.endedAt) : null
  const mins = ended && started ? Math.round((ended.getTime() - started.getTime()) / 60000) : null
  const duration = mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : started ? 'In progress' : 'Not started'
  const strings: any[] = detail.strings ?? []
  const totalFired = strings.reduce((s: number, x: any) => s + (x.rounds ?? 0), 0)
  const byWeapon = new Map<number, number>()
  const byAmmo = new Map<number, number>()
  for (const s of strings) {
    byWeapon.set(s.weaponId, (byWeapon.get(s.weaponId) ?? 0) + s.rounds)
    byAmmo.set(s.ammoTypeId, (byAmmo.get(s.ammoTypeId) ?? 0) + s.rounds)
  }
  const sessionCostCents = txs.filter((t: any) => t.rangeDaySessionId === sessionId && t.price != null).reduce((s: number, t: any) => s + t.price, 0)
  const acquired = txs.filter((t: any) => t.type === 'acquisition' && t.rangeDaySessionId === sessionId)
  const bag: any[] = detail.bag ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 max-w-2xl w-full my-8">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{started ? started.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Staged pack'} · {duration}</h3>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{started ? started.toLocaleString() : 'Clock starts on Start range day'}{ended ? ` → ${ended.toLocaleString()}` : ''}</p>
              {detail.note && <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 italic">“{detail.note}”</p>}
            </div>
            <button onClick={onClose} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 text-xl leading-none cursor-pointer">×</button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3 text-center">
              <p className="text-2xl font-bold">{totalFired.toLocaleString()}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">rds fired</p>
            </div>
            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3 text-center">
              <p className="text-2xl font-bold">{detail.weapons?.length ?? 0}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">weapons</p>
            </div>
            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3 text-center">
              <p className="text-2xl font-bold">{sessionCostCents ? `$${(sessionCostCents / 100).toFixed(2)}` : '—'}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">on-site cost</p>
            </div>
          </div>

          {byWeapon.size > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Per weapon</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...byWeapon.entries()].map(([wid, rds]) => {
                  const w = detail.weapons?.find((x: any) => x.id === wid)
                  return <span key={wid} className="text-xs px-2.5 py-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-full">{w?.name ?? `Weapon #${wid}`} — <span className="font-semibold">{rds}</span> rds</span>
                })}
              </div>
            </div>
          )}

          {byAmmo.size > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Per ammo</p>
              <div className="mt-2 space-y-2">
                {[...byAmmo.entries()].map(([aid, rds]) => {
                  const t = typeById.get(aid)
                  const avg = t ? null : null
                  return (
                    <div key={aid} className="flex justify-between items-center text-sm border border-neutral-100 dark:border-neutral-800 rounded-lg px-3 py-2">
                      <span className="font-medium">{t?.name ?? `Type #${aid}`} <span className="text-neutral-400 dark:text-neutral-500 font-normal">· {t?.caliber ?? ''} · {rds} rds fired</span></span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {acquired.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Acquired on-site</p>
              <div className="mt-2 space-y-1">
                {acquired.map((tx: any) => {
                  const entry = tx.entries?.find((e: any) => !e.isBalancing)
                  const t = entry ? typeById.get(entry.ammoTypeId) : null
                  const qty = entry ? Math.abs(entry.quantity) : 0
                  const perRd = qty > 0 && tx.price != null ? (tx.price / qty / 100) : null
                  return (
                    <div key={tx.id} className="flex justify-between items-center text-sm border border-green-100 bg-green-50 rounded-lg px-3 py-2">
                      <span>{t?.name ?? `Type #${entry?.ammoTypeId}`} +{qty} rds</span>
                      <span className="tabular-nums font-medium">{tx.price != null ? `$${(tx.price / 100).toFixed(2)}` : '—'}{perRd != null ? <span className="text-neutral-500 dark:text-neutral-400 font-normal"> (${perRd.toFixed(2)}/rd)</span> : null}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">Price shown is total paid for that acquisition; per-round is price ÷ quantity. Avg $/round in Inventory is lifetime avg across all acquisitions where price was tracked.</p>
            </div>
          )}

          <div className="mt-6">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Strings</p>
            {strings.length === 0 ? (
              <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-2">No shots recorded.</p>
            ) : (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {strings.map((s: any) => {
                  const w = detail.weapons?.find((x: any) => x.id === s.weaponId)
                  const t = typeById.get(s.ammoTypeId)
                  return <div key={s.id} className="flex justify-between text-sm border-b border-neutral-50 py-1"><span>{w?.name ?? `W#${s.weaponId}`} · {t?.name ?? `A#${s.ammoTypeId}`} — {s.rounds} rds {s.note ? `“${s.note}”` : ''}</span><span className="text-xs text-neutral-400 dark:text-neutral-500">{new Date(s.occurredAt).toLocaleTimeString()}</span></div>
                })}
              </div>
            )}
          </div>

          {bag.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{detail.endedAt ? 'Returned to storage' : 'Bag at end'}</p>
              <div className="mt-2 space-y-1">
                {bag.map((b: any) => {
                  const t = typeById.get(b.ammoTypeId)
                  const fired = strings.filter((s: any) => s.ammoTypeId === b.ammoTypeId).reduce((acc: number, s: any) => acc + (s.rounds ?? 0), 0)
                  const isEnded = !!detail.endedAt
                  if (isEnded) {
                    const returned = Math.max(0, b.taken + b.acquired - fired)
                    return <div key={b.ammoTypeId} className="flex justify-between text-sm border border-neutral-100 dark:border-neutral-800 rounded-lg px-3 py-2"><span>{t?.name ?? `Type #${b.ammoTypeId}`}</span><span className="tabular-nums text-neutral-500 dark:text-neutral-400">{returned} returned{fired > 0 ? `, ${fired} fired` : ''} (took {b.taken}{b.acquired > 0 ? ` +${b.acquired} on-site` : ''})</span></div>
                  }
                  return <div key={b.ammoTypeId} className="flex justify-between text-sm border border-neutral-100 dark:border-neutral-800 rounded-lg px-3 py-2"><span>{t?.name ?? `Type #${b.ammoTypeId}`}</span><span className="tabular-nums text-neutral-500 dark:text-neutral-400">{b.inBag} in bag (took {b.taken}{b.acquired > 0 ? ` +${b.acquired} on-site` : ''}{fired > 0 ? `, ${fired} fired` : ''})</span></div>
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-6">
            <button onClick={onClose} className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm cursor-pointer">Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RangeDaysTab({ onPack, onEdit, onRecap, hasActive, refreshKey = 0, onChanged }: { onPack: () => void; onEdit: (init: StageInitial) => void; onRecap: (id: number) => void; hasActive: boolean; refreshKey?: number; onChanged?: () => void }) {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [stageDetail, setStageDetail] = useState<Record<number, any>>({})

  const load = () => {
    setLoading(true)
    apiFetch('/ammo/range-days')
      .then(r => r.ok ? r.json() : [])
      .then((arr: any[]) => setSessions(Array.isArray(arr) ? arr.sort((a, b) => (new Date(b.startedAt ?? 0).getTime() || 0) - (new Date(a.startedAt ?? 0).getTime() || 0)) : []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [refreshKey])
  useEffect(() => {
    apiFetch('/ammo/types').then(r => r.ok ? r.json() : []).then(t => setAmmoTypes(Array.isArray(t) ? t : [])).catch(() => {})
  }, [])
  const stagedIds = sessions.filter((s: any) => s.status === 'staged').map((s: any) => s.id).sort().join(',')
  useEffect(() => {
    const ids = sessions.filter((s: any) => s.status === 'staged').map((s: any) => s.id)
    ids.forEach((id: number) => {
      if (stageDetail[id] !== undefined) return
      apiFetch(`/ammo/range-days/${id}`).then(r => r.ok ? r.json() : null).then(d => {
        if (d) setStageDetail(prev => ({ ...prev, [id]: d }))
      }).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedIds])
  const typeById = new Map(ammoTypes.map(t => [t.id, t]))

  const deleteStaged = async (id: number) => {
    if (!confirm('Delete this staged pack list? Nothing has left storage.')) return
    const res = await apiFetch(`/ammo/range-days/${id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setActionError(d.error || 'Could not delete'); return }
    load()
    onChanged?.()
  }
  const editStaged = async (id: number) => {
    setActionError('')
    const res = await apiFetch(`/ammo/range-days/${id}`)
    if (!res.ok) { setActionError('Could not load pack list'); return }
    onEdit(packDetailToInit(id, await res.json()))
  }

  const staged = sessions.filter((s: any) => s.startedAt == null)
  const past = sessions.filter((s: any) => s.startedAt != null)

  if (viewingId != null) return <RangeDayDetailDrawer sessionId={viewingId} onClose={() => setViewingId(null)} />

  return (
    <div>
      {staged.length > 0 && (
        <div className="mb-6 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4">
          <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">Stage at home</p>
          <div className="space-y-3">
            {staged.map((s: any) => {
              const d = stageDetail[s.id]
              const guns = (d?.weapons ?? []).map((w: any) => w.name ?? `Gun #${w.id}`)
              const ammo = (d?.bag ?? []).map((b: any) => ({ name: typeById.get(b.ammoTypeId)?.name ?? `Type #${b.ammoTypeId}`, qty: b.inBag ?? b.taken ?? b.quantity ?? 0 }))
              return (
              <div key={s.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{s.note || 'Untitled pack'}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">Staged</span>
                </div>
                {d == null ? (
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">Loading pack…</p>
                ) : (
                  <>
                    {guns.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {guns.map((g: string, i: number) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">{g}</span>
                        ))}
                      </div>
                    )}
                    {ammo.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {ammo.map((a: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-neutral-600 dark:text-neutral-400 truncate">{a.name}</span>
                            <span className="tabular-nums text-neutral-700 dark:text-neutral-300 ml-2 shrink-0">{a.qty.toLocaleString()} rds</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {guns.length === 0 && ammo.length === 0 && (
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">Empty pack — edit to add guns and ammo.</p>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => onRecap(s.id)} disabled={hasActive} title={hasActive ? 'End the current range day first' : undefined}
                    className="text-xs px-3 py-1.5 bg-black text-white rounded-lg cursor-pointer hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed">Start range day</button>
                  <button onClick={() => editStaged(s.id)} className="text-xs px-3 py-1.5 border border-neutral-300 dark:border-neutral-600 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">Edit</button>
                  <button onClick={() => deleteStaged(s.id)} className="text-xs px-3 py-1.5 border border-neutral-300 dark:border-neutral-600 rounded-lg cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Delete</button>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}
      {actionError && <p className="text-red-500 text-sm mb-3">{actionError}</p>}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Past Range Days</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 dark:text-neutral-500">{past.length} session{past.length !== 1 ? 's' : ''}</span>
          <button onClick={onPack} className="text-xs px-3 py-1.5 bg-black text-white rounded-lg cursor-pointer hover:opacity-80">+ Pack for later</button>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">Loading…</p>
      ) : staged.length === 0 && past.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No range days yet — start one from the dashboard header.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {past.map(s => {
            const started = new Date(s.startedAt)
            const ended = s.endedAt ? new Date(s.endedAt) : null
            const mins = ended ? Math.round((ended.getTime() - started.getTime()) / 60000) : null
            const duration = mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : 'In progress'
            const isActive = s.startedAt != null && s.endedAt == null
            return (
              <button key={s.id} onClick={() => setViewingId(s.id)} className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{started.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {duration}</p>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{started.toLocaleString()}{ended ? ` → ${ended.toLocaleString()}` : ''}</p>
                    {s.note && <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 italic">“{s.note}”</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'}`}>{isActive ? 'Active' : 'Completed'}</span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-3">View details →</p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExportImportTab({ onImported }: { onImported?: () => void }) {
  const [preview, setPreview] = useState<any>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setStatus('')
    const res = await apiFetch('/export')
    if (!res.ok) { const d = await res.json().catch(() => ({ error: 'Failed' })); setStatus(d.error || 'Export failed'); return }
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ay-armory-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setStatus(`Exported ${data.weapons?.length ?? 0} weapons, ${data.ammoTypes?.length ?? 0} ammo types, ${data.weaponCleanings?.length ?? 0} cleanings, ${data.ammoTransactions?.length ?? 0} transactions`)
    recordBackup('export', `${data.weapons?.length ?? 0} guns · ${data.ammoTypes?.length ?? 0} types · ${data.ammoTransactions?.length ?? 0} transactions`)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      if (!json.version) throw new Error('Invalid backup: missing version')
      setPreview(json)
      setStatus('')
    } catch (err: any) {
      setStatus(err.message || 'Invalid JSON')
      setPreview(null)
    }
  }

  const handleImport = async () => {
    if (!preview) return
    setBusy(true)
    setStatus('')
    const res = await apiFetch('/import', {
      method: 'POST',
      body: JSON.stringify({ ...preview, mode }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setStatus(d.error || 'Import failed'); return }
    setStatus(`Imported — weapons: ${d.imported?.weapons ?? 0}, ammoTypes: ${d.imported?.ammoTypes ?? 0}, cleanings: ${d.imported?.weaponCleanings ?? 0}, sessions: ${d.imported?.rangeDaySessions ?? 0}, txs: ${d.imported?.transactions ?? 0} (${mode})`)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
    recordBackup('import', `restored ${d.imported?.weapons ?? 0} guns · ${d.imported?.ammoTypes ?? 0} types (${mode})`)
    onImported?.()
  }

  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Backup & Restore</h3>
      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Export a versioned JSON backup to move to a new phone/app, then restore it into another account. Includes weapons, cleanings (history), ammo types, transactions, range days — prices stored as dollars.</p>

      <div className="mt-6 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
        <h4 className="text-sm font-semibold">Export</h4>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Downloads <span className="font-mono">ay-armory-backup-YYYY-MM-DD.json</span> (version 1, includes cleaning history for export).</p>
        <button onClick={handleExport} className="mt-3 px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Download Backup JSON</button>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5">
        <h4 className="text-sm font-semibold">Restore (Import)</h4>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Pick a backup JSON exported from another account. Choose Merge (skip dupes) or Replace (wipe then restore).</p>
        <div className="flex gap-2 mt-3">
          <label className={`flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${mode === 'merge' ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700'}`}>
            <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="accent-black" />
            <span className="text-sm">Merge</span>
          </label>
          <label className={`flex-1 flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${mode === 'replace' ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700'}`}>
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-black" />
            <span className="text-sm">Replace</span>
          </label>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="mt-3 w-full text-sm" />
        {preview && (
          <div className="mt-3 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3 text-xs">
            <p className="font-semibold">Preview — v{preview.version} exported {preview.exportedAt ? new Date(preview.exportedAt).toLocaleString() : ''}</p>
            <p className="text-neutral-500 dark:text-neutral-400 mt-1">{preview.weapons?.length ?? 0} weapons · {preview.weaponCleanings?.length ?? 0} cleanings · {preview.ammoTypes?.length ?? 0} ammo types · {preview.ammoTransactions?.length ?? 0} transactions · {preview.rangeDaySessions?.length ?? 0} range days</p>
            <button onClick={handleImport} disabled={busy} className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40 cursor-pointer">{busy ? 'Importing…' : `Import as ${mode}`}</button>
          </div>
        )}
        {status && <p className="text-xs mt-3 tabular-nums whitespace-pre-wrap border-t border-neutral-100 dark:border-neutral-800 pt-3">{status}</p>}
      </div>
    </div>
  )
}

// ── Dashboard View ────────────────────────────────────────────────────────

type QuickAction = 'acquire' | 'expend' | 'adjust' | 'new-type' | null


// ── Bottom TabBar (openGym-style) ─────────────────────────────────────────
// Fixed bottom nav: Home | Range | (O) Start | Ammo | Guns.
// Sub-pages keep their parent lit (backup → home), like openGym's
// settings → home mapping. The live RangeDayView is full-screen so the
// bar never needs a body.no-tabbar mode.

function TabElapsed({ start }: { start: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = Math.max(0, Date.now() - new Date(start).getTime())
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const mm = h > 0 ? String(m % 60).padStart(2, '0') : String(m)
  const hh = h > 0 ? `${h}:` : ''
  return <span className="tab-time">{hh}{mm}</span>
}

// Hand-drawn stroke icons on a 24×24 grid (openGym convention):
// strokes only, round caps/joins, width from --icon-stroke, live area 3…21.
function TabIcon({ name, size = 25 }: { name: 'home' | 'range' | 'play' | 'ammo' | 'guns' | 'gear' | 'alert'; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: <path d="M3.5 10.7 12 3.8l8.5 6.9M5.9 9.4V19a1.4 1.4 0 0 0 1.4 1.4h9.4A1.4 1.4 0 0 0 18.1 19V9.4" />,
    range: <><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" /></>,
    play: <path d="M8.4 5.6 18 12l-9.6 6.4Z" />,
    ammo: <><path d="M3.5 7.5 12 3.5l8.5 4v9l-8.5 4-8.5-4Z" /><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" /></>,
    guns: <><path d="M2.5 8.5h15v3.5h-15Z" /><path d="M5.5 8.5V6.8M14.5 8.5V6.8" /><path d="M13 12l-1.5 8h4L17.5 12" /><path d="M8.5 12v1.8c0 1.6 1.1 2.7 2.7 2.7H13" /></>,
    alert: <><path d="M12 3.5 21 20H3Z" /><path d="M12 9.5v4.5" /><circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" /></>,
    gear: <><path d="M20.48 10.59 20.48 13.41 18.58 13.72 17.87 15.43 19 17 17 19 15.43 17.87 13.72 18.58 13.41 20.48 10.59 20.48 10.28 18.58 8.57 17.87 7 19 5 17 6.13 15.43 5.42 13.72 3.52 13.41 3.52 10.59 5.42 10.28 6.13 8.57 5 7 7 5 8.57 6.13 10.28 5.42 10.59 3.52 13.41 3.52 13.72 5.42 15.43 6.13 17 5 19 7 17.87 8.57 18.58 10.28Z" /><circle cx="12" cy="12" r="3.1" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="var(--icon-stroke, 1.65)" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function TabButton({ active, icon, label, dot, onClick }: {
  active: boolean; icon: 'home' | 'range' | 'ammo' | 'guns'; label: string; dot?: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}>
      <span className="tab-ic"><span className="icn" aria-hidden="true"><TabIcon name={icon} /></span>{dot && <span className="tab-dot" aria-hidden="true" />}</span>
      <span>{label}</span>
    </button>
  )
}

function BottomTabBar({ tab, activeSession, stagedCount, cleaningDue, onGo, onStart, onResume }: {
  tab: TabKey
  activeSession: RangeDaySession | null
  stagedCount: number
  cleaningDue: number
  onGo: (tab: TabKey) => void
  onStart: () => void
  onResume: () => void
}) {
  // Backup lives under Home — keep Home lit there.
  const on = (k: TabKey) => tab === k || (tab === 'backup' && k === 'home')
  const running = !!activeSession?.startedAt
  const staged = !activeSession && stagedCount > 0
  return (
    <nav id="tabbar" aria-label="Primary">
      <TabButton active={on('home')} icon="home" label="Home" onClick={() => onGo('home')} />
      <TabButton active={on('range')} icon="range" label="Range" dot={stagedCount > 0} onClick={() => onGo('range')} />
      <button type="button" className={'start' + (activeSession ? ' rec' : '') + (staged ? ' staged' : '')} onClick={running ? onResume : onStart} aria-label={running ? 'Resume range day' : staged ? 'Start staged range day' : 'Start range day'}>
        <span className="cir"><span className="icn" aria-hidden="true"><TabIcon name="play" /></span></span>
        <span>{activeSession ? 'Resume' : 'Start'}</span>
      </button>
      <TabButton active={on('ammo')} icon="ammo" label="Ammo" onClick={() => onGo('ammo')} />
      <TabButton active={on('guns')} icon="guns" label="Guns" dot={cleaningDue > 0} onClick={() => onGo('guns')} />
    </nav>
  )
}


function DashboardView({ user, onLogout, onRangeDayStart, activeSession, onResumeRangeDay, onStartRangeDay, onPackRangeDay, onEditStaged, theme, onToggleTheme }: {
  user: User
  onLogout: () => void
  onRangeDayStart: (session: RangeDaySession) => void
  activeSession: RangeDaySession | null
  onResumeRangeDay: () => void
  onStartRangeDay: () => void
  onPackRangeDay: () => void
  onEditStaged: (init: StageInitial) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<QuickAction>(null)
  const [showPpr, setShowPpr] = useState(false)
  const [tab, setTab] = useState<TabKey>('home')
  const [viewingCaliberName, setViewingCaliberName] = useState<string | null>(null)
  const [viewingWeaponId, setViewingWeaponId] = useState<number | null>(null)
  const [viewingAmmoId, setViewingAmmoId] = useState<number | null>(null)
  const routeRef = useRef('')
  const go = (p: { tab?: TabKey; caliber?: string | null; weaponId?: number | null; ammoId?: number | null }) => {
    const next = {
      tab,
      caliber: viewingCaliberName,
      weaponId: viewingWeaponId,
      ammoId: viewingAmmoId,
      ...p,
    }
    setTab(next.tab)
    setViewingCaliberName(next.caliber)
    setViewingWeaponId(next.weaponId)
    setViewingAmmoId(next.ammoId)
    const h = encodeRoute(next)
    routeRef.current = h
    if (window.location.hash !== h) window.location.hash = h
  }
  useEffect(() => {
    const apply = (h: string) => {
      if (h === routeRef.current) return
      routeRef.current = h
      const r = decodeRoute(h)
      setTab(r.tab as typeof tab)
      setViewingCaliberName(r.caliber)
      setViewingWeaponId(r.weaponId)
      setViewingAmmoId(r.ammoId)
    }
    apply(window.location.hash || '#/home')
    const onHash = () => apply(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [txRefreshKey, setTxRefreshKey] = useState(0)
  const [stagedPacks, setStagedPacks] = useState<{ id: number; note: string | null }[]>([])
  const [lastEnded, setLastEnded] = useState<{ id: number; note: string | null; startedAt: string | null; endedAt: string | null } | null>(null)
  const [pastCount, setPastCount] = useState(0)
  const [sessionDates, setSessionDates] = useState<string[]>([])
  const [recapPackId, setRecapPackId] = useState<number | null>(null)
  useEffect(() => {
    apiFetch('/ammo/range-days')
      .then(r => r.ok ? r.json() : [])
      .then((arr: any[]) => {
        if (!Array.isArray(arr)) { setStagedPacks([]); setLastEnded(null); setPastCount(0); setSessionDates([]); return }
        setStagedPacks(arr.filter((s: any) => s.startedAt == null).map((s: any) => ({ id: s.id, note: s.note ?? null })))
        const started = arr.filter((s: any) => s.startedAt != null)
        setPastCount(started.length)
        setSessionDates(started.map((s: any) => s.startedAt).filter((d: unknown): d is string => typeof d === 'string'))
        const ended = started
          .filter((s: any) => s.endedAt != null)
          .sort((a: any, b: any) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
        setLastEnded(ended.length > 0 ? { id: ended[0].id, note: ended[0].note ?? null, startedAt: ended[0].startedAt, endedAt: ended[0].endedAt } : null)
      })
      .catch(() => {})
  }, [txRefreshKey, activeSession])
  const [weaponTotals, setWeaponTotals] = useState<Record<number, number>>({})
  const [weaponCleanings, setWeaponCleanings] = useState<Record<number, WeaponCleaning[]>>({})

  // Derive the current CaliberGroup from live inventory so balance cards stay
  // up to date whenever loadInventory() resolves after a quick action.
  const viewingCaliber = useMemo<CaliberGroup | null>(() => {
    if (!viewingCaliberName) return null
    const items = inventory.filter(i => i.caliber === viewingCaliberName)
    if (items.length === 0) return null
    return {
      caliber: viewingCaliberName,
      items,
      totalBalance: items.reduce((sum, i) => sum + i.balance, 0),
    }
  }, [viewingCaliberName, inventory])

  const viewingWeapon = viewingWeaponId != null
    ? weapons.find(w => w.id === viewingWeaponId) ?? null
    : null

  const ammoGroups = useMemo<CaliberGroup[]>(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const item of inventory) {
      const arr = map.get(item.caliber) ?? []
      arr.push(item)
      map.set(item.caliber, arr)
    }
    return [...map.entries()].map(([caliber, items]) => ({
      caliber, items, totalBalance: items.reduce((sum, i) => sum + i.balance, 0),
    }))
  }, [inventory])

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true)
    const safeJson = async (res: Response, fallback: unknown) => {
      if (!res.ok) return fallback
      try { return await res.json() } catch { return fallback }
    }
    const [invRes, typesRes, weaponsRes] = await Promise.all([
      apiFetch('/ammo/inventory'),
      apiFetch('/ammo/types'),
      apiFetch('/weapons'),
    ])
    setInventory(await safeJson(invRes, []))
    setAmmoTypes(await safeJson(typesRes, []))
    setWeapons(await safeJson(weaponsRes, []))
    setInventoryLoading(false)
  }, [])

  useEffect(() => { loadInventory() }, [loadInventory])

  useEffect(() => {
    let cancelled = false
    apiFetch('/weapons/firing-summary')
      .then(r => r.ok ? r.json() : [])
      .then((arr: { weaponId: number; totalRounds: number }[]) => {
        if (cancelled) return
        const m: Record<number, number> = {}
        for (const t of arr) m[t.weaponId] = t.totalRounds
        setWeaponTotals(m)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [weapons.length])

  useEffect(() => {
    if (weapons.length === 0) return
    let cancelled = false
    Promise.all(weapons.map(w => apiFetch(`/weapons/${w.id}/cleanings`).then(r => r.ok ? r.json() : []).then((arr: WeaponCleaning[]) => ({ id: w.id, arr })).catch(() => ({ id: w.id, arr: [] as WeaponCleaning[] }))))
      .then(results => {
        if (cancelled) return
        const m: Record<number, WeaponCleaning[]> = {}
        for (const r of results) m[r.id] = r.arr
        setWeaponCleanings(m)
      })
    return () => { cancelled = true }
  }, [weapons])

  const handleActionSuccess = () => {
    setActiveAction(null)
    loadInventory()
    setTxRefreshKey(k => k + 1)
  }

  // Reload a staged pack into the wizard at the review step ("reload it and
  // hit start"). Falls back to the Range tab if the pack won't load.
  const reviewPack = async (id: number) => {
    const res = await apiFetch(`/ammo/range-days/${id}`)
    if (!res.ok) { go({ tab: 'range', caliber: null, weaponId: null, ammoId: null }); return }
    onEditStaged(packDetailToInit(id, await res.json()))
  }

  const handleAddAmmo = async (rows: AddAmmoRow[], note: string) => {
    for (const r of rows) {
      if (r.kind === 'existing') {
        await apiFetch('/ammo/transactions', {
          method: 'POST',
          body: JSON.stringify({
            type: 'acquisition',
            occurredAt: new Date().toISOString(),
            note: note || null,
            ...(r.price ? { price: Math.round(Number(r.price) * 100) } : {}),
            entries: [{ ammoTypeId: r.ammoTypeId, quantity: r.quantity }],
          }),
        })
      } else {
        const res = await apiFetch('/ammo/types', {
          method: 'POST',
          body: JSON.stringify({
            name: r.name,
            caliber: r.caliber,
            ...(r.brand ? { brand: r.brand } : {}),
            ...(r.grain ? { grain: Number(r.grain) } : {}),
          }),
        })
        if (!res.ok) continue
        const t = await res.json()
        await apiFetch('/ammo/transactions', {
          method: 'POST',
          body: JSON.stringify({
            type: 'acquisition',
            occurredAt: new Date().toISOString(),
            note: note || null,
            ...(r.price ? { price: Math.round(Number(r.price) * 100) } : {}),
            entries: [{ ammoTypeId: t.id, quantity: r.quantity }],
          }),
        })
      }
    }
    handleActionSuccess()
  }

  const handleRangeDayStart = (session: RangeDaySession) => {
    setActiveAction(null)
    onRangeDayStart(session)
  }

  const gunsDue = useMemo(() => {
    let c = 0
    for (const w of weapons) {
      const total = weaponTotals[w.id] ?? 0
      const cls = weaponCleanings[w.id] ?? []
      const latest = cls[0] ?? null
      const baselineRounds = latest?.roundCountAtCleaning ?? 0
      const baselineDate = latest ? new Date(latest.cleanedAt) : new Date(w.createdAt)
      const roundsSince = Math.max(0, total - baselineRounds)
      const daysSince = Math.max(0, Math.floor((Date.now() - baselineDate.getTime()) / 86400000))
      if ((w.cleaningIntervalRounds != null && w.cleaningIntervalRounds - roundsSince <= 0) || (w.cleaningIntervalDays != null && w.cleaningIntervalDays - daysSince <= 0)) c++
    }
    return c
  }, [weapons, weaponTotals, weaponCleanings])

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
          <h1 className="text-xl font-bold tracking-tight">ay-armory</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-500 dark:text-neutral-400 hidden sm:inline">{user.email}</span>
            <button onClick={() => setShowPpr(true)} title="PPR calculator"
              className="h-9 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
              PPR
            </button>
            <button onClick={() => go({ tab: 'backup', caliber: null, weaponId: null, ammoId: null })} title="Backup & settings"
              className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors flex items-center justify-center">
              <TabIcon name="gear" size={18} />
            </button>
            <button onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors flex items-center justify-center">
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.75 13.1A9.5 9.5 0 1 1 10.9 2.25a7.5 7.5 0 0 0 10.85 10.85Z" /></svg>
              )}
            </button>
            <button onClick={onLogout}
              className="text-sm px-4 py-2 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-8 pb-32">
        {tab === 'home' && viewingWeaponId == null && viewingCaliberName == null && (
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
            Welcome{user.firstName ? `, ${user.firstName}` : ''}
          </h2>
        )}

        {recapPackId != null && (
          <PackRecapSheet
            packId={recapPackId}
            hasActive={activeSession != null}
            onStarted={s => { setRecapPackId(null); onRangeDayStart(s) }}
            onClose={() => setRecapPackId(null)}
            onEdit={init => { setRecapPackId(null); onEditStaged(init) }}
          />
        )}

        {tab === 'home' && (
          viewingWeapon ? (
            <WeaponDetailView
              weaponId={viewingWeapon.id}
              onBack={() => go({ weaponId: null })}
              onRefresh={loadInventory}
            />
          ) : viewingCaliber ? (
            <CaliberDetailView
              group={viewingCaliber}
              refreshKey={txRefreshKey}
              onChanged={handleActionSuccess}
              onBack={() => go({ caliber: null, ammoId: null })}
              onWeaponClick={id => go({ weaponId: id })}
              viewingItemId={viewingAmmoId}
              onViewItem={(id: number | null) => go({ ammoId: id })}
            />
          ) : inventoryLoading ? (
            <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading inventory...</p>
          ) : (
            <InventoryDashboard
              inventory={inventory}
              weapons={weapons}
              totals={weaponTotals}
              cleanings={weaponCleanings}
              activeSession={activeSession}
              stagedPacks={stagedPacks}
              lastEnded={lastEnded}
              pastCount={pastCount}
              sessionDates={sessionDates}
              onResume={onResumeRangeDay}
              onStartPack={setRecapPackId}
              onReviewPacks={reviewPack}
              onViewRange={() => go({ tab: 'range', caliber: null, weaponId: null, ammoId: null })}
              onViewBackup={() => go({ tab: 'backup', caliber: null, weaponId: null, ammoId: null })}
              onCaliberClick={g => go({ caliber: g.caliber })}
              onWeaponClick={id => go({ weaponId: id })}
              onViewAmmo={() => go({ tab: 'ammo', caliber: null, weaponId: null, ammoId: null })}
              onViewWeapons={() => go({ tab: 'guns', caliber: null, weaponId: null, ammoId: null })}
            />
          )
        )}

        {tab === 'ammo' && (
          viewingCaliber ? (
            <CaliberDetailView
              group={viewingCaliber}
              refreshKey={txRefreshKey}
              onChanged={handleActionSuccess}
              onBack={() => go({ caliber: null, ammoId: null })}
              onWeaponClick={id => go({ weaponId: id })}
              viewingItemId={viewingAmmoId}
              onViewItem={(id: number | null) => go({ ammoId: id })}
            />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Your Ammo</h3>
                <button
                  onClick={() => setActiveAction(activeAction === 'acquire' ? null : 'acquire')}
                  className="text-sm px-3 py-1.5 bg-black text-white rounded-lg cursor-pointer hover:opacity-80"
                >
                  + Add Ammo
                </button>
              </div>
              {activeAction === 'acquire' && (
                <div className="mb-6">
                  <AddAmmoModal
                    ammoTypes={ammoTypes}
                    caption="Adds to your inventory."
                    onSubmit={handleAddAmmo}
                    onClose={() => setActiveAction(null)}
                  />
                </div>
              )}
              {inventoryLoading ? (
                <p className="text-neutral-400 dark:text-neutral-500 text-sm">Loading inventory...</p>
              ) : inventory.length === 0 ? (
                <>
                  <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 p-10 text-center">
                    <p className="text-neutral-500 dark:text-neutral-400 mb-4">No ammo types yet — add some to get started.</p>
                    <button
                      onClick={() => setActiveAction(activeAction === 'new-type' ? null : 'new-type')}
                      className={`text-sm px-4 py-2 rounded-lg transition-opacity cursor-pointer ${activeAction === 'new-type' ? 'bg-neutral-600 text-white' : 'bg-black text-white hover:opacity-80'}`}
                    >
                      {activeAction === 'new-type' ? 'Cancel' : '+ New Ammo Type'}
                    </button>
                  </div>
                  {activeAction === 'new-type' && (
                    <QuickForm title="New Ammo Type" onClose={() => setActiveAction(null)}>
                      <NewTypeForm onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
                    </QuickForm>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {ammoGroups.map(group => (
                      <div key={group.caliber} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden flex flex-col">
                        <button
                          onClick={() => go({ caliber: group.caliber })}
                          className="flex-1 p-5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                        >
                          <div className="flex items-start justify-between mb-1">
                            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{group.caliber}</p>
                            <span className="ml-2 shrink-0 text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 px-2 py-0.5 rounded-full">
                              {group.items.length} type{group.items.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className={`text-3xl font-bold mt-2 ${balanceColor(group.totalBalance)}`}>
                            {group.totalBalance.toLocaleString()}
                          </p>
                          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">rounds · tap for details</p>
                        </button>
                        <div className="flex gap-2 px-3 py-3 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800">
                          <button
                            onClick={() => setActiveAction('adjust')}
                            className="flex-1 text-xs px-2 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:border-neutral-400 cursor-pointer"
                          >
                            Adjust
                          </button>
                          <button
                            onClick={() => go({ caliber: group.caliber })}
                            className="flex-1 text-xs px-2 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg hover:border-neutral-400 cursor-pointer"
                          >
                            History
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-6">
                    <button
                      onClick={() => setActiveAction(activeAction === 'expend' ? null : 'expend')}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'expend' ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'}`}
                    >
                      - Expend
                    </button>
                    <button
                      onClick={() => setActiveAction(activeAction === 'adjust' ? null : 'adjust')}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'adjust' ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'}`}
                    >
                      Adjust
                    </button>
                    <button
                      onClick={() => setActiveAction(activeAction === 'new-type' ? null : 'new-type')}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'new-type' ? 'bg-black text-white border-black' : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'}`}
                    >
                      + New Type
                    </button>
                  </div>
                  {activeAction === 'expend' && ammoTypes.length > 0 && (
                    <QuickForm title="Record Expenditure" onClose={() => setActiveAction(null)}>
                      <ExpendForm ammoTypes={ammoTypes} onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
                    </QuickForm>
                  )}
                  {activeAction === 'expend' && ammoTypes.length === 0 && (
                    <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 mt-4">
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">Create an ammo type first.</p>
                    </div>
                  )}
                  {activeAction === 'adjust' && ammoTypes.length > 0 && (
                    <QuickForm title="Adjust Inventory" onClose={() => setActiveAction(null)}>
                      <AdjustForm ammoTypes={ammoTypes} onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
                    </QuickForm>
                  )}
                  {activeAction === 'new-type' && (
                    <QuickForm title="New Ammo Type" onClose={() => setActiveAction(null)}>
                      <NewTypeForm onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
                    </QuickForm>
                  )}
                  <details className="mt-8 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
                    <summary className="px-4 py-3 text-sm font-medium cursor-pointer list-none flex items-center justify-between">
                      <span>Manage types · {ammoTypes.length}</span>
                      <span className="text-neutral-400">›</span>
                    </summary>
                    <div className="px-4 pb-4 border-t border-neutral-100 dark:border-neutral-800 pt-4">
                      <AmmoTypeManager ammoTypes={ammoTypes} onRefresh={loadInventory} />
                    </div>
                  </details>
                </>
              )}
            </div>
          )
        )}

        {tab === 'guns' && (
          viewingWeapon ? (
            <WeaponDetailView
              weaponId={viewingWeapon.id}
              onBack={() => go({ weaponId: null })}
              onRefresh={loadInventory}
            />
          ) : (
            <WeaponManager weapons={weapons} onRefresh={loadInventory} onWeaponClick={id => go({ weaponId: id })} />
          )
        )}

        {tab === 'range' && (
          <div className="flex flex-col gap-10">
            <section>
              <RangeDaysTab onPack={onPackRangeDay} onEdit={onEditStaged} onRecap={setRecapPackId} hasActive={activeSession != null} refreshKey={txRefreshKey} onChanged={() => setTxRefreshKey(k => k + 1)} />
            </section>
            <section>
              <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">History</h3>
              <TransactionHistory ammoTypes={ammoTypes} />
            </section>
          </div>
        )}

        {tab === 'backup' && (
          <div>
            <button onClick={() => go({ tab: 'home', caliber: null, weaponId: null, ammoId: null })} className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer mb-4">← Back to Home</button>
            <ExportImportTab onImported={loadInventory} />
          </div>
        )}
      </main>
      <BottomTabBar
        tab={tab}
        activeSession={activeSession}
        stagedCount={stagedPacks.length}
        cleaningDue={gunsDue}
        onGo={(t) => { setActiveAction(null); go({ tab: t, caliber: null, weaponId: null, ammoId: null }) }}
        onStart={() => { if (stagedPacks.length > 0) setRecapPackId(stagedPacks[0].id); else onStartRangeDay() }}
        onResume={onResumeRangeDay}
      />
      {showPpr && <PprCalculatorModal onClose={() => setShowPpr(false)} />}
    </div>
  )
}

// ── Auth View ─────────────────────────────────────────────────────────────

function AuthView({ onLogin }: { onLogin: (user: User, token: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const endpoint = mode === 'signin' ? '/auth/login' : '/auth/signup'
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      let data: { error?: string; user?: User; token?: string }
      try { data = await res.json() } catch { setError(`Server error (${res.status})`); return }
      if (!res.ok) { setError(data.error || 'Something went wrong'); return }
      onLogin(data.user!, data.token!)
    } catch (err) {
      setError(err instanceof TypeError ? 'Failed to connect to server' : 'Unknown error')
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-80">
        <h1 className="text-2xl font-bold text-center">ay-armory</h1>
        <input type="email" placeholder="Email" value={email} required
          onChange={e => setEmail(e.target.value)} className="px-4 py-2 border rounded-lg" />
        <input type="password" placeholder="Password" value={password} required
          onChange={e => setPassword(e.target.value)} className="px-4 py-2 border rounded-lg" />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit"
          className="text-lg px-8 py-3 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity">
          {mode === 'signin' ? 'Sign In' : 'Sign Up'}
        </button>
        <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
          {mode === 'signin' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
        </button>
      </form>
    </div>
  )
}

// ── App root ──────────────────────────────────────────────────────────────

const APP_TABS = ['home', 'range', 'ammo', 'guns', 'backup'] as const
type TabKey = typeof APP_TABS[number]

// Legacy top-tab hashes map onto the 5 bottom tabs (openGym-style:
// sub-pages keep their parent lit, e.g. backup lights Home).
const LEGACY_TAB_MAP: Record<string, TabKey> = {
  inventory: 'home',
  'range-days': 'range',
  history: 'range',
  ammo: 'ammo',
  types: 'ammo',
  weapons: 'guns',
  home: 'home',
  range: 'range',
  guns: 'guns',
  backup: 'backup',
}

function encodeRoute(r: { tab: string; caliber: string | null; weaponId: number | null; ammoId: number | null }): string {
  const tab = LEGACY_TAB_MAP[r.tab] ?? 'home'
  let h = '#/' + tab
  if ((tab === 'guns') && r.weaponId != null) return h + '/' + r.weaponId
  if (r.caliber) h += '/' + encodeURIComponent(r.caliber)
  if (r.caliber && r.ammoId != null) h += '/' + r.ammoId
  if (r.weaponId != null) h += '/w/' + r.weaponId
  return h
}

function decodeRoute(hash: string): { tab: string; caliber: string | null; weaponId: number | null; ammoId: number | null } {
  const fallback = { tab: 'home', caliber: null, weaponId: null, ammoId: null }
  try {
    const segs = hash.replace(/^#\/?/, '').split('/').filter(s => s.length > 0)
    if (segs.length === 0) return fallback
    const raw = segs[0]
    const mapped = LEGACY_TAB_MAP[raw] ?? null
    if (!mapped) return fallback
    const tab = mapped
    const rest = segs.slice(1)
    let caliber: string | null = null
    let weaponId: number | null = null
    let ammoId: number | null = null
    if (tab === 'guns') {
      if (rest[0] != null && /^\d+$/.test(rest[0])) weaponId = Number(rest[0])
    } else {
      let i = 0
      if (rest[0] != null && rest[0] !== 'w') {
        caliber = decodeURIComponent(rest[0])
        i = 1
      }
      if (caliber != null && rest[i] != null && /^\d+$/.test(rest[i])) {
        ammoId = Number(rest[i])
        i += 1
      }
      if (rest[i] === 'w' && rest[i + 1] != null && /^\d+$/.test(rest[i + 1])) weaponId = Number(rest[i + 1])
    }
    return { tab, caliber, weaponId, ammoId }
  } catch {
    return fallback
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSession, setActiveSession] = useState<RangeDaySession | null>(null)
  const [page, setPage] = useState<'dashboard' | 'range-day' | 'range-day-start' | 'range-day-stage'>('dashboard')
  const [stageInitial, setStageInitial] = useState<StageInitial | null>(null)
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('ay-armory-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* private mode — fall through to system preference */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem('ay-armory-theme', theme) } catch { /* private mode */ }
  }, [theme])

  // On mount, restore session from localStorage
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setLoading(false); return }

    fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(async data => {
        setUser(data.user)
        // Check for active range day session
        const sessRes = await apiFetch('/ammo/range-days')
        if (sessRes.ok) {
          const sessions: RangeDaySession[] = await sessRes.json()
          const active = sessions.find(s => s.startedAt != null && s.endedAt == null)
          if (active) {
            const detailRes = await apiFetch(`/ammo/range-days/${active.id}`)
            if (detailRes.ok) setActiveSession(await detailRes.json())
            else setActiveSession(active)
            setPage('range-day')
          }
        }
        const typesRes = await apiFetch('/ammo/types')
        if (typesRes.ok) setAmmoTypes(await typesRes.json())
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  const handleLogin = (u: User, token: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    setUser(u)
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setActiveSession(null)
    setPage('dashboard')
  }

  const handleRangeDayStart = (session: RangeDaySession) => {
    setActiveSession(session)
    setPage('range-day')
  }

  // Wizard results route by outcome: live sessions enter the live view,
  // staged packs land back on the range-days tab.
  const handleWizardComplete = (s: RangeDaySession) => {
    setStageInitial(null)
    if (s.startedAt != null) {
      setActiveSession(s)
      setPage('range-day')
    } else {
      setPage('dashboard')
      window.location.hash = '#/range-days'
    }
  }

  const handleSessionEnd = () => {
    setActiveSession(null)
    setPage('dashboard')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-neutral-500 dark:text-neutral-400">
        Loading...
      </div>
    )
  }

  if (!user) {
    return <AuthView onLogin={handleLogin} />
  }

  if (page === 'range-day' && activeSession) {
    return (
      <RangeDayView
        session={activeSession}
        ammoTypes={ammoTypes}
        onSessionEnd={handleSessionEnd}
        onBack={() => setPage('dashboard')}
      />
    )
  }

  if (page === 'range-day-stage') {
    return (
      <RangeDayStartWizard
        staged={stageInitial == null}
        initial={stageInitial}
        onComplete={handleWizardComplete}
        onCancel={() => { setStageInitial(null); setPage('dashboard') }}
      />
    )
  }

  if (page === 'range-day-start') {
    return (
      <RangeDayStartWizard
        onComplete={handleWizardComplete}
        onCancel={() => setPage('dashboard')}
      />
    )
  }

  return (
    <DashboardView
      user={user}
      onLogout={handleLogout}
      onRangeDayStart={handleRangeDayStart}
      activeSession={activeSession}
      onResumeRangeDay={() => setPage('range-day')}
      onStartRangeDay={() => setPage('range-day-start')}
      onPackRangeDay={() => { setStageInitial(null); setPage('range-day-stage') }}
      onEditStaged={(init: StageInitial) => { setStageInitial(init); setPage('range-day-stage') }}
      theme={theme}
      onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
    />
  )
}

export default App
