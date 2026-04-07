DO $$
BEGIN
  IF to_regclass('public.mistakes') IS NOT NULL THEN
    ALTER TABLE public.mistakes
      ADD COLUMN IF NOT EXISTS mistake_point TEXT;
    CREATE INDEX IF NOT EXISTS idx_mistakes_mistake_point ON public.mistakes(mistake_point);
  END IF;
END $$;
