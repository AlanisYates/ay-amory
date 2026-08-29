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
  cleaningIntervalRounds: number | null; cleaningIntervalDays: number | null
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

function RangeDayStartWizard({ onComplete, onCancel }: {
  onComplete: (session: RangeDaySession) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [note, setNote] = useState('')
  const [selectedWeapons, setSelectedWeapons] = useState<number[]>([])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [rows, setRows] = useState<AmmoRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 1) { setStep(2); return }
    setError('')
    const ammo = rows.filter(r => r.quantity > 0)
    if (ammo.length === 0) { setError('Add at least one ammo type with quantity > 0'); return }
    const overLimit = ammo.some(r => r.quantity > availableFor(r.ammoTypeId))
    if (overLimit) { setError('One or more calibers exceed what you have in storage'); return }
    setSubmitting(true)
    const res = await apiFetch('/ammo/range-days', {
      method: 'POST',
      body: JSON.stringify({ note: note || null, ammo, weapons: selectedWeapons }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Error'); return }
    const session = await res.json()
    onComplete(session)
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-6 h-16">
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-700 cursor-pointer">← Cancel</button>
          <h1 className="text-lg font-bold tracking-tight">Start Range Day</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Step heading */}
        <h2 className="text-xl font-semibold text-center text-neutral-900 mb-6">
          {step === 1 ? 'Choose your weapons' : 'Choose your ammo'}
        </h2>

        {loading ? (
          <p className="text-neutral-500 text-sm">Loading…</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            {step === 1 && (
              <div>
                <p className="text-sm text-neutral-500 mb-3">Tap the weapons you're bringing. You can add more later on the Weapons tab.</p>
                {weapons.length === 0 ? (
                  <p className="text-sm text-neutral-400">No weapons yet — you can skip this and add them later.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {weapons.map(w => {
                      const selected = selectedWeapons.includes(w.id)
                      return (
                        <button type="button" key={w.id} onClick={() => toggleWeapon(w.id)}
                          className={`text-left rounded-xl border p-4 flex flex-col gap-3 transition-colors cursor-pointer ${
                            selected ? 'border-black bg-neutral-50 ring-1 ring-black' : 'border-neutral-200 bg-white hover:border-neutral-400'
                          }`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-neutral-900">{w.name}</p>
                              <p className="text-xs text-neutral-400 capitalize mt-0.5">{w.type} · {w.caliber}</p>
                            </div>
                            <span className="shrink-0 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">{w.caliber}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${selected ? 'bg-black text-white border-black' : 'border-neutral-300 text-transparent'}`}>✓</span>
                            <span className={selected ? 'text-neutral-900 font-medium' : 'text-neutral-400'}>
                              {selected ? 'In your range bag' : 'Add to range bag'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
                <button type="button" onClick={() => setStep(2)}
                  className="mt-6 px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">
                  Continue to Ammo →
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                {/* Keep the selected-weapon context visible on the ammo step */}
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-neutral-700">Your range bag</p>
                    <button type="button" onClick={() => setStep(1)}
                      className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer">Edit</button>
                  </div>
                  {selectedWeapons.length === 0 ? (
                    <p className="text-sm text-neutral-400">No weapons selected — you can add them later on the Weapons tab.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {weapons.filter(w => selectedWeapons.includes(w.id)).map(w => (
                        <span key={w.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-100 rounded-lg text-sm">
                          <span className="font-medium text-neutral-800">{w.name}</span>
                          <span className="text-xs text-neutral-400">{w.caliber}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <input type="text" placeholder="Note (e.g. Burro Canyon)" value={note}
                  onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />

                <div>
                  <p className="text-sm font-medium text-neutral-700 mb-2">Ammo to take</p>
                  {ammoStepTypes.length === 0 ? (
                    <p className="text-xs text-neutral-400 mt-2">
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
                              inCart ? 'border-black bg-neutral-50' : 'border-neutral-200 bg-white hover:border-neutral-400'
                            }`}>
                            <div>
                              <p className="font-semibold text-neutral-900">{t.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${over ? 'bg-red-100 text-red-700' : 'bg-neutral-100 text-neutral-500'}`}>{t.caliber}</span>
                                <span className={`text-xs ${over ? 'text-red-500' : 'text-neutral-400'}`}>{avail.toLocaleString()} in storage</span>
                              </div>
                            </div>
                            {inCart ? (
                              <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                                <QuickAdd rounds={qty} cap={avail}
                                  onChange={(n) => setAmmoQty(t.id, n)}
                                  onStep={(d) => stepAmmo(t.id, d)}
                                  steps={[50, 100]} step={1} inline />
                                <button type="button" onClick={() => toggleAmmo(t.id)} title="Remove"
                                  className="w-9 h-9 rounded-lg border border-neutral-200 text-neutral-400 hover:text-red-500 hover:border-red-200 cursor-pointer">×</button>
                              </div>
                            ) : (
                              <span className="text-sm text-neutral-400">Add</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setStep(1)}
                    className="px-4 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">← Back</button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 px-4 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer disabled:opacity-40">
                    Start Range Day
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </main>
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
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold mb-1">End Range Day</h3>
        <p className="text-sm text-neutral-600 mb-3">
          Any ammo left in the bag (<span className="font-semibold">{leftover}</span> rounds) will be returned to storage.
          Rounds already fired are recorded as expended.
        </p>

        <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
          <div className="px-3 py-2 flex justify-between text-sm">
            <span className="font-medium text-neutral-700">Fired this session</span>
            <span className="font-semibold">{totalFired}</span>
          </div>
          {[...firedByWeapon.entries()].map(([weaponId, byType]) => {
            const w = weapons.find(x => x.id === weaponId)
            const weaponTotal = [...byType.values()].reduce((a, b) => a + b, 0)
            return (
              <div key={weaponId} className="px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{w?.name ?? `Weapon #${weaponId}`}</span>
                  <span className="text-neutral-500">{weaponTotal}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {[...byType.entries()].map(([ammoTypeId, rounds]) => {
                    const t = ammoTypes.find(a => a.id === ammoTypeId)
                    return (
                      <div key={ammoTypeId} className="flex justify-between text-xs text-neutral-500 pl-3">
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
            <span className="font-medium text-neutral-700">Bought this session</span>
            <span className="font-semibold">{totalAcquired}</span>
          </div>
          {bag.filter(b => b.acquired > 0).map(b => {
            const t = ammoTypes.find(a => a.id === b.ammoTypeId)
            return (
              <div key={b.ammoTypeId} className="px-3 py-1.5 flex justify-between text-xs text-neutral-500">
                <span>{t?.name ?? `Type #${b.ammoTypeId}`}</span>
                <span>{b.acquired}</span>
              </div>
            )
          })}
        </div>

        <div className="flex gap-3 mt-4">
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
  const [stage, setStage] = useState<'load' | 'shoot'>(
    gunLoaded.some(g => g.weaponId === weapon.id && g.rounds > 0) ? 'shoot' : 'load'
  )
  const [showEndDialog, setShowEndDialog] = useState(false)

  // Keep a sensible default selection as the bag / gun changes for the current stage
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
      if (loaded.length && !loaded.some(g => g.ammoTypeId === ammoTypeId)) setAmmoTypeId(loaded[0].ammoTypeId)
    }
  }, [bag, gunLoaded, ammoTypeId, stage])

  const loaded = gunLoaded.filter(g => g.weaponId === weapon.id)

  // In the Load stage, only ever offer caliber-matching, in-stock ammo — never
  // mismatched calibers, even when nothing matches.
  const availableMatch = bag.filter(b => {
    const t = typeForId(b.ammoTypeId)
    return !!t && t.caliber === weapon.caliber && b.inBag > 0
  })

  // In the Shoot stage the active type must stay stable even after its loaded count
  // hits zero, otherwise the Fired stat (keyed to the active type) would reset. Use
  // the full loaded set, not just the non-empty entries.
  const selectOptions = stage === 'shoot' ? loaded : availableMatch
  const selectedValid = selectOptions.some(o => o.ammoTypeId === ammoTypeId)
  const activeTypeId = selectedValid ? ammoTypeId : (selectOptions[0]?.ammoTypeId ?? 0)

  // Auto-pick when there's a single unambiguous match; otherwise the user chooses
  // among the matching types in the dropdown.
  const autoMatch = availableMatch.length === 1 ? availableMatch[0] : null
  const loadTypeId = autoMatch ? autoMatch.ammoTypeId : activeTypeId

  const inBag = bag.find(b => b.ammoTypeId === loadTypeId)?.inBag ?? 0
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
    setRounds(0)
    setNote('')
    if (action === 'load') setStage('shoot')
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

  return (
    <>
    <div className="rounded-xl border border-neutral-200 bg-white p-4 flex flex-col">
      {/* Card face: the firearm, trading-card style */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-5 text-center">
        <span className="text-xl font-bold text-neutral-900">{weapon.name}</span>
        <div className="mt-2 flex justify-center">
          <span className="text-xs bg-white border border-neutral-200 text-neutral-500 px-2 py-0.5 rounded-full">{weapon.caliber}</span>
        </div>
      </div>

      {/* Hero stats: loaded / fired as side-by-side tiles */}
      <div className="mt-3 flex gap-2">
        <div className="border border-neutral-200 rounded-lg px-3 py-2 flex-1 text-center">
          <p className="text-xs text-neutral-400 uppercase tracking-wide">Loaded</p>
          <p className="text-5xl font-bold text-blue-600">{loadedForAmmo.toLocaleString()}</p>
        </div>
        <div className="border border-neutral-200 rounded-lg px-3 py-2 flex-1 text-center">
          <p className="text-xs text-neutral-400 uppercase tracking-wide">Fired</p>
          <p className="text-5xl font-bold text-red-600">{firedForAmmo.toLocaleString()}</p>
        </div>
      </div>

      {/* Mini-cart: tap an ammo type to select it */}
      <div className="mt-3">
        {inventoryItems.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {inventoryItems.map(it => {
              const t = typeForId(it.ammoTypeId)
              const sel = it.ammoTypeId === selectedTypeId
              return (
                <button type="button" key={it.ammoTypeId}
                  onClick={() => { setAmmoTypeId(it.ammoTypeId); setRounds(0) }}
                  className={`px-3 py-1.5 rounded-full border text-sm cursor-pointer ${sel ? 'bg-black text-white border-black' : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-50'}`}>
                  {t?.name ?? `Type #${it.ammoTypeId}`} · {it.rounds}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-neutral-500 mt-1">{stage === 'load' ? 'No matching ammo in the bag.' : 'Nothing loaded.'}</p>
        )}
        <p className="text-xs text-neutral-500 mt-2">{stage === 'load' ? 'Bag' : 'Loaded'} total: {inventoryTotal.toLocaleString()}</p>
      </div>

      {/* Centered counter */}
      <div className="flex items-center justify-center gap-4 mt-4">
        <button type="button" onClick={() => step(-1)} disabled={rounds <= 0}
          className="w-10 h-10 flex items-center justify-center border rounded-lg text-lg hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
        <input type="number" min="0" value={rounds} inputMode="numeric" onChange={e => setRoundsClamped(Number(e.target.value))}
          className="w-20 text-center text-3xl font-bold text-neutral-900 border-0 focus:outline-none" />
        <button type="button" onClick={() => step(1)} disabled={rounds >= cap}
          className="w-10 h-10 flex items-center justify-center border rounded-lg text-lg hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+</button>
      </div>

      {/* Bulk preset chips */}
      <div className="flex flex-wrap justify-center gap-2 mt-3">
        {[5, 10, 50].map(n => (
          <button type="button" key={n} onClick={() => setRoundsClamped(rounds + n)} disabled={rounds + n > cap}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+{n}</button>
        ))}
        {cap > 0 && (
          <button type="button" onClick={() => setRoundsClamped(cap)}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">All</button>
        )}
      </div>

      <input type="text" placeholder="Note (optional)" value={note}
        onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-full mt-4" />

      {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

      {stage === 'load' ? (
        <button type="button" onClick={() => act('load')}
          disabled={rounds === 0 || inBag === 0}
          className="w-full mt-3 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Load</button>
      ) : (
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={() => act('shoot')}
            disabled={rounds === 0 || loadedForAmmo === 0}
            className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Shoot</button>
          <button type="button" onClick={endRound}
            className="px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">End Round</button>
        </div>
      )}
    </div>

    {showEndDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-xl border border-neutral-200 p-5 max-w-sm w-full">
          <h3 className="text-base font-semibold text-neutral-900">End round?</h3>
          <p className="text-sm text-neutral-600 mt-2">
            You have <span className="font-semibold">{remainingTotal}</span> round(s) still in {weapon.name}.
            Return them to your bag?
          </p>
          {remainingEntries.length > 0 && (
            <ul className="mt-3 space-y-1">
              {remainingEntries.map(g => {
                const t = typeForId(g.ammoTypeId)
                return (
                  <li key={g.ammoTypeId} className="text-sm text-neutral-600 flex justify-between">
                    <span>{t?.name ?? `Type #${g.ammoTypeId}`}</span>
                    <span className="font-medium">{g.rounds}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {firedTotal > 0 && (
            <p className="text-xs text-neutral-400 mt-3">You've fired {firedTotal} round(s) so far this session.</p>
          )}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowEndDialog(false)}
              className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Cancel</button>
            <button type="button" onClick={confirmEndRound}
              className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Return to bag</button>
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
  const chip = "px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {steps.map(n => (
          <button type="button" key={n} onClick={() => onChange(rounds + n)} disabled={rounds + n > cap} className={chip}>+{n}</button>
        ))}
        <button type="button" onClick={() => onStep(-step)} disabled={rounds <= 0} className={chip}>−</button>
        <input type="number" min="0" value={rounds} inputMode="numeric"
          onChange={e => onChange(Number(e.target.value))}
          className="w-16 px-2 py-1.5 border rounded-lg text-sm text-center" />
        <button type="button" onClick={() => onStep(step)} disabled={rounds >= cap} className={chip}>+</button>
        {onMax && (
          <button type="button" onClick={onMax} disabled={cap === 0} className={chip}>All</button>
        )}
      </div>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {steps.map(n => (
          <button type="button" key={n} onClick={() => onChange(rounds + n)} disabled={rounds + n > cap}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+{n}</button>
        ))}
        {onMax && (
          <button type="button" onClick={onMax} disabled={cap === 0}
            className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">All</button>
        )}
      </div>
      <div className="flex items-center gap-1 mt-2">
        <button type="button" onClick={() => onStep(-step)} disabled={rounds <= 0}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">−</button>
        <input type="number" min="0" value={rounds} inputMode="numeric"
          onChange={e => onChange(Number(e.target.value))}
          className="w-16 px-2 py-1.5 border rounded-lg text-sm text-center" />
        <button type="button" onClick={() => onStep(step)} disabled={rounds >= cap}
          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-neutral-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">+</button>
      </div>
      {rounds === 0 && <p className="text-xs text-neutral-400 mt-1">No rounds selected</p>}
    </div>
  )
}

function AddAmmoModal({ ammoTypes, caption, onSubmit, onClose }: {
  ammoTypes: AmmoType[]
  caption: string
  onSubmit: (rows: AddAmmoRow[], note: string) => void
  onClose: () => void
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
      <div className="bg-white rounded-xl border border-neutral-200 p-5 max-w-md w-full">
        <h3 className="text-base font-semibold text-neutral-900">Add Ammo</h3>
        <p className="text-sm text-neutral-500 mt-1">{caption}</p>

        <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
          {ammoTypes.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-neutral-400">{t.caliber}</p>
              </div>
              <div className="flex items-center gap-1">
                <input type="text" inputMode="numeric" pattern="[0-9]*" value={qty[t.id] ?? ''} placeholder="qty"
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
                    setQty(prev => ({ ...prev, [t.id]: v }))
                  }}
                  className="w-16 px-2 py-1 border rounded-lg text-sm text-right" />
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 text-sm pointer-events-none">$</span>
                  <input type="text" inputMode="decimal" value={price[t.id] ?? ''} placeholder="0.00"
                    onChange={e => {
                      let v = e.target.value.replace(/[^0-9.]/g, '')
                      const p = v.split('.')
                      if (p.length > 2) v = p[0] + '.' + p.slice(1).join('')
                      if (p[1]?.length > 2) v = p[0] + '.' + p[1].slice(0, 2)
                      setPrice(prev => ({ ...prev, [t.id]: v }))
                    }}
                    className="w-20 pl-5 pr-2 py-1 border rounded-lg text-sm text-right" />
                </div>
              </div>
            </div>
          ))}

          {newTypes.length > 0 && (
            <div className="pt-1 space-y-1">
              {newTypes.map((nt, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-neutral-50 rounded-lg px-3 py-2">
                  <span className="font-medium">{nt.name} <span className="text-neutral-400 font-normal">· {nt.caliber}</span></span>
                  <span className="text-neutral-500">{nt.quantity} · {nt.price ? `$${Number(nt.price).toFixed(2)}` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showNew && (
          <div className="mt-3 border rounded-lg p-3 space-y-2">
            <input placeholder="Name" value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className="px-2 py-1 border rounded text-sm w-full" />
            <div className="flex gap-2">
              <CaliberSelect value={draft.caliber} onChange={v => setDraft(d => ({ ...d, caliber: v }))} />
              <input placeholder="Brand" value={draft.brand}
                onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))} className="px-2 py-1 border rounded text-sm w-24" />
            </div>
            <div className="flex gap-2">
              <input placeholder="Grain" value={draft.grain}
                onChange={e => setDraft(d => ({ ...d, grain: e.target.value.replace(/\D/g, '') }))} className="px-2 py-1 border rounded text-sm w-20" />
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Qty" value={draft.quantity}
                onChange={e => setDraft(d => ({ ...d, quantity: e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '') }))} className="px-2 py-1 border rounded text-sm w-20" />
              <div className="relative w-20">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 text-sm pointer-events-none">$</span>
                <input type="text" inputMode="decimal" placeholder="0.00" value={draft.price}
                  onChange={e => {
                    let v = e.target.value.replace(/[^0-9.]/g, '')
                    const p = v.split('.')
                    if (p.length > 2) v = p[0] + '.' + p.slice(1).join('')
                    if (p[1]?.length > 2) v = p[0] + '.' + p[1].slice(0, 2)
                    setDraft(d => ({ ...d, price: v }))
                  }} className="w-full pl-5 pr-2 py-1 border rounded text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addNewType}
                className="flex-1 px-2 py-1.5 bg-black text-white rounded-lg text-sm cursor-pointer hover:opacity-80">Add</button>
              <button type="button" onClick={() => setShowNew(false)}
                className="px-2 py-1.5 border rounded-lg text-sm cursor-pointer hover:bg-neutral-50">Cancel</button>
            </div>
          </div>
        )}
        {!showNew && (
          <button type="button" onClick={() => setShowNew(true)}
            className="text-sm text-neutral-600 mt-3 cursor-pointer hover:text-neutral-900">+ Add a new ammo type</button>
        )}

        <input type="text" placeholder="Note (optional)" value={note}
          onChange={e => setNote(e.target.value)} className="px-3 py-2 border rounded-lg text-sm w-full mt-3" />

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Cancel</button>
          <button type="button" onClick={submit}
            className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 cursor-pointer">Add</button>
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
  const [showAcquire, setShowAcquire] = useState(false)

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
    setShowEndModal(false)
    onSessionEnd()
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {showEndModal && (
        <ConfirmEndModal bag={bag} strings={strings} weapons={weapons} ammoTypes={ammoTypes}
          onConfirm={handleEnd} onCancel={() => setShowEndModal(false)} />
      )}

      {showAcquire && (
        <AddAmmoModal ammoTypes={ammoTypes}
          caption="Adds to your inventory and this range day's bag."
          onSubmit={handleAddAmmo} onClose={() => setShowAcquire(false)} />
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Bag Contents</h2>
            <button onClick={() => setShowAcquire(true)}
              className="text-sm px-3 py-1.5 bg-black text-white rounded-lg hover:opacity-80 cursor-pointer">+ Buy More Ammo</button>
          </div>
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

function AmmoTypeDetailView({ item, onBack, refreshKey = 0 }: { item: InventoryItem; onBack: () => void; refreshKey?: number }) {
  const [transactions, setTransactions] = useState<TxWithEntries[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/ammo/types/${item.id}/transactions`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false))
  }, [item.id, refreshKey])

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
        {avgPrice && (
          <div className="mt-4 pt-4 border-t border-neutral-100 flex gap-6 text-sm">
            <div>
              <p className="text-xs text-neutral-400 uppercase tracking-wide">Avg price / round</p>
              <p className="font-semibold text-neutral-900 tabular-nums">${avgPrice.perRound.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-400 uppercase tracking-wide">Total tracked</p>
              <p className="font-medium text-neutral-600 tabular-nums">{avgPrice.totalRounds.toLocaleString()} rds · ${(avgPrice.totalCents / 100).toFixed(2)}</p>
            </div>
          </div>
        )}
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
                <th className="px-4 py-3 text-right">Price paid</th>
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
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {tx.price != null ? (
                      <span className="text-neutral-700">
                        ${(tx.price / 100).toFixed(2)}
                        {net > 0 && <span className="text-neutral-400 text-xs ml-1">(${(tx.price / net / 100).toFixed(2)}/rd)</span>}
                      </span>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
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
    const liveItem = group.items.find(i => i.id === viewingItem.id) ?? viewingItem
    return <AmmoTypeDetailView item={liveItem} refreshKey={refreshKey} onBack={() => setViewingItem(null)} />
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

function CleaningModal({ weapon, totalRounds, cleanings, onClose, onSaved }: {
  weapon: Weapon; totalRounds: number; cleanings: WeaponCleaning[]; onClose: () => void; onSaved: () => void
}) {
  const latest = cleanings[0] ?? null
  const [intervalRounds, setIntervalRounds] = useState<string>(weapon.cleaningIntervalRounds?.toString() ?? '')
  const [intervalDays, setIntervalDays] = useState<string>(weapon.cleaningIntervalDays?.toString() ?? '')
  const [customRounds, setCustomRounds] = useState(false)
  const [customDays, setCustomDays] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

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
    onSaved()
  }

  const logNow = async () => {
    const res = await apiFetch(`/weapons/${weapon.id}/cleanings`, {
      method: 'POST',
      body: JSON.stringify({ roundCountAtCleaning: totalRounds, note: note || null }),
    })
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Error'); return }
    setNote('')
    onSaved()
  }

  const chip = (active: boolean) => `px-2.5 py-1 rounded-full text-xs border cursor-pointer ${active ? 'bg-black text-white border-black' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-neutral-200 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-neutral-900">Cleaning — {weapon.name}</h3>
              <p className="text-xs text-neutral-400 mt-1">{weapon.type} · {weapon.caliber} · {totalRounds.toLocaleString()} rds fired</p>
            </div>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none cursor-pointer">×</button>
          </div>

          <div className="mt-4 rounded-lg bg-neutral-50 border border-neutral-200 p-3">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-500">Since clean: <span className="font-semibold text-neutral-900">{roundsSince.toLocaleString()} rds</span> · {daysSince}d</span>
              <span className={overdue ? 'text-red-600 font-semibold' : 'text-neutral-500'}>
                {overdue ? `Overdue by ${dueRounds != null && dueRounds <= 0 ? Math.abs(dueRounds) + ' rds' : ''}${dueRounds != null && dueRounds <= 0 && dueDays != null && dueDays <= 0 ? ' · ' : ''}${dueDays != null && dueDays <= 0 ? Math.abs(dueDays) + 'd' : ''}` : `${dueRounds != null ? `Due in ${dueRounds} rds` : ''}${dueRounds != null && dueDays != null ? ' · ' : ''}${dueDays != null ? `in ${dueDays}d` : ''}${dueRounds == null && dueDays == null ? 'No interval set' : ''}`}
              </span>
            </div>
            {rInt != null && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-neutral-400 mb-1"><span>Rounds</span><span>{roundsSince}/{rInt}</span></div>
                <div className="h-2 bg-neutral-200 rounded-full overflow-hidden"><div className={`h-full ${overdue && dueRounds != null && dueRounds <= 0 ? 'bg-red-500' : 'bg-neutral-900'}`} style={{ width: `${pctRounds}%` }} /></div>
              </div>
            )}
            {dInt != null && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-neutral-400 mb-1"><span>Time</span><span>{daysSince}/{dInt}d</span></div>
                <div className="h-2 bg-neutral-200 rounded-full overflow-hidden"><div className={`h-full ${overdue && dueDays != null && dueDays <= 0 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pctDays}%` }} /></div>
              </div>
            )}
            <p className="text-[11px] text-neutral-400 mt-2">Last: {latest ? `${new Date(latest.cleanedAt).toLocaleDateString()} @ ${latest.roundCountAtCleaning.toLocaleString()} rds` : `Never — since ${new Date(weapon.createdAt).toLocaleDateString()} @ 0 rds`}</p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Interval — rounds</p>
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
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Interval — time</p>
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
            <p className="text-[11px] text-neutral-400 mt-1">Quick chips: 30d / 90d (3mo) / 180d / 365d</p>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Log cleaning</p>
            <input type="text" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} className="mt-2 w-full px-3 py-2 border rounded-lg text-sm" />
            <button type="button" onClick={logNow} className="mt-2 w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 cursor-pointer">Log Cleaning Now @ {totalRounds.toLocaleString()} rds</button>
            <p className="text-[11px] text-neutral-400 mt-1 text-center">Sets last cleaned to now — exported with history</p>
          </div>

          {cleanings.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">History ({cleanings.length})</p>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {cleanings.map(c => (
                  <div key={c.id} className="flex justify-between items-center text-sm border border-neutral-100 rounded-lg px-3 py-2">
                    <span className="text-neutral-700">{new Date(c.cleanedAt).toLocaleDateString()} <span className="text-neutral-400">@ {c.roundCountAtCleaning.toLocaleString()} rds</span></span>
                    <span className="text-xs text-neutral-400 truncate max-w-[120px]">{c.note ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-6">
            <button type="button" onClick={onClose} className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm hover:bg-neutral-50 cursor-pointer">Cancel</button>
            <button type="button" onClick={saveIntervals} disabled={saving} className="flex-1 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-80 disabled:opacity-40 cursor-pointer">Save intervals</button>
          </div>
        </div>
      </div>
    </div>
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
  const [cleanings, setCleanings] = useState<Record<number, WeaponCleaning[]>>({})
  const [cleaningWeapon, setCleaningWeapon] = useState<Weapon | null>(null)

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

  useEffect(() => {
    if (weapons.length === 0) return
    let cancelled = false
    Promise.all(weapons.map(w => apiFetch(`/weapons/${w.id}/cleanings`).then(r => r.ok ? r.json() : []).then((arr: WeaponCleaning[]) => ({ id: w.id, arr })).catch(() => ({ id: w.id, arr: [] }))))
      .then(results => {
        if (cancelled) return
        const map: Record<number, WeaponCleaning[]> = {}
        for (const r of results) map[r.id] = r.arr
        setCleanings(map)
      })
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {weapons.map(w => {
            const hist = history[w.id]
            const total = totals[w.id]
            const loading = historyLoading[w.id]
            return (
              <div key={w.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm p-5 flex flex-col h-full">
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

                    {(() => {
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
                            <button onClick={() => setCleaningWeapon(w)} className="w-full text-xs px-3 py-2 border border-dashed border-neutral-300 rounded-lg text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 cursor-pointer">
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
                        <div className={`mt-3 rounded-lg border p-3 ${overdue ? 'bg-red-50 border-red-200' : 'bg-neutral-50 border-neutral-200'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-semibold ${overdue ? 'text-red-700' : 'text-neutral-700'}`}>{overdue ? 'Overdue' : 'Cleaning due'}</span>
                            <button onClick={() => setCleaningWeapon(w)} className="text-[11px] text-neutral-500 hover:text-neutral-800 underline cursor-pointer">Manage →</button>
                          </div>
                          {rInt != null && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[11px] text-neutral-500 mb-1"><span>{roundsSince}/{rInt} rds</span><span>{dueRounds! > 0 ? `${dueRounds} left` : `${Math.abs(dueRounds!)} over`}</span></div>
                              <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden"><div className={`h-full ${dueRounds != null && dueRounds <= 0 ? 'bg-red-500' : 'bg-neutral-900'}`} style={{ width: `${pctRounds}%` }} /></div>
                            </div>
                          )}
                          {dInt != null && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[11px] text-neutral-500 mb-1"><span>{daysSince}/{dInt}d</span><span>{dueDays! > 0 ? `${dueDays}d left` : `${Math.abs(dueDays!)}d over`}</span></div>
                              <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden"><div className={`h-full ${dueDays != null && dueDays <= 0 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pctDays}%` }} /></div>
                            </div>
                          )}
                          <p className="text-[11px] text-neutral-400 mt-2">Last: {latest ? `${new Date(latest.cleanedAt).toLocaleDateString()} @ ${latest.roundCountAtCleaning.toLocaleString()} rds` : `Never`}{latest?.note ? ` · ${latest.note}` : ''}</p>
                        </div>
                      )
                    })()}

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

function InventoryDashboard({ inventory, weapons, totals, cleanings, onCaliberClick, onViewAmmo, onViewWeapons }: {
  inventory: InventoryItem[]; weapons: Weapon[]; totals: Record<number, number>; cleanings: Record<number, WeaponCleaning[]>
  onCaliberClick: (group: CaliberGroup) => void; onViewAmmo: () => void; onViewWeapons: () => void
}) {
  const groups = useMemo<CaliberGroup[]>(() => {
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
  const totalRounds = useMemo(() => inventory.reduce((s, i) => s + i.balance, 0), [inventory])
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-400 uppercase tracking-wide">Weapons</p>
          <p className="text-2xl font-bold mt-1">{weapons.length}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-400 uppercase tracking-wide">Rounds in storage</p>
          <p className="text-2xl font-bold mt-1">{totalRounds.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-400 uppercase tracking-wide">Ammo types</p>
          <p className="text-2xl font-bold mt-1">{inventory.length}</p>
        </div>
        <div className={`rounded-xl border p-4 ${cleaningDue > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-neutral-200'}`}>
          <p className={`text-xs uppercase tracking-wide ${cleaningDue > 0 ? 'text-red-600' : 'text-neutral-400'}`}>Cleaning due</p>
          <p className={`text-2xl font-bold mt-1 ${cleaningDue > 0 ? 'text-red-600' : ''}`}>{cleaningDue}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Ammo Overview</h3>
        <button onClick={onViewAmmo} className="text-xs text-neutral-500 hover:text-neutral-800 underline cursor-pointer">View all →</button>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-neutral-500 mb-8">No ammo yet — add some in the Ammo tab.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {groups.slice(0, 3).map(group => (
            <button key={group.caliber} onClick={() => onCaliberClick(group)} className="rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer">
              <p className="text-sm font-semibold text-neutral-900">{group.caliber}</p>
              <p className="text-xs text-neutral-400">{group.items.length} type{group.items.length !== 1 ? 's' : ''}</p>
              <p className="text-xl font-bold mt-2">{group.totalBalance.toLocaleString()}</p>
              <p className="text-xs text-neutral-400">rounds</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Weapons Preview</h3>
        <button onClick={onViewWeapons} className="text-xs text-neutral-500 hover:text-neutral-800 underline cursor-pointer">View all →</button>
      </div>
      {weapons.length === 0 ? (
        <p className="text-sm text-neutral-500">No weapons yet — add one in the Weapons tab.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {weapons.slice(0, 3).map(w => {
            const total = totals[w.id] ?? 0
            return (
              <div key={w.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <p className="text-sm font-semibold truncate">{w.name}</p>
                <p className="text-xs text-neutral-400 capitalize">{w.type} · {w.caliber}</p>
                <p className="text-lg font-bold mt-2">{total.toLocaleString()} rds</p>
                <p className="text-xs text-neutral-400">fired</p>
              </div>
            )
          })}
        </div>
      )}
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
      <div className="bg-white rounded-xl p-6">Loading session…</div>
    </div>
  )
  if (!detail) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl p-6">Not found <button onClick={onClose} className="ml-4 text-sm underline cursor-pointer">Close</button></div>
    </div>
  )

  const started = new Date(detail.startedAt)
  const ended = detail.endedAt ? new Date(detail.endedAt) : null
  const mins = ended ? Math.round((ended.getTime() - started.getTime()) / 60000) : null
  const duration = mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : 'In progress'
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
      <div className="bg-white rounded-xl border border-neutral-200 max-w-2xl w-full my-8">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">{started.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {duration}</h3>
              <p className="text-xs text-neutral-400 mt-1">{started.toLocaleString()} {ended ? `→ ${ended.toLocaleString()}` : ''}</p>
              {detail.note && <p className="text-sm text-neutral-600 mt-2 italic">“{detail.note}”</p>}
            </div>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl leading-none cursor-pointer">×</button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-center">
              <p className="text-2xl font-bold">{totalFired.toLocaleString()}</p>
              <p className="text-xs text-neutral-400">rds fired</p>
            </div>
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-center">
              <p className="text-2xl font-bold">{detail.weapons?.length ?? 0}</p>
              <p className="text-xs text-neutral-400">weapons</p>
            </div>
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-center">
              <p className="text-2xl font-bold">{sessionCostCents ? `$${(sessionCostCents / 100).toFixed(2)}` : '—'}</p>
              <p className="text-xs text-neutral-400">on-site cost</p>
            </div>
          </div>

          {byWeapon.size > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Per weapon</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...byWeapon.entries()].map(([wid, rds]) => {
                  const w = detail.weapons?.find((x: any) => x.id === wid)
                  return <span key={wid} className="text-xs px-2.5 py-1 bg-white border border-neutral-200 rounded-full">{w?.name ?? `Weapon #${wid}`} — <span className="font-semibold">{rds}</span> rds</span>
                })}
              </div>
            </div>
          )}

          {byAmmo.size > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Per ammo</p>
              <div className="mt-2 space-y-2">
                {[...byAmmo.entries()].map(([aid, rds]) => {
                  const t = typeById.get(aid)
                  const avg = t ? null : null
                  return (
                    <div key={aid} className="flex justify-between items-center text-sm border border-neutral-100 rounded-lg px-3 py-2">
                      <span className="font-medium">{t?.name ?? `Type #${aid}`} <span className="text-neutral-400 font-normal">· {t?.caliber ?? ''} · {rds} rds fired</span></span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {acquired.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Acquired on-site</p>
              <div className="mt-2 space-y-1">
                {acquired.map((tx: any) => {
                  const entry = tx.entries?.find((e: any) => !e.isBalancing)
                  const t = entry ? typeById.get(entry.ammoTypeId) : null
                  const qty = entry ? Math.abs(entry.quantity) : 0
                  const perRd = qty > 0 && tx.price != null ? (tx.price / qty / 100) : null
                  return (
                    <div key={tx.id} className="flex justify-between items-center text-sm border border-green-100 bg-green-50 rounded-lg px-3 py-2">
                      <span>{t?.name ?? `Type #${entry?.ammoTypeId}`} +{qty} rds</span>
                      <span className="tabular-nums font-medium">{tx.price != null ? `$${(tx.price / 100).toFixed(2)}` : '—'}{perRd != null ? <span className="text-neutral-500 font-normal"> (${perRd.toFixed(2)}/rd)</span> : null}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-neutral-400 mt-2">Price shown is total paid for that acquisition; per-round is price ÷ quantity. Avg $/round in Inventory is lifetime avg across all acquisitions where price was tracked.</p>
            </div>
          )}

          <div className="mt-6">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Strings</p>
            {strings.length === 0 ? (
              <p className="text-sm text-neutral-400 mt-2">No shots recorded.</p>
            ) : (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {strings.map((s: any) => {
                  const w = detail.weapons?.find((x: any) => x.id === s.weaponId)
                  const t = typeById.get(s.ammoTypeId)
                  return <div key={s.id} className="flex justify-between text-sm border-b border-neutral-50 py-1"><span>{w?.name ?? `W#${s.weaponId}`} · {t?.name ?? `A#${s.ammoTypeId}`} — {s.rounds} rds {s.note ? `“${s.note}”` : ''}</span><span className="text-xs text-neutral-400">{new Date(s.occurredAt).toLocaleTimeString()}</span></div>
                })}
              </div>
            )}
          </div>

          {bag.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Bag at end</p>
              <div className="mt-2 space-y-1">
                {bag.map((b: any) => {
                  const t = typeById.get(b.ammoTypeId)
                  return <div key={b.ammoTypeId} className="flex justify-between text-sm border border-neutral-100 rounded-lg px-3 py-2"><span>{t?.name ?? `Type #${b.ammoTypeId}`}</span><span className="tabular-nums text-neutral-500">{b.inBag} left (took {b.taken}, +{b.acquired} on-site)</span></div>
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

function RangeDaysTab() {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    apiFetch('/ammo/range-days')
      .then(r => r.ok ? r.json() : [])
      .then((arr: any[]) => setSessions(Array.isArray(arr) ? arr.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()) : []))
      .finally(() => setLoading(false))
  }, [])

  if (viewingId != null) return <RangeDayDetailDrawer sessionId={viewingId} onClose={() => setViewingId(null)} />

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Past Range Days</h3>
        <span className="text-xs text-neutral-400">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
      </div>
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-sm text-neutral-500">No range days yet — start one from the dashboard header.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => {
            const started = new Date(s.startedAt)
            const ended = s.endedAt ? new Date(s.endedAt) : null
            const mins = ended ? Math.round((ended.getTime() - started.getTime()) / 60000) : null
            const duration = mins != null ? `${Math.floor(mins / 60)}h ${mins % 60}m` : 'In progress'
            const isActive = !s.endedAt
            return (
              <button key={s.id} onClick={() => setViewingId(s.id)} className="w-full text-left rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-400 hover:shadow-sm transition-all cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{started.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {duration}</p>
                    <p className="text-xs text-neutral-400 mt-1">{started.toLocaleString()}{ended ? ` → ${ended.toLocaleString()}` : ''}</p>
                    {s.note && <p className="text-sm text-neutral-600 mt-2 italic">“{s.note}”</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>{isActive ? 'Active' : 'Completed'}</span>
                </div>
                <p className="text-xs text-neutral-500 mt-3">View details →</p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Dashboard View ────────────────────────────────────────────────────────

type QuickAction = 'acquire' | 'expend' | 'adjust' | 'new-type' | null

function DashboardView({ user, onLogout, onRangeDayStart, activeSession, onResumeRangeDay, onStartRangeDay }: {
  user: User
  onLogout: () => void
  onRangeDayStart: (session: RangeDaySession) => void
  activeSession: RangeDaySession | null
  onResumeRangeDay: () => void
  onStartRangeDay: () => void
}) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [ammoTypes, setAmmoTypes] = useState<AmmoType[]>([])
  const [weapons, setWeapons] = useState<Weapon[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<QuickAction>(null)
  const [tab, setTab] = useState<'inventory' | 'ammo' | 'types' | 'weapons' | 'history' | 'range-days'>('inventory')
  const [viewingCaliberName, setViewingCaliberName] = useState<string | null>(null)
  const [txRefreshKey, setTxRefreshKey] = useState(0)
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

        {/* Range Day CTA */}
        <div className="flex justify-end mb-6">
          {activeSession ? (
            <button
              onClick={onResumeRangeDay}
              className="px-6 py-3 rounded-xl text-base font-semibold shadow-sm bg-green-600 text-white hover:bg-green-700 transition-colors cursor-pointer">
              ⇄ Resume Range Day
            </button>
          ) : (
            <button
              onClick={onStartRangeDay}
              className="px-6 py-3 rounded-xl text-base font-semibold shadow-sm bg-green-600 text-white hover:bg-green-700 transition-colors cursor-pointer">
              ⇄ Start Range Day
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-neutral-200 mb-6 mt-8 overflow-x-auto">
          {(['inventory', 'ammo', 'types', 'weapons', 'history', 'range-days'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setViewingCaliberName(null); setActiveAction(null) }}
              className={`px-4 py-2 text-sm font-medium capitalize cursor-pointer transition-colors whitespace-nowrap ${
                tab === t
                  ? 'border-b-2 border-black text-black'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}>
              {t === 'weapons' ? 'Weapons' : t === 'types' ? 'Manage Types' : t === 'history' ? 'History' : t === 'ammo' ? 'Ammo' : t === 'range-days' ? 'Range Days' : 'Inventory'}
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
            <InventoryDashboard
              inventory={inventory}
              weapons={weapons}
              totals={weaponTotals}
              cleanings={weaponCleanings}
              onCaliberClick={g => setViewingCaliberName(g.caliber)}
              onViewAmmo={() => setTab('ammo')}
              onViewWeapons={() => setTab('weapons')}
            />
          )
        )}

        {tab === 'ammo' && (
          viewingCaliber ? (
            <CaliberDetailView
              group={viewingCaliber}
              refreshKey={txRefreshKey}
              onBack={() => setViewingCaliberName(null)}
            />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Your Ammo</h3>
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
                <p className="text-neutral-400 text-sm">Loading inventory...</p>
              ) : inventory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center">
                  <p className="text-neutral-500 mb-4">No ammo types yet — add some to get started.</p>
                  <button
                    onClick={() => setActiveAction('new-type')}
                    className="text-sm px-4 py-2 rounded-lg bg-black text-white hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    + New Ammo Type
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {ammoGroups.map(group => (
                      <div key={group.caliber} className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden flex flex-col">
                        <button
                          onClick={() => setViewingCaliberName(group.caliber)}
                          className="flex-1 p-5 text-left hover:bg-neutral-50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-start justify-between mb-1">
                            <p className="text-lg font-bold text-neutral-900">{group.caliber}</p>
                            <span className="ml-2 shrink-0 text-xs bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">
                              {group.items.length} type{group.items.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <p className={`text-3xl font-bold mt-2 ${balanceColor(group.totalBalance)}`}>
                            {group.totalBalance.toLocaleString()}
                          </p>
                          <p className="text-xs text-neutral-400 mt-1">rounds · tap for details</p>
                        </button>
                        <div className="flex gap-2 px-3 py-3 border-t border-neutral-100 bg-neutral-50">
                          <button
                            onClick={() => setActiveAction('adjust')}
                            className="flex-1 text-xs px-2 py-1.5 bg-white border border-neutral-200 rounded-lg hover:border-neutral-400 cursor-pointer"
                          >
                            Adjust
                          </button>
                          <button
                            onClick={() => setViewingCaliberName(group.caliber)}
                            className="flex-1 text-xs px-2 py-1.5 bg-white border border-neutral-200 rounded-lg hover:border-neutral-400 cursor-pointer"
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
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'expend' ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'}`}
                    >
                      - Expend
                    </button>
                    <button
                      onClick={() => setActiveAction(activeAction === 'adjust' ? null : 'adjust')}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'adjust' ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'}`}
                    >
                      Adjust
                    </button>
                    <button
                      onClick={() => setActiveAction(activeAction === 'new-type' ? null : 'new-type')}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${activeAction === 'new-type' ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'}`}
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
                </>
              )}
            </div>
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

        {tab === 'range-days' && (
          <RangeDaysTab />
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
  const [page, setPage] = useState<'dashboard' | 'range-day' | 'range-day-start'>('dashboard')
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

  if (page === 'range-day-start') {
    return (
      <RangeDayStartWizard
        onComplete={handleRangeDayStart}
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
    />
  )
}

export default App
