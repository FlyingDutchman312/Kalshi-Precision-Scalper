CREATE TABLE IF NOT EXISTS public.precision_scalper_probability_v11 (
 ticker text NOT NULL, checkpoint integer NOT NULL,
 symbol text NOT NULL, model text NOT NULL, observed_at timestamptz NOT NULL,
 close_at timestamptz NOT NULL, seconds_left double precision NOT NULL,
 spot double precision NOT NULL, target double precision NOT NULL,
 source text NOT NULL, spot_at timestamptz NOT NULL,
 p_yes double precision NOT NULL CHECK (p_yes BETWEEN 0 AND 1),
 market_p_yes double precision,
 result text CHECK (result IN ('yes','no')), settled_at timestamptz,
 PRIMARY KEY(ticker,checkpoint)
);
ALTER TABLE public.precision_scalper_probability_v11 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.precision_scalper_probability_v11 FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.precision_scalper_probability_v11 TO service_role;
CREATE INDEX IF NOT EXISTS precision_scalper_v11_pending ON public.precision_scalper_probability_v11(close_at) WHERE result IS NULL;
