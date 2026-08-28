# Goals

## Milestone: Weapons & Range-Day Tracking

### 1. Weapons registry
- New `weapons` table: `userId`, `name` (e.g. "Glock 19"), `caliber`, `type` (handgun/rifle/shotgun), `notes`, timestamps.
- CRUD in API (`/weapons`) and a manage-weapons view in the web UI.

### 2. Per-weapon expenditure — shooting strings ("range day inside a range day")
- New `rangeDayStrings` table: `sessionId`, `weaponId`, `ammoTypeId`, `rounds`, `startedAt`, `endedAt`, `note`.
- Add nullable `weaponId` FK to `ammoLedgerEntries` so an expenditure entry records *which gun* fired it.
- Log strings live during a session; each string decrements that ammo type's bag and attributes the expenditure to the weapon. Keeps the existing bag↔equity zero-sum invariant intact.
- Directly supports: two 9mm guns, 5 rounds from one, 30 from the other, logged as separate bouts (between target changes / mag reloads).

### 3. Lifetime weapon stats
- Aggregate strings by weapon -> total rounds fired per weapon / per caliber, with a history view.

### 4. Cleanings
- New `weaponCleanings` table: `weaponId`, `cleanedAt`, `roundCountAtClean`, `note`.
- Derive "last cleaned" date and "rounds since last clean" per weapon (total rounds fired minus rounds at last clean).
- Surface a "due for cleaning?" indicator in the weapon view.

## Design decisions (agreed)
- Use **shooting strings** (real-time, per-bout) rather than end-of-day allocation, to preserve the live per-gun narrative.
- `weaponId` is nullable on ledger entries so non-range-day expenditures (manual adjust/expend) don't require a weapon.

## Stretch (later)
- Magazine tracking per weapon (count + capacity) to aid load planning.
- Price/cost-per-round rollups per weapon and per range day.
