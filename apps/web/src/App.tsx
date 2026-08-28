import { useState, useEffect, useCallback, useMemo } from 'react'

const TOKEN_KEY = 'ay-armory-token'
const API_BASE = ''

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
  entries?: { id: number; ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }[]
}

type BagItem = { ammoTypeId: number; taken: number; acquired: number; inBag: number }

type RangeDaySession = {
  id: number; note: string | null; startedAt: string; endedAt: string | null; bag?: BagItem[]
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
    default: return 'bg-neutral-100 text-neutral-700'
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
    default: return type
  }
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
          className="px-3 py-2 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select value={value} onChange={handleSelect}
      className="px-3 py-2 border rounded-lg text-sm w-full bg-white">
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
      <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
        <p className="text-neutral-500 mb-4">No ammo types yet — create one to get started.</p>
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
          className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm text-left hover:border-neutral-400 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-start justify-between mb-1">
            <p className="text-lg font-bold text-neutral-900 group-hover:text-neutral-700">{group.caliber}</p>
            <span className="ml-2 shrink-0 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">
              {group.items.length} type{group.items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className={`text-3xl font-bold mt-2 ${balanceColor(group.totalBalance)}`}>
            {group.totalBalance.toLocaleString()}
          </p>
          <p className="text-xs text-neutral-400 mt-1">rounds · tap for details</p>
        </button>
      ))}
    </div>
  )
}

// Quick action form wrapper
function QuickForm({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 cursor-pointer text-xl leading-none">&times;</button>
      </div>
      {children}
    </div>
  )
}

