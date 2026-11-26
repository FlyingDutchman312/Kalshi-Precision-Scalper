-- Add only the new research label; preserve existing records and permissions.
BEGIN;
ALTER TABLE public.precision_scalper_strategies_v13 DROP CONSTRAINT IF EXISTS precision_scalper_strategies_v13_strategy_check;
ALTER TABLE public.precision_scalper_strategies_v13 ADD CONSTRAINT precision_scalper_strategies_v13_strategy_check CHECK (strategy IN ('baseline','aggressive','balanced','conservative','economic_edge_v14'));
COMMIT;
