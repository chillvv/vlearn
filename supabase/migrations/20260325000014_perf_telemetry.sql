CREATE TABLE IF NOT EXISTS perf_telemetry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE perf_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own perf telemetry"
  ON perf_telemetry FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own perf telemetry"
  ON perf_telemetry FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_perf_telemetry_user_created ON perf_telemetry(user_id, created_at DESC);
