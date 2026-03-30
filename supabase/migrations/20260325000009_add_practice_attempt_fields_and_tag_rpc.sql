ALTER TABLE practice_attempts
  ADD COLUMN IF NOT EXISTS source_node TEXT,
  ADD COLUMN IF NOT EXISTS ai_prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

CREATE OR REPLACE FUNCTION submit_question_tags(
  p_subject TEXT DEFAULT NULL,
  p_knowledge_point TEXT DEFAULT NULL,
  p_ability TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  subject TEXT,
  knowledge_point TEXT,
  ability TEXT,
  error_type TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_subject TEXT := btrim(COALESCE(p_subject, ''));
  v_knowledge_point TEXT := btrim(COALESCE(p_knowledge_point, ''));
  v_ability TEXT := btrim(COALESCE(p_ability, ''));
  v_error_type TEXT := btrim(COALESCE(p_error_type, ''));
BEGIN
  IF v_subject ~* '^(英文|english)$' THEN
    v_subject := '英语';
  ELSIF v_subject ~* '^(c|c语言程序设计|程序设计|编程|计算机)$' THEN
    v_subject := 'C语言';
  END IF;

  IF v_subject NOT IN ('英语', 'C语言') THEN
    IF v_knowledge_point ~ '(时态|主谓|从句|语态|介词|冠词|代词|阅读|写作|翻译|词)' THEN
      v_subject := '英语';
    ELSE
      v_subject := 'C语言';
    END IF;
  END IF;

  IF v_subject = '英语' THEN
    IF v_knowledge_point = '阅读主旨' THEN v_knowledge_point := '主旨理解'; END IF;
    IF v_knowledge_point = '阅读细节' THEN v_knowledge_point := '细节理解'; END IF;
    IF v_knowledge_point = '阅读推理' THEN v_knowledge_point := '推理判断'; END IF;
    IF v_knowledge_point = '写作表达' THEN v_knowledge_point := '表达准确'; END IF;
    IF v_knowledge_point = '' THEN
      IF v_error_type = '阅读主旨' THEN v_knowledge_point := '主旨理解';
      ELSIF v_error_type = '阅读细节' THEN v_knowledge_point := '细节理解';
      ELSIF v_error_type = '阅读推理' THEN v_knowledge_point := '推理判断';
      ELSIF v_error_type = '写作表达' THEN v_knowledge_point := '表达准确';
      ELSE v_knowledge_point := '主旨理解';
      END IF;
    ELSIF v_knowledge_point NOT IN (
      '词汇','时态','语态','主谓一致','介词','冠词','代词','固定搭配','从句','非谓语',
      '主旨理解','细节理解','推理判断','表达准确'
    ) THEN
      v_knowledge_point := '主旨理解';
    END IF;
  ELSE
    IF v_knowledge_point = '数据类型' THEN v_knowledge_point := '变量与数据类型'; END IF;
    IF v_knowledge_point = '运算表达式' THEN v_knowledge_point := '运算符与表达式'; END IF;
    IF v_knowledge_point = '分支循环' THEN v_knowledge_point := '选择结构'; END IF;
    IF v_knowledge_point = '函数调用' THEN v_knowledge_point := '函数'; END IF;
    IF v_knowledge_point = '排序查找' THEN v_knowledge_point := '排序与查找'; END IF;
    IF v_knowledge_point = '' THEN
      IF v_error_type = '数据类型' THEN v_knowledge_point := '变量与数据类型';
      ELSIF v_error_type = '运算表达式' THEN v_knowledge_point := '运算符与表达式';
      ELSIF v_error_type = '分支循环' THEN v_knowledge_point := '选择结构';
      ELSIF v_error_type = '函数调用' THEN v_knowledge_point := '函数';
      ELSIF v_error_type = '排序查找' THEN v_knowledge_point := '排序与查找';
      ELSE v_knowledge_point := '变量与数据类型';
      END IF;
    ELSIF v_knowledge_point NOT IN (
      '变量与数据类型','运算符与表达式','选择结构','循环结构','数组','字符串',
      '函数','指针','结构体','文件操作','排序与查找'
    ) THEN
      v_knowledge_point := '变量与数据类型';
    END IF;
  END IF;

  IF v_ability NOT IN ('知识点定位','规则应用','步骤执行','表达输出') THEN
    IF v_ability = '' THEN
      v_ability := '规则应用';
    ELSIF v_ability ~ '(定位|识别|找出)' THEN
      v_ability := '知识点定位';
    ELSIF v_ability ~ '(规则|迁移|套用)' THEN
      v_ability := '规则应用';
    ELSIF v_ability ~ '(步骤|推导|执行|计算)' THEN
      v_ability := '步骤执行';
    ELSIF v_ability ~ '(表达|输出|组织|书写)' THEN
      v_ability := '表达输出';
    ELSE
      v_ability := '规则应用';
    END IF;
  END IF;

  IF v_subject = '英语' THEN
    IF v_error_type IN ('阅读主旨','阅读细节','阅读推理','写作表达') THEN
      NULL;
    ELSIF v_error_type = '主旨理解' THEN
      v_error_type := '阅读主旨';
    ELSIF v_error_type = '细节理解' THEN
      v_error_type := '阅读细节';
    ELSIF v_error_type = '推理判断' THEN
      v_error_type := '阅读推理';
    ELSIF v_error_type = '表达准确' THEN
      v_error_type := '写作表达';
    ELSIF v_knowledge_point = '主旨理解' THEN
      v_error_type := '阅读主旨';
    ELSIF v_knowledge_point = '细节理解' THEN
      v_error_type := '阅读细节';
    ELSIF v_knowledge_point = '推理判断' THEN
      v_error_type := '阅读推理';
    ELSIF v_knowledge_point = '表达准确' THEN
      v_error_type := '写作表达';
    ELSE
      v_error_type := '时态';
    END IF;
  ELSE
    IF v_error_type IN ('数据类型','运算表达式','分支循环','函数调用','排序查找') THEN
      NULL;
    ELSIF v_error_type = '变量与数据类型' THEN
      v_error_type := '数据类型';
    ELSIF v_error_type = '运算符与表达式' THEN
      v_error_type := '运算表达式';
    ELSIF v_error_type IN ('选择结构','循环结构') THEN
      v_error_type := '分支循环';
    ELSIF v_error_type = '函数' THEN
      v_error_type := '函数调用';
    ELSIF v_error_type = '排序与查找' THEN
      v_error_type := '排序查找';
    ELSIF v_knowledge_point = '变量与数据类型' THEN
      v_error_type := '数据类型';
    ELSIF v_knowledge_point = '运算符与表达式' THEN
      v_error_type := '运算表达式';
    ELSIF v_knowledge_point IN ('选择结构','循环结构') THEN
      v_error_type := '分支循环';
    ELSIF v_knowledge_point = '函数' THEN
      v_error_type := '函数调用';
    ELSIF v_knowledge_point = '排序与查找' THEN
      v_error_type := '排序查找';
    ELSE
      v_error_type := '数据类型';
    END IF;
  END IF;

  RETURN QUERY
  SELECT v_subject, v_knowledge_point, v_ability, v_error_type;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_question_tags(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
