CREATE SEQUENCE IF NOT EXISTS public.tag_catalog_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.question_business_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.knowledge_point_business_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.tag_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '未分类',
  branch TEXT NOT NULL DEFAULT '其他',
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(subject, tag_name)
);

CREATE TABLE IF NOT EXISTS public.tag_dictionary_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_type TEXT NOT NULL CHECK (item_type IN ('knowledge_point', 'ability', 'error_type')),
  subject TEXT,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'db',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(item_type, subject, label)
);

CREATE TABLE IF NOT EXISTS public.tag_mistake_sub_bank (
  tag_id TEXT PRIMARY KEY REFERENCES public.tag_catalog(tag_id) ON DELETE CASCADE,
  question_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tag_knowledge_sub_bank (
  tag_id TEXT PRIMARY KEY REFERENCES public.tag_catalog(tag_id) ON DELETE CASCADE,
  knowledge_point_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.knowledge_points
  ADD COLUMN IF NOT EXISTS kp_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS tag_id TEXT,
  ADD COLUMN IF NOT EXISTS category_code TEXT;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS tag_id TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_point_id TEXT,
  ADD COLUMN IF NOT EXISTS id_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_points_tag_id_fkey') THEN
    ALTER TABLE public.knowledge_points
      ADD CONSTRAINT knowledge_points_tag_id_fkey
      FOREIGN KEY (tag_id) REFERENCES public.tag_catalog(tag_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_tag_id_fkey') THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_tag_id_fkey
      FOREIGN KEY (tag_id) REFERENCES public.tag_catalog(tag_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.generate_standard_tag_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := nextval('public.tag_catalog_seq');
  RETURN 'TAG_' || LPAD(v_seq::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_layered_business_id(
  p_prefix TEXT,
  p_category_code TEXT,
  p_sequence_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
  v_ts TEXT;
  v_code TEXT;
BEGIN
  EXECUTE format('SELECT nextval(%L)', p_sequence_name) INTO v_seq;
  v_ts := to_char(NOW(), 'YYYYMMDDHH24MISS');
  v_code := UPPER(regexp_replace(COALESCE(NULLIF(TRIM(p_category_code), ''), 'GEN'), '[^A-Z0-9]+', '', 'g'));
  IF length(v_code) < 2 THEN
    v_code := 'GEN';
  END IF;
  IF length(v_code) > 8 THEN
    v_code := substring(v_code FROM 1 FOR 8);
  END IF;
  RETURN UPPER(TRIM(p_prefix)) || '_' || v_code || '_' || v_ts || '_' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_tag_code(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
BEGIN
  v_code := UPPER(regexp_replace(COALESCE(p_input, ''), '[^A-Z0-9]+', '', 'g'));
  IF length(v_code) >= 3 THEN
    RETURN substring(v_code FROM 1 FOR 8);
  END IF;
  RETURN 'T' || substring(md5(COALESCE(p_input, 'tag')) FROM 1 FOR 5);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_tag_catalog(
  p_subject TEXT,
  p_tag_name TEXT,
  p_category TEXT DEFAULT NULL,
  p_branch TEXT DEFAULT NULL,
  p_code TEXT DEFAULT NULL
)
RETURNS public.tag_catalog
LANGUAGE plpgsql
AS $$
DECLARE
  v_name TEXT;
  v_subject TEXT;
  v_code TEXT;
  v_row public.tag_catalog;
  v_new_id TEXT;
BEGIN
  v_name := NULLIF(TRIM(COALESCE(p_tag_name, '')), '');
  IF v_name IS NULL THEN
    v_name := '未分类';
  END IF;
  v_subject := NULLIF(TRIM(COALESCE(p_subject, '')), '');
  IF v_subject IS NULL THEN
    v_subject := '英语';
  END IF;
  v_code := public.normalize_tag_code(COALESCE(NULLIF(TRIM(p_code), ''), v_name));

  SELECT * INTO v_row
  FROM public.tag_catalog
  WHERE subject = v_subject AND tag_name = v_name
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.tag_catalog
    SET category = COALESCE(NULLIF(TRIM(p_category), ''), category),
        branch = COALESCE(NULLIF(TRIM(p_branch), ''), branch),
        updated_at = NOW()
    WHERE tag_id = v_row.tag_id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  v_new_id := public.generate_standard_tag_id();
  BEGIN
    INSERT INTO public.tag_catalog (
      tag_id, subject, tag_name, category, branch, code, created_at, updated_at
    ) VALUES (
      v_new_id,
      v_subject,
      v_name,
      COALESCE(NULLIF(TRIM(p_category), ''), '未分类'),
      COALESCE(NULLIF(TRIM(p_branch), ''), '其他'),
      v_code,
      NOW(),
      NOW()
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
    FROM public.tag_catalog
    WHERE subject = v_subject AND tag_name = v_name
    LIMIT 1;
  END;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_question_id_path(
  p_tag_id TEXT,
  p_question_id TEXT
)
RETURNS TEXT
LANGUAGE SQL
AS $$
  SELECT '/' || COALESCE(NULLIF(TRIM(p_tag_id), ''), 'TAG_UNKNOWN') || '/mistakes/' || COALESCE(NULLIF(TRIM(p_question_id), ''), 'Q_UNKNOWN');
$$;

CREATE OR REPLACE FUNCTION public.attach_knowledge_point_tag_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tag public.tag_catalog;
BEGIN
  v_tag := public.upsert_tag_catalog(NEW.subject, NEW.name, NULL, NULL, NEW.category_code);
  NEW.tag_id := v_tag.tag_id;
  NEW.category_code := COALESCE(NULLIF(TRIM(NEW.category_code), ''), v_tag.code);
  IF NEW.kp_id IS NULL OR TRIM(NEW.kp_id) = '' THEN
    NEW.kp_id := public.generate_layered_business_id('KP', NEW.category_code, 'public.knowledge_point_business_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_knowledge_point_tag_fields ON public.knowledge_points;
CREATE TRIGGER trg_attach_knowledge_point_tag_fields
BEFORE INSERT OR UPDATE ON public.knowledge_points
FOR EACH ROW
EXECUTE FUNCTION public.attach_knowledge_point_tag_fields();

CREATE OR REPLACE FUNCTION public.attach_question_tag_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tag_name TEXT;
  v_tag public.tag_catalog;
BEGIN
  v_tag_name := COALESCE(NULLIF(TRIM(NEW.knowledge_point), ''), NULLIF(TRIM(NEW.node), ''), '未分类');
  v_tag := public.upsert_tag_catalog(NEW.subject, v_tag_name, NEW.category, NEW.node, NULL);
  NEW.tag_id := COALESCE(NULLIF(TRIM(NEW.tag_id), ''), v_tag.tag_id);
  IF NEW.question_id IS NULL OR TRIM(NEW.question_id) = '' THEN
    NEW.question_id := public.generate_layered_business_id('Q', v_tag.code, 'public.question_business_seq');
  END IF;
  IF NEW.knowledge_point_id IS NULL OR TRIM(NEW.knowledge_point_id) = '' THEN
    SELECT kp_id INTO NEW.knowledge_point_id
    FROM public.knowledge_points
    WHERE subject = NEW.subject AND name = v_tag_name
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  NEW.id_path := public.build_question_id_path(NEW.tag_id, NEW.question_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_question_tag_fields ON public.questions;
CREATE TRIGGER trg_attach_question_tag_fields
BEFORE INSERT OR UPDATE ON public.questions
FOR EACH ROW
EXECUTE FUNCTION public.attach_question_tag_fields();

CREATE OR REPLACE FUNCTION public.refresh_tag_sub_banks(p_tag_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_question_ids TEXT[];
  v_kp_ids TEXT[];
BEGIN
  SELECT COALESCE(array_agg(question_id ORDER BY created_at DESC), '{}'::TEXT[])
  INTO v_question_ids
  FROM public.questions
  WHERE tag_id = p_tag_id AND question_id IS NOT NULL;

  INSERT INTO public.tag_mistake_sub_bank (tag_id, question_ids, updated_at)
  VALUES (p_tag_id, COALESCE(v_question_ids, '{}'::TEXT[]), NOW())
  ON CONFLICT (tag_id) DO UPDATE
  SET question_ids = EXCLUDED.question_ids,
      updated_at = NOW();

  SELECT COALESCE(array_agg(kp_id ORDER BY created_at DESC), '{}'::TEXT[])
  INTO v_kp_ids
  FROM public.knowledge_points
  WHERE tag_id = p_tag_id AND kp_id IS NOT NULL;

  INSERT INTO public.tag_knowledge_sub_bank (tag_id, knowledge_point_ids, updated_at)
  VALUES (p_tag_id, COALESCE(v_kp_ids, '{}'::TEXT[]), NOW())
  ON CONFLICT (tag_id) DO UPDATE
  SET knowledge_point_ids = EXCLUDED.knowledge_point_ids,
      updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_question_sub_bank()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tag_id IS NOT NULL THEN
      PERFORM public.refresh_tag_sub_banks(OLD.tag_id);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.tag_id IS NOT NULL AND OLD.tag_id <> NEW.tag_id THEN
    PERFORM public.refresh_tag_sub_banks(OLD.tag_id);
  END IF;
  IF NEW.tag_id IS NOT NULL THEN
    PERFORM public.refresh_tag_sub_banks(NEW.tag_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_knowledge_sub_bank()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tag_id IS NOT NULL THEN
      PERFORM public.refresh_tag_sub_banks(OLD.tag_id);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.tag_id IS NOT NULL AND OLD.tag_id <> NEW.tag_id THEN
    PERFORM public.refresh_tag_sub_banks(OLD.tag_id);
  END IF;
  IF NEW.tag_id IS NOT NULL THEN
    PERFORM public.refresh_tag_sub_banks(NEW.tag_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_question_sub_bank ON public.questions;
CREATE TRIGGER trg_refresh_question_sub_bank
AFTER INSERT OR UPDATE OR DELETE ON public.questions
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_question_sub_bank();

DROP TRIGGER IF EXISTS trg_refresh_knowledge_sub_bank ON public.knowledge_points;
CREATE TRIGGER trg_refresh_knowledge_sub_bank
AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_points
FOR EACH ROW
EXECUTE FUNCTION public.trg_refresh_knowledge_sub_bank();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'knowledge_point', subject, name, 0, 'db'
FROM public.knowledge_points
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'knowledge_point', subject, knowledge_point, 0, 'db'
FROM public.questions
WHERE knowledge_point IS NOT NULL AND TRIM(knowledge_point) <> ''
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'ability', subject, ability, 0, 'db'
FROM public.questions
WHERE ability IS NOT NULL AND TRIM(ability) <> ''
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'error_type', subject, error_type, 0, 'db'
FROM public.questions
WHERE error_type IS NOT NULL AND TRIM(error_type) <> ''
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'knowledge_point', NULL, elem.value::TEXT, 0, 'db'
FROM public.user_learning_state uls
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uls.tag_extensions -> 'knowledge_point', '[]'::jsonb)) AS elem(value)
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'ability', NULL, elem.value::TEXT, 0, 'db'
FROM public.user_learning_state uls
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uls.tag_extensions -> 'ability', '[]'::jsonb)) AS elem(value)
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

INSERT INTO public.tag_dictionary_items (item_type, subject, label, sort_order, source)
SELECT DISTINCT 'error_type', NULL, elem.value::TEXT, 0, 'db'
FROM public.user_learning_state uls
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uls.tag_extensions -> 'error_type', '[]'::jsonb)) AS elem(value)
ON CONFLICT (item_type, subject, label) DO UPDATE SET updated_at = NOW();

WITH raw_tags AS (
  SELECT DISTINCT subject, name AS tag_name FROM public.knowledge_points
  UNION
  SELECT DISTINCT subject, knowledge_point AS tag_name
  FROM public.questions
  WHERE knowledge_point IS NOT NULL AND TRIM(knowledge_point) <> ''
)
SELECT public.upsert_tag_catalog(subject, tag_name, NULL, NULL, NULL)
FROM raw_tags;

UPDATE public.knowledge_points kp
SET tag_id = tc.tag_id,
    category_code = COALESCE(NULLIF(kp.category_code, ''), tc.code),
    kp_id = COALESCE(
      NULLIF(kp.kp_id, ''),
      public.generate_layered_business_id('KP', COALESCE(NULLIF(kp.category_code, ''), tc.code), 'public.knowledge_point_business_seq')
    )
FROM public.tag_catalog tc
WHERE tc.subject = kp.subject
  AND tc.tag_name = kp.name;

UPDATE public.questions q
SET tag_id = tc.tag_id,
    question_id = COALESCE(NULLIF(q.question_id, ''), public.generate_layered_business_id('Q', tc.code, 'public.question_business_seq')),
    knowledge_point_id = COALESCE(
      NULLIF(q.knowledge_point_id, ''),
      (
        SELECT kp.kp_id
        FROM public.knowledge_points kp
        WHERE kp.subject = q.subject
          AND kp.name = q.knowledge_point
        ORDER BY kp.created_at DESC
        LIMIT 1
      )
    )
FROM public.tag_catalog tc
WHERE tc.subject = q.subject
  AND tc.tag_name = q.knowledge_point;

UPDATE public.questions
SET id_path = public.build_question_id_path(tag_id, question_id)
WHERE id_path IS NULL OR id_path = '';

INSERT INTO public.tag_mistake_sub_bank (tag_id, question_ids, updated_at)
SELECT tc.tag_id,
       COALESCE(array_agg(q.question_id ORDER BY q.created_at DESC) FILTER (WHERE q.question_id IS NOT NULL), '{}'::TEXT[]),
       NOW()
FROM public.tag_catalog tc
LEFT JOIN public.questions q ON q.tag_id = tc.tag_id
GROUP BY tc.tag_id
ON CONFLICT (tag_id) DO UPDATE
SET question_ids = EXCLUDED.question_ids,
    updated_at = NOW();

INSERT INTO public.tag_knowledge_sub_bank (tag_id, knowledge_point_ids, updated_at)
SELECT tc.tag_id,
       COALESCE(array_agg(kp.kp_id ORDER BY kp.created_at DESC) FILTER (WHERE kp.kp_id IS NOT NULL), '{}'::TEXT[]),
       NOW()
FROM public.tag_catalog tc
LEFT JOIN public.knowledge_points kp ON kp.tag_id = tc.tag_id
GROUP BY tc.tag_id
ON CONFLICT (tag_id) DO UPDATE
SET knowledge_point_ids = EXCLUDED.knowledge_point_ids,
    updated_at = NOW();

CREATE OR REPLACE VIEW public.tag_navigation_paths AS
SELECT
  tc.tag_id,
  tc.subject,
  tc.tag_name,
  tc.category,
  tc.branch,
  tc.code,
  q.question_id,
  q.id AS question_row_uuid,
  q.id_path AS question_path,
  kp.kp_id,
  kp.id AS knowledge_point_row_uuid,
  ('/' || tc.tag_id || '/knowledge/' || kp.kp_id) AS knowledge_path
FROM public.tag_catalog tc
LEFT JOIN public.questions q ON q.tag_id = tc.tag_id
LEFT JOIN public.knowledge_points kp ON kp.tag_id = tc.tag_id;
