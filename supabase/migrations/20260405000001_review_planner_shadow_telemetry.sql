-- Create table for storing review planner telemetry and shadow run results
CREATE TABLE IF NOT EXISTS review_plan_telemetry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    plan_source text NOT NULL DEFAULT 'rule_fallback',
    plan_version text,
    fallback_reason text,
    schema_validation_passed boolean,
    planning_latency_ms integer,
    request_summary jsonb,
    rule_queue_snapshot jsonb,
    shadow_queue_snapshot jsonb,
    comparison_summary jsonb,
    risk_flags jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Index for querying telemetry by user or request
CREATE INDEX IF NOT EXISTS idx_review_plan_telemetry_user_id ON review_plan_telemetry(user_id);
CREATE INDEX IF NOT EXISTS idx_review_plan_telemetry_request_id ON review_plan_telemetry(request_id);
CREATE INDEX IF NOT EXISTS idx_review_plan_telemetry_created_at ON review_plan_telemetry(created_at);

-- RLS policies
ALTER TABLE review_plan_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own telemetry"
    ON review_plan_telemetry FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own telemetry"
    ON review_plan_telemetry FOR SELECT
    USING (auth.uid() = user_id);