function AcquireForm({ ammoTypes, onSuccess, onClose }: {
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
        type: 'acquisition',
        occurredAt: new Date().toISOString(),
        note: note || null,
        entries: [{ ammoTypeId: Number(ammoTypeId), quantity: Math.abs(Number(quantity)) }],
      }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    onSuccess()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <select value={ammoTypeId} onChange={e => setAmmoTypeId(Number(e.target.value))}
        className="px-3 py-2 border rounded-lg text-sm">
        {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input type="number" min="1" placeholder="Quantity" value={quantity} required
        onChange={e => setQuantity(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" placeholder="Note (e.g. Bought at LGS)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Add</button>
    </form>
  )
}

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
        className="px-3 py-2 border rounded-lg text-sm">
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
        className="px-3 py-2 border rounded-lg text-sm">
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

function RangeDayStartForm({ ammoTypes, onSuccess, onClose }: {
  ammoTypes: AmmoType[]; onSuccess: (session: RangeDaySession) => void; onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<AmmoRow[]>([{ ammoTypeId: ammoTypes[0]?.id ?? 0, quantity: 0 }])
  const [error, setError] = useState('')

  const updateRow = (i: number, field: keyof AmmoRow, val: number) => {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const ammo = rows.filter(r => r.quantity > 0)
    if (ammo.length === 0) { setError('Add at least one ammo type with quantity > 0'); return }
    const res = await apiFetch('/ammo/range-days', {
      method: 'POST',
      body: JSON.stringify({ note: note || null, ammo }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    const session = await res.json()
    onSuccess(session)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="text" placeholder="Note (e.g. Burro Canyon)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select value={row.ammoTypeId} onChange={e => updateRow(i, 'ammoTypeId', Number(e.target.value))}
            className="flex-1 px-3 py-2 border rounded-lg text-sm">
            {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="number" min="1" placeholder="Qty" value={row.quantity || ''}
            onChange={e => updateRow(i, 'quantity', Number(e.target.value))}
            className="w-24 px-3 py-2 border rounded-lg text-sm" />
          {rows.length > 1 && (
            <button type="button" onClick={() => setRows(r => r.filter((_, idx) => idx !== i))}
              className="text-neutral-400 hover:text-red-500 cursor-pointer text-lg leading-none">&times;</button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setRows(r => [...r, { ammoTypeId: ammoTypes[0]?.id ?? 0, quantity: 0 }])}
        className="text-sm text-neutral-500 hover:text-neutral-700 cursor-pointer text-left">
        + Add Another Caliber
      </button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">
        Start Range Day
      </button>
    </form>
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
    return <p className="text-sm text-neutral-500">No ammo types yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Caliber</th>
            <th className="py-2 pr-4">Grain</th>
            <th className="py-2 pr-4">Brand</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {ammoTypes.map(t => (
            <tr key={t.id} className="border-b border-neutral-100 last:border-0">
              {editingId === t.id ? (
                <>
                  <td className="py-2 pr-4"><input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full" /></td>
                  <td className="py-2 pr-4 min-w-[160px]"><CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} /></td>
                  <td className="py-2 pr-4"><input type="number" value={editData.grain ?? ''} onChange={e => setEditData(d => ({ ...d, grain: e.target.value ? Number(e.target.value) : null }))} className="px-2 py-1 border rounded text-sm w-20" /></td>
                  <td className="py-2 pr-4"><input value={editData.brand ?? ''} onChange={e => setEditData(d => ({ ...d, brand: e.target.value || null }))} className="px-2 py-1 border rounded text-sm w-24" /></td>
                  <td className="py-2 flex gap-2">
                    <button onClick={saveEdit} className="text-xs px-2 py-1 bg-black text-white rounded cursor-pointer hover:opacity-80">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50">Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-4 font-medium">{t.name}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.caliber}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.grain ?? '—'}</td>
                  <td className="py-2 pr-4 text-neutral-500">{t.brand ?? '—'}</td>
                  <td className="py-2 flex gap-2">
                    <button onClick={() => startEdit(t)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50">Edit</button>
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
          className="px-3 py-1.5 border rounded-lg text-sm">
          <option value="">All types</option>
          {['acquisition', 'expenditure', 'adjustment', 'transfer', 'range_day_start', 'range_day_end'].map(t => (
            <option key={t} value={t}>{txLabel(t)}</option>
          ))}
        </select>
        <select value={filterAmmoTypeId} onChange={e => setFilterAmmoTypeId(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm">
          <option value="">All ammo types</option>
          {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading...</p>
      ) : transactions.length === 0 ? (
        <p className="text-neutral-400 text-sm">No transactions yet.</p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {transactions.map(tx => (
            <div key={tx.id}>
              <button
                onClick={() => loadEntries(tx.id)}
                className="w-full text-left py-3 flex items-center gap-3 hover:bg-neutral-50 cursor-pointer transition-colors"
              >
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor(tx.type)}`}>{txLabel(tx.type)}</span>
                <span className="text-sm text-neutral-500">{new Date(tx.occurredAt).toLocaleDateString()}</span>
                {tx.note && <span className="text-sm text-neutral-600 truncate">{tx.note}</span>}
                <span className="ml-auto text-neutral-400 text-xs">{expandedId === tx.id ? '▲' : '▼'}</span>
              </button>
              {expandedId === tx.id && tx.entries && (
                <div className="pl-4 pb-3 space-y-1">
                  {tx.entries.filter(e => !e.isBalancing).map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-sm">
                      <span className="text-neutral-500">{typeForId(e.ammoTypeId)}</span>
                      <span className={e.quantity > 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                        {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                      </span>
                      <span className="text-neutral-400 text-xs">[{e.location}]</span>
                    </div>
                  ))}
                  {tx.price != null && (
                    <div className="text-xs text-neutral-500 mt-1">
                      Price: ${(tx.price / 100).toFixed(2)}{tx.vendor ? ` · ${tx.vendor}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Range Day View ────────────────────────────────────────────────────────

function EndSessionModal({ session, bagContents, ammoTypes, onConfirm, onCancel }: {
  session: RangeDaySession
  bagContents: BagItem[]
  ammoTypes: AmmoType[]
  onConfirm: (returnAmmo: AmmoRow[]) => void
  onCancel: () => void
}) {
  const [returnAmounts, setReturnAmounts] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    for (const b of bagContents) init[b.ammoTypeId] = b.inBag
    return init
  })
  const [error, setError] = useState('')

  const typeForId = (id: number) => ammoTypes.find(t => t.id === id)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
      for (const b of bagContents) {
        const ret = returnAmounts[b.ammoTypeId] ?? 0
        const t = typeForId(b.ammoTypeId)
        if (ret > b.inBag) { setError(`Cannot return more than ${b.inBag} of ${t?.name ?? `Type #${b.ammoTypeId}`}`); return }
      }
    const returnAmmo = bagContents
      .map(b => ({ ammoTypeId: b.ammoTypeId, quantity: returnAmounts[b.ammoTypeId] ?? 0 }))
      .filter(r => r.quantity > 0)
    onConfirm(returnAmmo)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-1">End Range Day</h3>
        {session.note && <p className="text-sm text-neutral-500 mb-4">{session.note}</p>}
        <p className="text-sm font-medium text-neutral-700 mb-3">What are you returning to storage?</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {bagContents.map(b => {
            const ret = returnAmounts[b.ammoTypeId] ?? 0
            const expended = b.inBag - ret
            return (
              <div key={b.ammoTypeId} className="rounded-lg bg-neutral-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  {(() => {
                    const t = typeForId(b.ammoTypeId)
                    return (
                      <>
                        <span className="text-sm font-medium">{t?.name ?? `Type #${b.ammoTypeId}`}</span>
                        {t?.caliber && (
                          <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">{t.caliber}</span>
                        )}
                      </>
                    )
                  })()}
                  <input type="number" min="0" max={b.inBag} value={ret}
                    onChange={e => setReturnAmounts(prev => ({ ...prev, [b.ammoTypeId]: Number(e.target.value) }))}
                    className="ml-auto w-20 px-2 py-1 border rounded text-sm text-right" />
                  <span className="text-sm text-neutral-500">rounds</span>
                </div>
                <div className="text-xs text-neutral-500 space-y-0.5 border-t border-neutral-200 pt-2 mt-1">
                  <div className="flex justify-between"><span>Taken:</span><span>{b.taken}</span></div>
                  <div className="flex justify-between"><span>Acquired:</span><span>{b.acquired}</span></div>
                  <div className="flex justify-between"><span>Returned:</span><span>{ret}</span></div>
                  <div className="flex justify-between font-medium text-neutral-700 border-t border-neutral-200 pt-0.5 mt-0.5">
                    <span>Expended (derived):</span><span>{expended}</span>
                  </div>
                </div>
              </div>
            )
          })}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={onCancel}
              className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Cancel</button>
            <button type="submit"
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer">Confirm</button>
          </div>
        </form>
      </div>
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
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>(initialAmmoTypes)
  const [showEndModal, setShowEndModal] = useState(false)
  const [acquireAmmoTypeId, setAcquireAmmoTypeId] = useState(initialAmmoTypes[0]?.id ?? 0)
  const [acquireQty, setAcquireQty] = useState('')
  const [acquirePrice, setAcquirePrice] = useState('')
  const [acquireVendor, setAcquireVendor] = useState('')
  const [acquireError, setAcquireError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/ammo/types')
      .then(r => (r.ok ? r.json() : Promise.resolve([] as AmmoType[])))
      .then((data: AmmoType[]) => {
        if (cancelled) return
        setAmmoTypes(data)
        setAcquireAmmoTypeId(prev => prev || (data[0]?.id ?? 0))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const refreshBag = async () => {
    const res = await apiFetch(`/ammo/range-days/${session.id}`)
    if (res.ok) {
      const data = await res.json()
      setSession(data)
      setBag(data.bag ?? [])
    }
  }

  const handleAcquire = async (e: React.FormEvent) => {
    e.preventDefault()
    setAcquireError('')
    const res = await apiFetch(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST',
      body: JSON.stringify({
        ammo: [{
          ammoTypeId: Number(acquireAmmoTypeId),
          quantity: Number(acquireQty),
          price: acquirePrice ? Math.round(Number(acquirePrice) * 100) : undefined,
          vendor: acquireVendor || undefined,
        }],
      }),
    })
    if (!res.ok) { const d = await res.json(); setAcquireError(d.error || 'Error'); return }
    const data = await res.json()
    setBag(data.bag ?? [])
    setAcquireQty('')
    setAcquirePrice('')
    setAcquireVendor('')
  }

  const handleEnd = async (returnAmmo: AmmoRow[]) => {
    const res = await apiFetch(`/ammo/range-days/${session.id}/end`, {
      method: 'POST',
      body: JSON.stringify({ returnAmmo }),
    })
    if (!res.ok) { alert('Error ending session'); return }
    setShowEndModal(false)
    onSessionEnd()
  }

  const typeForId = (id: number) => ammoTypes.find(t => t.id === id)

  return (
    <div className="min-h-screen bg-neutral-50">
      {showEndModal && (
        <EndSessionModal
          session={session}
          bagContents={bag}
          ammoTypes={ammoTypes}
          onConfirm={handleEnd}
          onCancel={() => setShowEndModal(false)}
        />
      )}

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-4xl flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-neutral-400 hover:text-neutral-700 cursor-pointer">← Back</button>
            <h1 className="text-lg font-bold tracking-tight">Range Day</h1>
            {session.note && <span className="text-neutral-500 text-sm">· {session.note}</span>}
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">Active</span>
          </div>
          <button
            onClick={() => setShowEndModal(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 cursor-pointer"
          >
            End Range Day
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Bag Contents Table */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Bag Contents</h2>
          {bag.length === 0 ? (
            <p className="text-neutral-400 text-sm">No ammo in bag.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500">
                    <th className="px-4 py-3">Ammo Type</th>
                    <th className="px-4 py-3">Caliber</th>
                    <th className="px-4 py-3 text-right">Taken</th>
                    <th className="px-4 py-3 text-right">Acquired</th>
                    <th className="px-4 py-3 text-right font-semibold text-neutral-700">In Bag</th>
                  </tr>
                </thead>
                <tbody>
                  {bag.map(b => {
                    const type = typeForId(b.ammoTypeId)
                    return (
                      <tr key={b.ammoTypeId} className="border-b border-neutral-100 last:border-0">
                        <td className="px-4 py-3 font-medium">{type?.name ?? `Type #${b.ammoTypeId}`}</td>
                        <td className="px-4 py-3 text-neutral-500">{type?.caliber ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-neutral-600">{b.taken}</td>
                        <td className="px-4 py-3 text-right text-neutral-600">{b.acquired}</td>
                        <td className={`px-4 py-3 text-right font-bold ${balanceColor(b.inBag)}`}>{b.inBag}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Acquire at Range */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Acquire at Range</h2>
          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <form onSubmit={handleAcquire} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <select value={acquireAmmoTypeId} onChange={e => setAcquireAmmoTypeId(Number(e.target.value))}
                  className="col-span-2 px-3 py-2 border rounded-lg text-sm">
                  {ammoTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="number" min="1" placeholder="Quantity" value={acquireQty} required
                  onChange={e => setAcquireQty(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                <input type="number" min="0" step="0.01" placeholder="Price ($, optional)" value={acquirePrice}
                  onChange={e => setAcquirePrice(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
              </div>
              <input type="text" placeholder="Vendor (optional)" value={acquireVendor}
                onChange={e => setAcquireVendor(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
              {acquireError && <p className="text-red-500 text-sm">{acquireError}</p>}
              <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">
                Add to Bag
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}

// ── Ammo Type Detail ──────────────────────────────────────────────────────

type EntryRow = { id: number; ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }
type TxWithEntries = Transaction & { entries: EntryRow[] }

function AmmoTypeDetailView({ item, onBack }: { item: InventoryItem; onBack: () => void }) {
  const [transactions, setTransactions] = useState<TxWithEntries[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/ammo/types/${item.id}/transactions`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false))
  }, [item.id])

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

  function netLabel(net: number, tx: TxWithEntries): React.ReactNode {
    if (net === 0) {
      // range_day_start moves rounds between locations — show how many moved
      if (tx.type === 'range_day_start') {
        const bagEntry = tx.entries
          .find(e => e.location === 'bag' && !e.isBalancing && e.ammoTypeId === item.id)
        const took = bagEntry ? Math.abs(bagEntry.quantity) : 0
        return <span className="text-neutral-400 text-sm italic">moved {took} to bag</span>
      }
      return <span className="text-neutral-400 text-sm">—</span>
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
          className="text-sm text-neutral-500 hover:text-neutral-800 cursor-pointer transition-colors"
        >
          ← Inventory
        </button>
      </div>

      {/* Ammo type card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900">{item.name}</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-neutral-500">
              <span className="bg-neutral-100 px-2 py-0.5 rounded-full">{item.caliber}</span>
              {item.grain && <span>{item.grain}gr</span>}
              {item.brand && <span>· {item.brand}</span>}
              {item.description && <span>· {item.description}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className={`text-4xl font-bold ${balanceColor(item.balance)}`}>
              {item.balance.toLocaleString()}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">rounds in storage</p>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
        Transaction History
      </h3>

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center">
          <p className="text-neutral-400 text-sm">No transactions yet for this ammo type.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tx, net, runningBalance }) => (
                <tr key={tx.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">
                    {new Date(tx.occurredAt).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor(tx.type)}`}>
                      {txLabel(tx.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 max-w-[200px] truncate">
                    {tx.note ?? <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {netLabel(net, tx)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-700">
                    {runningBalance.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Caliber Detail View ───────────────────────────────────────────────────

function CaliberDetailView({ group, refreshKey = 0, onBack }: { group: CaliberGroup; refreshKey?: number; onBack: () => void }) {
  const [txMap, setTxMap] = useState<Map<number, TxWithEntries>>(new Map())
  const [loading, setLoading] = useState(true)
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null)

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

  if (viewingItem) {
    return <AmmoTypeDetailView item={viewingItem} onBack={() => setViewingItem(null)} />
  }

  return (
    <div>
      {/* Back */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="text-sm text-neutral-500 hover:text-neutral-800 cursor-pointer transition-colors"
        >
          ← Inventory
        </button>
      </div>

      {/* Caliber summary card */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm mb-6">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900">{group.caliber}</h2>
            <p className="text-sm text-neutral-500 mt-1">
              {group.items.length} ammo type{group.items.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-4xl font-bold ${balanceColor(group.totalBalance)}`}>
              {group.totalBalance.toLocaleString()}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">total rounds in storage</p>
          </div>
        </div>
      </div>

      {/* Per-type breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {group.items.map(item => (
          <button
            key={item.id}
            onClick={() => setViewingItem(item)}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm text-left hover:border-neutral-400 hover:shadow-md transition-all cursor-pointer group"
          >
            <p className="text-sm font-medium text-neutral-700 truncate group-hover:text-neutral-900">{item.name}</p>
            {(item.grain || item.brand) && (
              <p className="text-xs text-neutral-400 mt-0.5 truncate">
                {[item.grain ? `${item.grain}gr` : null, item.brand].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className={`text-2xl font-bold mt-2 ${balanceColor(item.balance)}`}>{item.balance.toLocaleString()}</p>
            <p className="text-xs text-neutral-400 mt-0.5">rounds · tap for history</p>
          </button>
        ))}
      </div>

      {/* Merged transaction history */}
      <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
        Transaction History
      </h3>

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center">
          <p className="text-neutral-400 text-sm">No transactions yet for this caliber.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tx, net, runningBalance }) => (
                <tr key={tx.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">
                    {new Date(tx.occurredAt).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor(tx.type)}`}>
                      {txLabel(tx.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 max-w-[200px] truncate">
                    {tx.note ?? <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {net === 0
                      ? <span className="text-neutral-400 text-sm">—</span>
                      : (
                        <span className={`font-semibold tabular-nums ${net > 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {net > 0 ? `+${net.toLocaleString()}` : net.toLocaleString()}
                        </span>
                      )
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-700">
                    {runningBalance.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Dashboard View ────────────────────────────────────────────────────────

type QuickAction = 'acquire' | 'expend' | 'range-day' | 'adjust' | 'new-type' | null

function DashboardView({ user, onLogout, onRangeDayStart, activeSession, onResumeRangeDay }: {
  user: User
  onLogout: () => void
  onRangeDayStart: (session: RangeDaySession) => void
  activeSession: RangeDaySession | null
  onResumeRangeDay: () => void
}) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<QuickAction>(null)
  const [tab, setTab] = useState<'inventory' | 'types' | 'history'>('inventory')
  const [viewingCaliberName, setViewingCaliberName] = useState<string | null>(null)
  const [txRefreshKey, setTxRefreshKey] = useState(0)

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

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true)
    const [invRes, typesRes] = await Promise.all([
      apiFetch('/ammo/inventory'),
      apiFetch('/ammo/types'),
    ])
    if (invRes.ok) setInventory(await invRes.json())
    if (typesRes.ok) setAmmoTypes(await typesRes.json())
    setInventoryLoading(false)
  }, [])

  useEffect(() => { loadInventory() }, [loadInventory])

  const handleActionSuccess = () => {
    setActiveAction(null)
    loadInventory()
    setTxRefreshKey(k => k + 1)
  }

  const handleRangeDayStart = (session: RangeDaySession) => {
    setActiveAction(null)
    onRangeDayStart(session)
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
          <h1 className="text-xl font-bold tracking-tight">ay-armory</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-500">{user.email}</span>
            <button onClick={onLogout}
              className="text-sm px-4 py-2 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h2 className="text-2xl font-semibold text-neutral-900 mb-6">
          Welcome{user.firstName ? `, ${user.firstName}` : ''}
        </h2>

        {/* Active Range Day Banner */}
        {activeSession && (
          <button
            onClick={onResumeRangeDay}
            className="w-full mb-6 flex items-center justify-between px-5 py-3 rounded-xl bg-green-50 border border-green-200 text-green-800 hover:bg-green-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">Range Day Active</span>
              {activeSession.note && <span className="text-sm text-green-700">· {activeSession.note}</span>}
            </div>
            <span className="text-sm font-medium">Return to Range Day →</span>
          </button>
        )}

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap gap-2 mb-6">
          {([
            { key: 'acquire', label: '+ Acquire' },
            { key: 'expend', label: '- Expend' },
            { key: 'range-day', label: '⇄ Range Day' },
            { key: 'adjust', label: '↻ Adjust' },
            { key: 'new-type', label: '+ New Type' },
          ] as { key: QuickAction; label: string }[]).map(({ key, label }) => (
            <button key={key}
              onClick={() => setActiveAction(activeAction === key ? null : key)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors cursor-pointer ${
                activeAction === key
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Quick Action Forms */}
        {activeAction === 'acquire' && ammoTypes.length > 0 && (
          <QuickForm title="Acquire Ammo" onClose={() => setActiveAction(null)}>
            <AcquireForm ammoTypes={ammoTypes} onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
          </QuickForm>
        )}
        {activeAction === 'acquire' && ammoTypes.length === 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 mt-4">
            <p className="text-sm text-neutral-500">Create an ammo type first.</p>
          </div>
        )}
        {activeAction === 'expend' && ammoTypes.length > 0 && (
          <QuickForm title="Record Expenditure" onClose={() => setActiveAction(null)}>
            <ExpendForm ammoTypes={ammoTypes} onSuccess={handleActionSuccess} onClose={() => setActiveAction(null)} />
          </QuickForm>
        )}
        {activeAction === 'expend' && ammoTypes.length === 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 mt-4">
            <p className="text-sm text-neutral-500">Create an ammo type first.</p>
          </div>
        )}
        {activeAction === 'range-day' && ammoTypes.length > 0 && (
          <QuickForm title="Start Range Day" onClose={() => setActiveAction(null)}>
            <RangeDayStartForm ammoTypes={ammoTypes} onSuccess={handleRangeDayStart} onClose={() => setActiveAction(null)} />
          </QuickForm>
        )}
        {activeAction === 'range-day' && ammoTypes.length === 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 mt-4">
            <p className="text-sm text-neutral-500">Create an ammo type first.</p>
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

        {/* Tabs */}
        <div className="flex gap-1 border-b border-neutral-200 mb-6 mt-8">
          {(['inventory', 'types', 'history'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setViewingCaliberName(null) }}
              className={`px-4 py-2 text-sm font-medium capitalize cursor-pointer transition-colors ${
                tab === t
                  ? 'border-b-2 border-black text-black'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}>
              {t === 'types' ? 'Manage Types' : t === 'history' ? 'History' : 'Inventory'}
            </button>
          ))}
        </div>

        {tab === 'inventory' && (
          viewingCaliber ? (
            <CaliberDetailView
              group={viewingCaliber}
              refreshKey={txRefreshKey}
              onBack={() => setViewingCaliberName(null)}
            />
          ) : inventoryLoading ? (
            <p className="text-neutral-400 text-sm">Loading inventory...</p>
          ) : (
            <InventoryCards
              inventory={inventory}
              onEmpty={() => setActiveAction('new-type')}
              onCaliberClick={g => setViewingCaliberName(g.caliber)}
            />
          )
        )}

        {tab === 'types' && (
          <AmmoTypeManager ammoTypes={ammoTypes} onRefresh={loadInventory} />
        )}

        {tab === 'history' && (
          <TransactionHistory ammoTypes={ammoTypes} />
        )}
      </main>
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

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSession, setActiveSession] = useState<RangeDaySession | null>(null)
  const [page, setPage] = useState<'dashboard' | 'range-day'>('dashboard')
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])

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
          const active = sessions.find(s => s.endedAt == null)
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

  const handleSessionEnd = () => {
    setActiveSession(null)
    setPage('dashboard')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-neutral-500">
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

  return (
    <DashboardView
      user={user}
      onLogout={handleLogout}
      onRangeDayStart={handleRangeDayStart}
      activeSession={activeSession}
      onResumeRangeDay={() => setPage('range-day')}
    />
  )
}

export default App
