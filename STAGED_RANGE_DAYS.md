# Staged Range Days — build tracker

Goal: pack ammo at home as a **staged** range day (editable, deletable). Clock starts
only on **Start range day**.

## Locked decisions
- Start while another is active: **BLOCK** (button disabled + hint, must end current first).
- Stock movement: **move-on-start** (staged create/edit/delete touches no inventory).

## Backend contract (apps/api — IN this repo)
- [x] Migration: `range_day_sessions.status TEXT DEFAULT 'staged' NOT NULL`;
      `started_at` nullable.
- [ ] `POST /ammo/range-days` accepts `staged?: boolean` → staged session,
      `startedAt: null`, no stock movement.
- [ ] `POST /ammo/range-days/:id/start` → sets `startedAt=now`, status active,
      performs storage→bag move. 404 if not staged, 409 if another active.
- [ ] `PATCH /ammo/range-days/:id` (note/ammo/weapons) staged-only, else 409.
- [ ] `DELETE /ammo/range-days/:id` staged-only, else 409.
- [x] Active-session lookup = `status='active'` (NOT `endedAt IS NULL`).
- [x] History/stats/totals exclude staged. List ordering null-startedAt last.

## Frontend (this repo)
- [x] Schema (`packages/db/src/schema.ts`) + TS type (`RangeDaySession`)
- [x] `RangeDayStartWizard`: stage + edit-prefill modes, staged/POST-vs-PATCH submit
- [ ] App `page='range-day-stage'` + `stageInitial` plumbing, entry from tab
- [ ] `RangeDaysTab`: Staged section, Start/Edit/Delete, null-startedAt guards
- [x] Auto-resume skips staged; timer guards null startedAt
- [x] Verify (parse/build/tsc), commit

## Rollout fallback (frontend works pre-backend)
Missing `status` ⇒ treated as active-when-started. Staged UI appears only when
backend returns `status='staged'`. Stage/start/edit/delete buttons surface
backend errors (404/409) as messages until the contract ships.

## Resume state
- Branch: feature/staged-range-days (local only, unpushed)
- Last green step: full frontend committed; backend contract pending
- Next: backend contract, then e2e (stage/start/edit/delete)
