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

type RangeDayString = {
  id: number; sessionId: number; transactionId: number
  weaponId: number; ammoTypeId: number; rounds: number
  occurredAt: string; note: string | null
}

type GunLoaded = { weaponId: number; ammoTypeId: number; rounds: number }

type RangeDaySession = {
  id: number; note: string | null; startedAt: string; endedAt: string | null
  bag?: BagItem[]; weapons?: Weapon[]; strings?: RangeDayString[]; gunLoaded?: GunLoaded[]
}

type Weapon = {
  id: number; userId: number; name: string; caliber: string
  type: string; serialNumber: string | null; notes: string | null
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

function RangeDayStartForm({ ammoTypes, weapons, inventory, onSuccess, onClose }: {
  ammoTypes: AmmoType[]; weapons: Weapon[]; inventory: InventoryItem[]; onSuccess: (session: RangeDaySession) => void; onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [selectedWeapons, setSelectedWeapons] = useState<number[]>([])
  const [error, setError] = useState('')

  const balanceByType = new Map(inventory.map(i => [i.id, i.balance]))
  const availableFor = (ammoTypeId: number) => balanceByType.get(ammoTypeId) ?? 0
  // Only offer ammo types that actually have rounds in storage
  const stockedTypes = ammoTypes.filter(t => availableFor(t.id) > 0)
  const [rows, setRows] = useState<AmmoRow[]>([{ ammoTypeId: stockedTypes[0]?.id ?? 0, quantity: 0 }])

  const updateRow = (i: number, field: keyof AmmoRow, val: number) => {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))
  }

  const toggleWeapon = (id: number) => {
    setSelectedWeapons(prev => prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id])
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const ammo = rows.filter(r => r.quantity > 0)
    if (ammo.length === 0) { setError('Add at least one ammo type with quantity > 0'); return }
    const overLimit = ammo.some(r => r.quantity > availableFor(r.ammoTypeId))
    if (overLimit) { setError('One or more calibers exceed what you have in storage'); return }
    const res = await apiFetch('/ammo/range-days', {
      method: 'POST',
      body: JSON.stringify({ note: note || null, ammo, weapons: selectedWeapons }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    const session = await res.json()
    onSuccess(session)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="text" placeholder="Note (e.g. Burro Canyon)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />

      <div>
        <p className="text-sm font-medium text-neutral-700 mb-2">Ammo to take</p>
        {rows.map((row, i) => {
          const avail = availableFor(row.ammoTypeId)
          const over = row.quantity > avail
          return (
            <div key={i} className="mb-2">
              <div className="flex gap-2 items-center">
                  <select value={row.ammoTypeId} onChange={e => updateRow(i, 'ammoTypeId', Number(e.target.value))}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm">
                  {stockedTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="number" min="1" placeholder="Qty" value={row.quantity || ''}
                  onChange={e => updateRow(i, 'quantity', Number(e.target.value))}
                  className={`w-24 px-3 py-2 border rounded-lg text-sm ${over ? 'border-red-400' : ''}`} />
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows(r => r.filter((_, idx) => idx !== i))}
                    className="text-neutral-400 hover:text-red-500 cursor-pointer text-lg leading-none">&times;</button>
                )}
              </div>
              <p className={`text-xs mt-1 ${over ? 'text-red-500' : 'text-neutral-400'}`}>
                {over
                  ? `Only ${avail.toLocaleString()} in storage`
                  : `In storage: ${avail.toLocaleString()}`}
              </p>
            </div>
          )
        })}
        <button type="button" onClick={() => setRows(r => [...r, { ammoTypeId: stockedTypes[0]?.id ?? 0, quantity: 0 }])}
          className="text-sm text-neutral-500 hover:text-neutral-700 cursor-pointer text-left">
          + Add Another Caliber
        </button>
        {stockedTypes.length === 0 && (
          <p className="text-xs text-neutral-400 mt-2">No rounds in storage — add inventory on the Ammo tab first.</p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-neutral-700 mb-2">Weapons (optional)</p>
        {weapons.length === 0 ? (
          <p className="text-xs text-neutral-400">No weapons yet — you can add them later on the Weapons tab.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {weapons.map(w => (
              <label key={w.id}
                className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer transition-colors ${
                  selectedWeapons.includes(w.id) ? 'border-black bg-neutral-50' : 'border-neutral-200'
                }`}>
                <input type="checkbox" checked={selectedWeapons.includes(w.id)}
                  onChange={() => toggleWeapon(w.id)} className="accent-black" />
                <span className="font-medium">{w.name}</span>
                <span className="text-xs text-neutral-400">{w.caliber}</span>
              </label>
            ))}
          </div>
        )}
      </div>

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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function ConfirmEndModal({ bag, onConfirm, onCancel }: {
  bag: BagItem[]; onConfirm: () => void; onCancel: () => void
}) {
  const leftover = bag.reduce((s, b) => s + b.inBag, 0)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-1">End Range Day</h3>
        <p className="text-sm text-neutral-600 mb-4">
          Any ammo left in the bag (<span className="font-semibold">{leftover}</span> rounds) will be returned to storage.
          Rounds already fired are recorded as expended.
        </p>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={onCancel}
            className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Cancel</button>
          <button type="button" onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer">End Range Day</button>
        </div>
      </div>
    </div>
  )
}

function WeaponRangeCard({ weapon, bag, ammoTypes, gunLoaded, strings, onAction, typeForId }: {
  weapon: Weapon
  bag: BagItem[]
  ammoTypes: AmmoType[]
  gunLoaded: GunLoaded[]
  strings: RangeDayString[]
  onAction: (action: 'load' | 'shoot' | 'return', weaponId: number, ammoTypeId: number, rounds: number, note: string) => Promise<string | null>
  typeForId: (id: number) => AmmoType | undefined
}) {
  const [ammoTypeId, setAmmoTypeId] = useState<number>(bag[0]?.ammoTypeId ?? 0)
  const [rounds, setRounds] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [stage, setStage] = useState<'load' | 'shoot' | 'stopped'>(
    gunLoaded.some(g => g.weaponId === weapon.id && g.rounds > 0) ? 'shoot' : 'load'
  )
  const [showStopModal, setShowStopModal] = useState(false)

  // Keep a sensible default selection as the bag / gun changes for the current stage
  useEffect(() => {
    if (stage === 'load') {
      if (bag[0] && !bag.some(b => b.ammoTypeId === ammoTypeId)) setAmmoTypeId(bag[0].ammoTypeId)
    } else if (stage === 'shoot') {
      if (loaded.length && !loaded.some(g => g.ammoTypeId === ammoTypeId)) setAmmoTypeId(loaded[0].ammoTypeId)
    }
  }, [bag, gunLoaded, ammoTypeId, stage])

  const loaded = gunLoaded.filter(g => g.weaponId === weapon.id)
  const totalLoaded = loaded.reduce((s, g) => s + g.rounds, 0)
  const fired = strings.filter(s => s.weaponId === weapon.id).reduce((s, x) => s + x.rounds, 0)

  // Selectable ammo types depend on the current stage (bag in Load, gun in Shoot)
  const selectOptions = stage === 'shoot' ? loaded.filter(g => g.rounds > 0) : bag
  const selectedValid = selectOptions.some(o => o.ammoTypeId === ammoTypeId)
  const activeTypeId = selectedValid ? ammoTypeId : (selectOptions[0]?.ammoTypeId ?? 0)
  const ammo = typeForId(activeTypeId)
  const mismatch = !!ammo && weapon.caliber !== ammo.caliber

  const inBag = bag.find(b => b.ammoTypeId === activeTypeId)?.inBag ?? 0
  const loadedForAmmo = loaded.find(g => g.ammoTypeId === activeTypeId)?.rounds ?? 0
  const firedForAmmo = strings
    .filter(s => s.weaponId === weapon.id && s.ammoTypeId === activeTypeId)
    .reduce((s, x) => s + x.rounds, 0)
  // Stepper cap = what you can act on for the active ammo in the current stage
  const cap = stage === 'shoot' ? loadedForAmmo : inBag

  const setRoundsClamped = (n: number) => {
    if (!Number.isFinite(n) || n < 0) setRounds(0)
    else setRounds(Math.min(cap, Math.floor(n)))
  }
  const step = (d: number) => setRoundsClamped(rounds + d)

  const act = async (action: 'load' | 'shoot' | 'return', useAll = false) => {
    setError('')
    const amount = useAll ? (action === 'load' ? inBag : loadedForAmmo) : rounds
    if (!activeTypeId) { setError('Select an ammo type'); return }
    if (action === 'load') {
      if (inBag === 0) { setError('No ammo of this type in the bag'); return }
      if (amount <= 0) { setError('Enter a positive round count'); return }
      if (amount > inBag) { setError(`Only ${inBag} in the bag`); return }
    } else {
      if (loadedForAmmo === 0) { setError('Nothing loaded for this ammo'); return }
      if (amount <= 0) { setError('Enter a positive round count'); return }
      if (amount > loadedForAmmo) { setError(`Only ${loadedForAmmo} loaded`); return }
    }
    const err = await onAction(action, weapon.id, activeTypeId, amount, note)
    if (err) { setError(err); return }
    setRounds(0)
    setNote('')
    if (action === 'load') setStage('shoot')
  }

  const handleStop = () => {
    if (totalLoaded > 0) setShowStopModal(true)
    else setStage('stopped')
  }

  const handleStopReturn = async () => {
    let err: string | null = null
    for (const g of loaded) {
      if (g.rounds <= 0) continue
      const e = await onAction('return', weapon.id, g.ammoTypeId, g.rounds, '')
      if (e) { err = e; break }
    }
    setShowStopModal(false)
    if (!err) setStage('stopped')
    else setError(err)
  }

  // Stage visual: how much of this ammo for this weapon is currently in the gun vs fired
  const stageTotal = loadedForAmmo + firedForAmmo
  const loadedPct = stageTotal > 0 ? (loadedForAmmo / stageTotal) * 100 : 0
  const firedPct = stageTotal > 0 ? (firedForAmmo / stageTotal) * 100 : 0

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{weapon.name}</span>
        <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">{weapon.caliber}</span>
      </div>

      {/* Budget: how much of this ammo is still available to load */}
      <p className={`text-xs mt-2 ${inBag === 0 ? 'text-red-600' : 'text-neutral-500'}`}>
        In bag (available to load): <span className="font-semibold">{inBag}</span>
      </p>

      {/* Stage: loaded in gun vs fired */}
      {stageTotal > 0 && (
        <div className="mt-2">
          <div className="flex h-2.5 rounded-full overflow-hidden bg-neutral-200">
            <div style={{ width: `${loadedPct}%` }} className="bg-blue-500" />
            <div style={{ width: `${firedPct}%` }} className="bg-red-500" />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-blue-600 font-medium">Loaded {loadedForAmmo}</span>
            <span className="text-red-600 font-medium">Fired {firedForAmmo}</span>
          </div>
        </div>
      )}

      {loaded.length > 0 && (
        <div className="text-sm text-neutral-500 mt-2 space-y-0.5">
          {loaded.map(g => (
            <p key={g.ammoTypeId}>
              Loaded: <span className="font-medium">{g.rounds}</span> × {typeForId(g.ammoTypeId)?.name ?? `Type #${g.ammoTypeId}`}
            </p>
          ))}
          <p className="text-neutral-700 font-medium">Fired (total): {fired}</p>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {stage === 'load' && (
          <>
            <select value={ammoTypeId} onChange={e => { setAmmoTypeId(Number(e.target.value)); setRounds(0) }}
              className="px-3 py-2 border rounded-lg text-sm w-full">
              {bag.length === 0 && <option value={0}>No ammo in bag</option>}
              {bag.map(b => {
                const t = typeForId(b.ammoTypeId)
                return <option key={b.ammoTypeId} value={b.ammoTypeId}>{t?.name ?? `Type #${b.ammoTypeId}`} ({b.inBag})</option>
              })}
            </select>

            {mismatch && (
              <p className="text-amber-600 text-xs">
                ⚠ Caliber mismatch: {weapon.name} is {weapon.caliber}, ammo is {ammo?.caliber}.
              </p>
            )}

            <QuickAdd rounds={rounds} cap={cap} onChange={setRoundsClamped} onStep={step} />

            <input type="text" placeholder="Note (optional)" value={note}
              onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-full" />

            {error && <p className="text-red-500 text-xs">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => act('load')}
                disabled={rounds === 0 || inBag === 0}
                className="px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Load</button>
              <button type="button" onClick={() => act('load', true)}
                disabled={inBag === 0}
                className="px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Load All ({inBag})</button>
            </div>
          </>
        )}

        {stage === 'shoot' && (
          <>
            <p className="text-sm text-neutral-600">
              Loaded: <span className="font-semibold">{loadedForAmmo}</span> × {ammo?.name ?? `Type #${activeTypeId}`}
            </p>

            {loaded.filter(g => g.rounds > 0).length > 1 && (
              <select value={ammoTypeId} onChange={e => { setAmmoTypeId(Number(e.target.value)); setRounds(0) }}
                className="px-3 py-2 border rounded-lg text-sm w-full">
                {loaded.filter(g => g.rounds > 0).map(g => {
                  const t = typeForId(g.ammoTypeId)
                  return <option key={g.ammoTypeId} value={g.ammoTypeId}>{t?.name ?? `Type #${g.ammoTypeId}`} ({g.rounds})</option>
                })}
              </select>
            )}

            <QuickAdd rounds={rounds} cap={cap} onChange={setRoundsClamped} onStep={step} />

            <input type="text" placeholder="Note (optional)" value={note}
              onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-full" />

            {error && <p className="text-red-500 text-xs">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => act('shoot')}
                disabled={rounds === 0 || loadedForAmmo === 0}
                className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Shoot</button>
              <button type="button" onClick={() => act('shoot', true)}
                disabled={loadedForAmmo === 0}
                className="px-3 py-2 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Shoot All</button>
              <button type="button" onClick={() => setStage('load')}
                className="px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Load More</button>
              <button type="button" onClick={handleStop}
                disabled={totalLoaded === 0}
                className="px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Stop</button>
            </div>
          </>
        )}

        {stage === 'stopped' && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">
              Fired this session: <span className="font-semibold text-neutral-700">{fired}</span> rounds
            </p>
            <button type="button" onClick={() => setStage('load')}
              className="px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Resume</button>
          </div>
        )}
      </div>

      {showStopModal && (
        <ConfirmStopModal
          weaponName={weapon.name}
          remaining={totalLoaded}
          onReload={() => setShowStopModal(false)}
          onReturn={handleStopReturn}
        />
      )}
    </div>
  )
}

function QuickAdd({ rounds, cap, onChange, onStep }: {
  rounds: number
  cap: number
  onChange: (n: number) => void
  onStep: (d: number) => void
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {[5, 10, 30].map(n => (
          <button type="button" key={n} onClick={() => onChange(rounds + n)} disabled={rounds + n > cap}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+{n}</button>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-2">
        <button type="button" onClick={() => onStep(-1)} disabled={rounds <= 0}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
        <input type="number" min="0" value={rounds} inputMode="numeric"
          onChange={e => onChange(Number(e.target.value))}
          className="w-16 px-2 py-1.5 border rounded-lg text-sm text-center" />
        <button type="button" onClick={() => onStep(1)} disabled={rounds >= cap}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+</button>
      </div>
      {rounds === 0 && <p className="text-xs text-neutral-400 mt-1">No rounds selected</p>}
    </div>
  )
}

function ConfirmStopModal({ weaponName, remaining, onReload, onReturn }: {
  weaponName: string
  remaining: number
  onReload: () => void
  onReturn: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-1">Stop {weaponName}?</h3>
        <p className="text-sm text-neutral-600 mb-4">
          {remaining} round{remaining === 1 ? '' : 's'} still loaded. Auto reload, or return them to the bag?
        </p>
        <div className="flex gap-3 mt-2">
          <button type="button" onClick={onReload}
            className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Auto Reload</button>
          <button type="button" onClick={onReturn}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer">Auto Return to Bag</button>
        </div>
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
  const [weapons, setWeapons] = useState<Weapon[]>(initialSession.weapons ?? [])
  const [gunLoaded, setGunLoaded] = useState<GunLoaded[]>(initialSession.gunLoaded ?? [])
  const [strings, setStrings] = useState<RangeDayString[]>(initialSession.strings ?? [])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>(initialAmmoTypes)

  const [showEndModal, setShowEndModal] = useState(false)

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
    if (action === 'shoot') setStrings(prev => [...prev, data.string])
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

  const handleEnd = async () => {
    const res = await apiFetch(`/ammo/range-days/${session.id}/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!res.ok) { alert('Error ending session'); return }
    setShowEndModal(false)
    onSessionEnd()
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {showEndModal && (
        <ConfirmEndModal bag={bag} onConfirm={handleEnd} onCancel={() => setShowEndModal(false)} />
      )}

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-4xl flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-neutral-400 hover:text-neutral-700 cursor-pointer">← Back</button>
            <h1 className="text-lg font-bold tracking-tight">Range Day</h1>
            {session.note && <span className="text-neutral-500 text-sm">· {session.note}</span>}
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">Active</span>
          </div>
          <button onClick={() => setShowEndModal(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 cursor-pointer">
            End Range Day
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Per-weapon Load / Shoot / Return */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Weapons</h2>
          {weapons.length === 0 ? (
            <p className="text-neutral-400 text-sm">No weapons selected for this range day.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {weapons.map(w => (
                <WeaponRangeCard key={w.id} weapon={w} bag={bag} ammoTypes={ammoTypes}
                  gunLoaded={gunLoaded} strings={strings} onAction={doAction} typeForId={typeForId} />
              ))}
            </div>
          )}
        </section>

        {/* Bag Contents */}
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

        {/* Shooting strings */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Shooting Log</h2>
          {strings.length === 0 ? (
            <p className="text-neutral-400 text-sm">No shots recorded yet.</p>
          ) : (
            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
              {strings.slice().reverse().map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {weaponForId(s.weaponId)?.name ?? `Weapon #${s.weaponId}`}
                      <span className="text-neutral-400 font-normal"> · {typeForId(s.ammoTypeId)?.name ?? `Type #${s.ammoTypeId}`}</span>
                    </p>
                    <p className="text-xs text-neutral-400">
                      {s.rounds} rounds · {relativeTime(s.occurredAt)}
                      {s.note ? ` · ${s.note}` : ''}
                    </p>
                  </div>
                  <button onClick={() => deleteString(s.id)}
                    className="text-xs text-neutral-400 hover:text-red-500 cursor-pointer">Delete</button>
                </div>
              ))}
            </div>
          )}
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

function NewWeaponForm({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [caliber, setCaliber] = useState('')
  const [type, setType] = useState('handgun')
  const [serialNumber, setSerialNumber] = useState('')
  const [notes, setNotes] = useState('')
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
        className="px-3 py-2 border rounded-lg text-sm">
        <option value="handgun">Handgun</option>
        <option value="rifle">Rifle</option>
        <option value="shotgun">Shotgun</option>
      </select>
      <input type="text" placeholder="Serial number (optional)" value={serialNumber}
        onChange={e => setSerialNumber(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      <input type="text" placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Create</button>
    </form>
  )
}

function WeaponManager({ weapons, onRefresh }: { weapons: Weapon[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editData, setEditData] = useState<Partial<Weapon>>({})
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [history, setHistory] = useState<Record<number, any>>({})
  const [historyLoading, setHistoryLoading] = useState<Record<number, boolean>>({})
  const [totals, setTotals] = useState<Record<number, number>>({})

  useEffect(() => {
    let cancelled = false
    apiFetch('/weapons/firing-summary')
      .then(r => (r.ok ? r.json() : Promise.resolve([])))
      .then((arr: { weaponId: number; totalRounds: number }[]) => {
        if (cancelled) return
        const map: Record<number, number> = {}
        for (const t of arr) map[t.weaponId] = t.totalRounds
        setTotals(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const startEdit = (w: Weapon) => {
    setEditingId(w.id)
    setEditData({ name: w.name, caliber: w.caliber, type: w.type, serialNumber: w.serialNumber, notes: w.notes })
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

  const toggleExpand = async (w: Weapon) => {
    if (expandedId === w.id) { setExpandedId(null); return }
    setExpandedId(w.id)
    if (!history[w.id]) {
      setHistoryLoading(h => ({ ...h, [w.id]: true }))
      try {
        const res = await apiFetch(`/weapons/${w.id}/history`)
        if (res.ok) {
          const data = await res.json()
          setHistory(h => ({ ...h, [w.id]: data }))
        }
      } finally {
        setHistoryLoading(h => ({ ...h, [w.id]: false }))
      }
    }
  }

  const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString()
  const fmtTime = (d: string | Date) => new Date(d).toLocaleString()

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Your Weapons</h3>
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
        <p className="text-sm text-neutral-500">No weapons yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {weapons.map(w => {
            const hist = history[w.id]
            const total = totals[w.id]
            const loading = historyLoading[w.id]
            return (
              <div key={w.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm p-5 flex flex-col">
                {editingId === w.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={editData.name ?? ''} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm" placeholder="Name" />
                    <CaliberSelect value={editData.caliber ?? ''} onChange={v => setEditData(d => ({ ...d, caliber: v }))} />
                    <select value={editData.type ?? 'handgun'} onChange={e => setEditData(d => ({ ...d, type: e.target.value }))} className="px-2 py-1 border rounded text-sm">
                      <option value="handgun">Handgun</option>
                      <option value="rifle">Rifle</option>
                      <option value="shotgun">Shotgun</option>
                    </select>
                    <input value={editData.serialNumber ?? ''} onChange={e => setEditData(d => ({ ...d, serialNumber: e.target.value || null }))} className="px-2 py-1 border rounded text-sm" placeholder="Serial" />
                    <input value={editData.notes ?? ''} onChange={e => setEditData(d => ({ ...d, notes: e.target.value || null }))} className="px-2 py-1 border rounded text-sm" placeholder="Notes" />
                    <div className="flex gap-2 mt-1">
                      <button onClick={saveEdit} className="text-xs px-2 py-1 bg-black text-white rounded cursor-pointer hover:opacity-80">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-bold text-neutral-900">{w.name}</p>
                        <p className="text-xs text-neutral-400 capitalize mt-0.5">{w.type} · {w.caliber}</p>
                      </div>
                      <span className="shrink-0 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">{w.caliber}</span>
                    </div>

                    <div className="mt-4">
                      <p className="text-3xl font-bold text-neutral-900">{total?.toLocaleString() ?? '0'}</p>
                      <p className="text-xs text-neutral-400 mt-1">rounds fired · total</p>
                    </div>

                    {w.serialNumber && <p className="text-xs text-neutral-500 mt-3">S/N: {w.serialNumber}</p>}
                    {w.notes && <p className="text-xs text-neutral-500 mt-1 truncate">{w.notes}</p>}

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-neutral-100">
                      <button onClick={() => toggleExpand(w)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50">
                        {expandedId === w.id ? 'Hide History' : 'Firing History'}
                      </button>
                      <button onClick={() => startEdit(w)} className="text-xs px-2 py-1 border rounded cursor-pointer hover:bg-neutral-50">Edit</button>
                      <button onClick={() => deleteWeapon(w.id)} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded cursor-pointer hover:bg-red-50">Delete</button>
                    </div>

                    {expandedId === w.id && (
                      <div className="mt-3 pt-3 border-t border-neutral-100">
                        {loading ? (
                          <p className="text-sm text-neutral-500">Loading firing history…</p>
                        ) : hist ? (
                          <WeaponFiringHistoryView history={hist} fmtDate={fmtDate} fmtTime={fmtTime} />
                        ) : (
                          <p className="text-sm text-neutral-500">No firing history yet.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WeaponFiringHistoryView({ history, fmtDate, fmtTime }: {
  history: any
  fmtDate: (d: string | Date) => string
  fmtTime: (d: string | Date) => string
}) {
  const total = history.totalRounds ?? 0
  const sessions: any[] = history.sessions ?? []
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold">{total.toLocaleString()}</span>
        <span className="text-sm text-neutral-500">rounds fired total</span>
      </div>

      {history.byAmmoType?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {history.byAmmoType.map((a: any) => (
            <span key={a.ammoTypeId} className="text-xs px-2.5 py-1 bg-white border border-neutral-200 rounded-full text-neutral-700">
              {a.name} ({a.caliber}): <span className="font-semibold">{a.rounds.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-neutral-500">No range-day firing recorded for this weapon.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.sessionId} className="border border-neutral-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{fmtDate(s.startedAt)}{s.endedAt ? '' : ' (in progress)'}</span>
                <span className="text-xs text-neutral-500">{s.rounds.toLocaleString()} rounds</span>
              </div>
              {s.note && <p className="text-xs text-neutral-500 mb-2 italic">“{s.note}”</p>}
              <ul className="space-y-1">
                {s.strings.map((st: any) => (
                  <li key={st.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-700">
                      {st.ammoName} — <span className="font-medium">{st.rounds.toLocaleString()}</span> rounds
                      {st.note ? <span className="text-neutral-500 italic"> “{st.note}”</span> : null}
                    </span>
                    <span className="text-xs text-neutral-400">{fmtTime(st.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<QuickAction>(null)
  const [tab, setTab] = useState<'inventory' | 'types' | 'weapons' | 'history'>('inventory')
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
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'acquire', label: '+ Acquire' },
              { key: 'expend', label: '- Expend' },
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

          <button
            onClick={() => setActiveAction(activeAction === 'range-day' ? null : 'range-day')}
            className={`px-6 py-3 rounded-xl text-base font-semibold shadow-sm transition-colors cursor-pointer ${
              activeAction === 'range-day' ? 'bg-green-700 text-white' : 'bg-green-600 text-white hover:bg-green-700'
            }`}>
            ⇄ Start Range Day
          </button>
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
            <RangeDayStartForm ammoTypes={ammoTypes} weapons={weapons} inventory={inventory} onSuccess={handleRangeDayStart} onClose={() => setActiveAction(null)} />
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
          {(['inventory', 'types', 'weapons', 'history'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setViewingCaliberName(null) }}
              className={`px-4 py-2 text-sm font-medium capitalize cursor-pointer transition-colors ${
                tab === t
                  ? 'border-b-2 border-black text-black'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}>
              {t === 'weapons' ? 'Weapons' : t === 'types' ? 'Manage Types' : t === 'history' ? 'History' : 'Inventory'}
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

        {tab === 'weapons' && (
          <WeaponManager weapons={weapons} onRefresh={loadInventory} />
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
