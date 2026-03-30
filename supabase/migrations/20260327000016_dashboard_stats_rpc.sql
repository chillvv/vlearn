CREATE OR REPLACE FUNCTION get_dashboard_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_total INTEGER := 0;
    v_due_review_count INTEGER := 0;
    v_new_this_week INTEGER := 0;
    v_weakness_count INTEGER := 0;
    v_subject_counts JSONB := '{}'::JSONB;
    v_subject_mastery JSONB := '[]'::JSONB;
    v_error_types JSONB := '[]'::JSONB;
    v_weaknesses_list JSONB := '[]'::JSONB;
    v_top_weakness JSONB := NULL;
    v_weekly_activity JSONB := '[0,0,0,0,0,0,0]'::JSONB;
    v_recent JSONB := '[]'::JSONB;
BEGIN
    SELECT COUNT(*) INTO v_total
    FROM questions q
    WHERE q.user_id = p_user_id;

    SELECT COUNT(*) INTO v_due_review_count
    FROM questions q
    WHERE q.user_id = p_user_id
      AND (q.next_review_date IS NULL OR q.next_review_date <= NOW());

    SELECT COUNT(*) INTO v_new_this_week
    FROM questions q
    WHERE q.user_id = p_user_id
      AND q.created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '6 days';

    SELECT COALESCE(COUNT(*), 0) INTO v_weakness_count
    FROM user_weakness uw
    WHERE uw.user_id = p_user_id;

    SELECT COALESCE(
        JSONB_OBJECT_AGG(t.subject, t.cnt),
        '{}'::JSONB
    ) INTO v_subject_counts
    FROM (
        SELECT COALESCE(q.subject, '未知') AS subject, COUNT(*)::INTEGER AS cnt
        FROM questions q
        WHERE q.user_id = p_user_id
        GROUP BY COALESCE(q.subject, '未知')
    ) t;

    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'subject', t.subject,
                'count', t.cnt,
                'score', t.score
            )
            ORDER BY t.cnt DESC
        ),
        '[]'::JSONB
    ) INTO v_subject_mastery
    FROM (
        SELECT
            COALESCE(q.subject, '未知') AS subject,
            COUNT(*)::INTEGER AS cnt,
            ROUND(AVG(COALESCE(q.mastery_level, ROUND(COALESCE(q.confidence, 0.5) * 100))))::INTEGER AS score
        FROM questions q
        WHERE q.user_id = p_user_id
        GROUP BY COALESCE(q.subject, '未知')
    ) t;

    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'name', t.error_type,
                'value', t.percent
            )
            ORDER BY t.cnt DESC
        ),
        '[]'::JSONB
    ) INTO v_error_types
    FROM (
        SELECT
            COALESCE(q.error_type, '未分类') AS error_type,
            COUNT(*)::INTEGER AS cnt,
            CASE WHEN SUM(COUNT(*)) OVER() = 0 THEN 0
            ELSE ROUND((COUNT(*)::NUMERIC / SUM(COUNT(*)) OVER()) * 100)::INTEGER
            END AS percent
        FROM questions q
        WHERE q.user_id = p_user_id
        GROUP BY COALESCE(q.error_type, '未分类')
        ORDER BY cnt DESC
        LIMIT 3
    ) t;

    SELECT COALESCE(
        JSONB_AGG(
            TO_JSONB(t)
            ORDER BY t.error_count DESC
        ),
        '[]'::JSONB
    ) INTO v_weaknesses_list
    FROM (
        SELECT uw.*
        FROM user_weakness uw
        WHERE uw.user_id = p_user_id
        ORDER BY uw.error_count DESC
        LIMIT 4
    ) t;

    SELECT CASE
        WHEN JSONB_ARRAY_LENGTH(v_weaknesses_list) > 0 THEN v_weaknesses_list -> 0
        ELSE NULL
    END INTO v_top_weakness;

    SELECT COALESCE(
        JSONB_AGG(t.cnt ORDER BY t.day_key),
        '[0,0,0,0,0,0,0]'::JSONB
    ) INTO v_weekly_activity
    FROM (
        SELECT
            gs.day_key,
            COALESCE(d.cnt, 0)::INTEGER AS cnt
        FROM GENERATE_SERIES(0, 6) gs(day_key)
        LEFT JOIN (
            SELECT
                (DATE_TRUNC('day', q.created_at)::DATE - (DATE_TRUNC('day', NOW())::DATE - 6))::INTEGER AS day_key,
                COUNT(*)::INTEGER AS cnt
            FROM questions q
            WHERE q.user_id = p_user_id
              AND q.created_at >= DATE_TRUNC('day', NOW()) - INTERVAL '6 days'
            GROUP BY (DATE_TRUNC('day', q.created_at)::DATE - (DATE_TRUNC('day', NOW())::DATE - 6))
        ) d ON d.day_key = gs.day_key
    ) t;

    SELECT COALESCE(
        JSONB_AGG(TO_JSONB(t) ORDER BY t.created_at DESC),
        '[]'::JSONB
    ) INTO v_recent
    FROM (
        SELECT q.*
        FROM questions q
        WHERE q.user_id = p_user_id
        ORDER BY q.created_at DESC
        LIMIT 5
    ) t;

    RETURN JSONB_BUILD_OBJECT(
        'total', v_total,
        'weakness_count', v_weakness_count,
        'due_review_count', v_due_review_count,
        'top_weakness', v_top_weakness,
        'subject_counts', v_subject_counts,
        'new_this_week', v_new_this_week,
        'recent', v_recent,
        'subject_mastery', v_subject_mastery,
        'weekly_activity', v_weekly_activity,
        'error_types', v_error_types,
        'weaknesses_list', v_weaknesses_list
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
