-- =====================================================================
-- Retire "KI-Verbrauchsprognose":
--  - Entfernt Trigger, Trigger-Funktion und Tabellen der KI-Prognose.
--  - Die App nutzt seit diesem Commit NUR noch den klassischen
--    Verbrauch aus inventory_history via usage_by_location_product_since(.._with_coverage).
--  - Der KI-Overlay wurde aus lib/db.ts entfernt, der Cron-Worker
--    app/api/ai/consumption/process ebenfalls. Diese Migration ist der
--    DB-seitige Gegenstück.
--
-- Idempotent: lässt sich beliebig oft ausführen.
-- =====================================================================

-- 1) Trigger auf inventory_history entfernen.
drop trigger if exists trg_ai_enqueue_consumption_job on public.inventory_history;

-- 2) Trigger-Funktion entfernen.
drop function if exists public.ai_enqueue_consumption_job();

-- 3) Tabellen entfernen (Reihenfolge egal, wir droppen mit cascade,
--    falls noch externe FKs/Views drauf hängen sollten).
drop table if exists public.ai_consumption_jobs cascade;
drop table if exists public.ai_consumption cascade;
