DROP POLICY IF EXISTS "Authenticated users can insert knowledge nodes" ON public.knowledge_nodes;
DROP POLICY IF EXISTS "Authenticated users can update knowledge nodes" ON public.knowledge_nodes;

CREATE OR REPLACE FUNCTION public.upsert_knowledge_taxonomy(
  p_subject TEXT,
  p_knowledge_point TEXT,
  p_category TEXT DEFAULT NULL,
  p_branch TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject TEXT;
  v_knowledge_point TEXT;
  v_category TEXT;
  v_branch TEXT;
  v_tag public.tag_catalog;
  v_knowledge_point_row public.knowledge_points;
BEGIN
  v_subject := COALESCE(NULLIF(TRIM(p_subject), ''), '英语');
  v_knowledge_point := NULLIF(TRIM(COALESCE(p_knowledge_point, '')), '');
  v_category := COALESCE(NULLIF(TRIM(p_category), ''), '未分类');
  v_branch := COALESCE(NULLIF(TRIM(p_branch), ''), '未分类');

  IF v_knowledge_point IS NULL THEN
    RAISE EXCEPTION 'knowledge_point_required';
  END IF;

  v_tag := public.upsert_tag_catalog(v_subject, v_knowledge_point, v_category, v_branch, NULL);

  INSERT INTO public.knowledge_points (subject, name, category_code, created_at)
  VALUES (v_subject, v_knowledge_point, NULLIF(v_tag.code, ''), NOW())
  ON CONFLICT (subject, name)
  DO UPDATE SET category_code = COALESCE(NULLIF(EXCLUDED.category_code, ''), public.knowledge_points.category_code)
  RETURNING * INTO v_knowledge_point_row;

  INSERT INTO public.knowledge_nodes (subject, category, branch, node, tips_and_tricks, updated_at)
  VALUES (v_subject, v_category, v_branch, v_knowledge_point, '', NOW())
  ON CONFLICT (subject, category, node)
  DO UPDATE SET branch = EXCLUDED.branch, updated_at = NOW();

  INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source, created_at, updated_at)
  VALUES ('knowledge_point', v_subject, v_knowledge_point, 0, 'db', NOW(), NOW())
  ON CONFLICT (item_type, subject, label)
  DO UPDATE SET updated_at = NOW();

  RETURN jsonb_build_object(
    'tag', to_jsonb(v_tag),
    'knowledge_point', to_jsonb(v_knowledge_point_row),
    'node', jsonb_build_object(
      'subject', v_subject,
      'category', v_category,
      'branch', v_branch,
      'node', v_knowledge_point
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_knowledge_taxonomy(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_knowledge_taxonomy(TEXT, TEXT, TEXT, TEXT) TO authenticated;
