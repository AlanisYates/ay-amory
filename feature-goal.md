# Feature Goals — Remaining

> Source of truth for next milestones. P0 done and staged in this commit; P1 #2 just completed. This file tracks what’s left for P1/P2 so work can resume without re-planning.

## Done (in this commit)
- **P0: Save intervals closes modal** — `CleaningModal.saveIntervals` now `await onSaved(); onClose()`
- **P0: Weapons tab flash** — `WeaponManager` adds `totalsLoading`/`cleaningsLoading` skeletons instead of `0`/`Overdue` flash
- **P0: Summary 0 in bag** — `RangeDayDetailDrawer` now shows `Returned X` for ended sessions (`taken+acquired-fired`) vs `0 left`; `In Bag` vs `Loaded` tiles stage-aware
- **P1: Shoot All loop + V2 card** — `WeaponRangeCard` promoted to V2: hero `Photo` top + `name`/`caliber`/`type` + `Loaded/Fired RDS` middle (stage-aware `In Bag`/`Loaded`), `Shoot All — X RDS` split with dark-red chevron `▾` for `Shoot less / add note`, `✓ Shot X RDS` toast below hero, `Show breakdown` per-ammo, `↻ Redo last` per-weapon (persists across switches), single-gun focus (`activeWeaponId` ordered, slim `Out`/`Loaded` blue/red chips), `Out of ammo` cue
- **P1 #2: Separate Log Cleaning** — `CleaningModal` intervals only; new `LogCleaningModal` (`Log Cleaning — {weapon}` + `X RDS` + `Note` + `Log Cleaning` blue) opened via `WeaponManager` `Log Cleaning` button next to `Firing History`

## P1 Remaining (next)
1. **End Range Day more info** — `ConfirmEndModal` and `RangeDayDetailDrawer` need per-ammo `fired` vs `returned` + per-weapon + `on-site cost` breakdown (currently only `Fired · 20` + `Returned X` total). Should reuse `range_day_end` ledger entries.
2. **Edit Range Day view** — `RangeDayDetailDrawer` is read-only. Add `Edit` for `note`, add/remove `strings`, and `bag` adjustments with ledger rewind (currently only `Delete` in live `RangeDayView`).
3. **Laggy on bad internet** — `RangeDayView.doAction` waits for `apiFetch` before `setBag`/`setGunLoaded`. Add optimistic local update + `navigator.onLine` banner + retry. Longer term: offline queue (service worker).

## P2 Stretch (paused)
- Reusable `range bag profiles` (pack once, reuse)
- Magazine tracking per weapon (count + capacity)
- Price / cost-per-round rollups per weapon and per range day

## Notes
- `WeaponRangeCard` is now the V2 hero (`Photo` top, `In Bag`/`Loaded` middle, `Shoot All` split). No `V2 Preview` toggle anymore; `RangeDayView` uses single-gun focus (`activeWeaponId`) by default.
- `lastLoad` is per-weapon in `RangeDayView.lastLoadByWeapon` so `Redo last` persists across switches.
- All `P0` + `P1` V2 changes are staged in `apps/web/src/App.tsx` — `vite build` OK, `api test` 69/69. See `goals.md` for Weapons & Range-Day milestone context.
