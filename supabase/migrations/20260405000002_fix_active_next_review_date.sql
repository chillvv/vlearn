-- 修复由于部分历史数据（或 mock 数据）未触发完整复习流，导致 `mastery_state = 'active'` 时缺失 `next_review_date` 的问题
-- 这会影响到过期题（overdue）和到期题（due）的真实积压指标计算

UPDATE questions
SET
  next_review_date = COALESCE(
    -- 优先基于最近一次复习时间（或更新时间） + 1天作为下一次复习时间
    updated_at + interval '1 day',
    -- 如果从没复习过，则基于创建时间 + 1天
    created_at + interval '1 day',
    -- 最坏情况直接 fallback 到当前时间前一天（使其立刻 overdue）
    NOW() - interval '1 day'
  )
WHERE
  mastery_state = 'active'
  AND next_review_date IS NULL;
