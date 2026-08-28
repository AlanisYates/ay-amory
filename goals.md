# Goals

> This file is the source of truth for what the code does. Update it whenever the
> implementation diverges from the plan so the description stays accurate.

## Milestone: Weapons & Range-Day Tracking

### 1. Weapons registry — DONE
- `weapons` table: `userId`, `name`, `caliber`, `type` (handgun/rifle/shotgun), `serialNumber`, `notes`, timestamps.
- API: `GET/POST /weapons`, `GET/PATCH/DELETE /weapons/:id` (JWT, user-scoped).
- Web: Weapons dashboard tab with `WeaponManager` (inline edit/delete) and `NewWeaponForm` (reuses `CaliberSelect`).
- `weapons` added to the Vite proxy.

### 2. Range-day shooting flow (staging + Load/Shoot/Return) — DONE
The range day is a live, per-gun tracked session. Ammo and guns are "packed" up
front (staging), then at the range you log shooting as you go; the bag draws down
live and every shot is attributed to a weapon.

**Staging / pack**
- Start a range day by selecting ammo (→ bag) AND the weapons brought (multi-select from registry).
- Finalize alert: for each brought weapon, if the staged bag has no ammo of that weapon's caliber, show a non-blocking warning ("brought Glock 19 (9mm) but no 9mm ammo").

**Session operations (all write real ledger entries; bag stays source of truth)**
- `Load` — move N rounds of an ammo type `bag → gun` (new ledger location `gun`). Still owned, not expended. Keyed by (weapon, ammoType).
- `Shoot` (a string) — N rounds `gun → equity`, tagged with `weapon_id`. History row in `range_day_strings`.
- `Return unshot` — N rounds `gun → bag` (the "loaded 15, shot 10, put 5 back" case). Not expended.
- Example: Load 15 (bag−15, gun+15) → Shoot 10 (gun−10, equity+10) → Return 5 (gun−5, bag+5). Net bag −10 = the 10 fired.

**Schema**
- `range_day_weapons(session_id, weapon_id)` — guns brought to a session.
- `range_day_strings(id, session_id, weapon_id, ammo_type_id, rounds, occurred_at, note)` — shots (history).
- `ammo_ledger_entries.weapon_id` (nullable FK → weapons).
- Ledger `location` gains value `gun` (free-text column, no migration needed).
- Transaction types: keep existing; add `range_day_load`, `range_day_shot`, `range_day_return`.

**No negative bag (enforced server-side)**
- Load ≤ current bag of that ammo type.
- Shoot ≤ current gun-loaded of that (weapon, ammoType).
- Return ≤ current gun-loaded of that (weapon, ammoType).
- Reject with 422 otherwise; the bag can never go negative.

**Editable / corrections**
- While the session is active, Load/Shoot/Return are mutable (delete a string and re-log; or Return unshot to push excess back to bag). Each edit replaces that operation's ledger entries; the bag recomputes from ledger.

**End of day**
- Opt-in on top of the existing model: if the session has any shoots/strings, end-of-day only returns physical leftovers (bag → storage); expenditure is already in `equity` via shoots. If the session has NO strings (legacy path), keep the old "derive expenditure from returned amount" behavior. Prevents double-counting.

**Tracking totals**
- Per gun: `SUM(rounds) FROM range_day_strings WHERE weapon_id = X` (or sum equity ledger entries with that `weapon_id`).
- Overall: sum all strings (== sum all expenditure equity entries). Both agree because they are the same writes.
- Weapon history view (milestone 3) is just `range_day_strings WHERE weapon_id = X` ordered by time, with a running total.

**Pitfalls & mitigations**
- Double-count at end-of-day → opt-in fallback above (strings present ⇒ no derivation). Also: any ammo still loaded in a gun at end-of-day is auto-unloaded (`gun → storage`) so it isn't lost.
- Loaded is per (weapon, ammoType), not per gun → key gun-loaded by (weapon, ammoType); Return must know which ammo type.
- `gun` ledger location must be included in bag math (`getBagContents` sums `location='bag'`; Load writes `bag(−N)`, Return writes `bag(+N)`) or loaded ammo "disappears" from the bag view.
- Editing must reverse old ledger entries or the bag drifts. Deleting a string reverses its `gun→equity` entries via `range_day_strings.transaction_id`.
- Staging is a plan; only "Start Range Day" moves ammo storage → bag. Don't double-move.
- Caliber mismatch (weapon vs ammo) allowed but warned, not blocked (web shows an amber warning in the Load/Shoot/Return form).
- Tests: Load/Shoot/Return path tests added in `apps/api/src/range-day.test.ts` (draw-down, over-load/over-shoot rejection, per-gun totals, return-unshot, delete-reversal, end-of-day leftover unload). Legacy no-string sessions keep the derive-expenditure fallback.
- Reload/resume: `GET /ammo/range-days/:id` returns `bag`, `weapons`, `strings`, and `gunLoaded`; the web `RangeDayView` restores all of them on mount.

**Implementation notes**
- `ammoLedgerEntries` got a nullable `weaponId` column (`gun` location entries carry it).
- API: `POST /ammo/range-days/:id/load|shoot|return`, `DELETE /ammo/range-days/:id/strings/:id`, start accepts `weapons[]`, detail returns weapons/strings/gunLoaded, end defaults to returning all bag (+auto-unload) when no `returnAmmo` supplied.
- Web: `RangeDayStartForm` adds weapon multi-select; `RangeDayView` replaced the old derive-expenditure UI with the live Load/Shoot/Return log, per-weapon loaded/fired, caliber-mismatch warning, relative-time strings, and delete.

### 3. Lifetime weapon stats
- Aggregate strings by weapon → total rounds fired per weapon / per caliber, with a history view (reuses `range_day_strings`).

### 4. Cleanings
- `weaponCleanings` table: `weaponId`, `cleanedAt`, `roundCountAtClean`, `note`.
- Derive "last cleaned" and "rounds since last clean" per weapon (total fired − rounds at last clean).
- "Due for cleaning?" indicator in the weapon view.

## Stretch (later)
- Persisted reusable "range bag profiles" (pack once, reuse).
- Magazine tracking per weapon (count + capacity) — NOT needed for #2; rounds are logged per gun per bout, not per mag.
- Price/cost-per-round rollups per weapon and per range day.
