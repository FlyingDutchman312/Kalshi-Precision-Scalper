CREATE TABLE IF NOT EXISTS public.precision_scalper_strategies_v13 (
 strategy text NOT NULL CHECK (strategy IN ('baseline','aggressive','balanced','conservative')),
 ticker text NOT NULL, symbol text NOT NULL,
 side text NOT NULL CHECK (side IN ('yes','no')),
 ask double precision NOT NULL CHECK (ask > 0 AND ask < 1),
 bid double precision NOT NULL CHECK (bid > 0 AND bid <= ask),
 seconds_left double precision NOT NULL,
 observed_at timestamptz NOT NULL, close_at timestamptz NOT NULL,
 quote_at timestamptz NOT NULL, model_probability double precision CHECK (model_probability BETWEEN 0 AND 1), source text,
 result text CHECK (result IN ('yes','no')), settled_at timestamptz,
 PRIMARY KEY (strategy,ticker)
);
ALTER TABLE public.precision_scalper_strategies_v13 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.precision_scalper_strategies_v13 FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.precision_scalper_strategies_v13 TO service_role;
CREATE INDEX IF NOT EXISTS precision_scalper_v13_pending ON public.precision_scalper_strategies_v13(close_at) WHERE result IS NULL;
