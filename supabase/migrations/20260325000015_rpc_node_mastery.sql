CREATE OR REPLACE FUNCTION get_knowledge_node_mastery(p_user_id UUID, p_subject TEXT)
RETURNS TABLE (
    node_name TEXT,
    mastery INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(q.node, q.knowledge_point) AS node_name,
        ROUND(AVG(COALESCE(q.mastery_level, ROUND(COALESCE(q.confidence, 0.5) * 100))))::INTEGER AS mastery
    FROM questions q
    WHERE q.user_id = p_user_id AND q.subject = p_subject
    GROUP BY COALESCE(q.node, q.knowledge_point)
    ORDER BY mastery ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
