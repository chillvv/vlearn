CREATE INDEX IF NOT EXISTS idx_questions_user_subject_ability_due_stubborn
ON questions(user_id, subject, ability, next_review_date, stubborn_flag);

CREATE INDEX IF NOT EXISTS idx_questions_user_subject_due
ON questions(user_id, subject, next_review_date);
