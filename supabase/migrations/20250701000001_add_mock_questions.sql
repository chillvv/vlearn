-- Insert mock questions for testing UI
-- Uses the first available user in the system

DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get the first user ID
    SELECT id INTO v_user_id FROM auth.users LIMIT 1;

    -- If no user exists, do nothing (or raise notice)
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No users found, skipping mock data insertion';
        RETURN;
    END IF;

    -- Insert Choice Questions
    INSERT INTO questions (user_id, question, question_type, options, correct_answer, subject, error_tag, difficulty, analysis)
    VALUES 
    (v_user_id, 'What is the capital of France?', 'choice', '["London", "Berlin", "Paris", "Madrid"]'::jsonb, 'Paris', 'Geography', 'Memory', 'easy', 'Paris is the capital and most populous city of France.'),
    (v_user_id, 'Which planet is known as the Red Planet?', 'choice', '["Venus", "Mars", "Jupiter", "Saturn"]'::jsonb, 'Mars', 'Science', 'Concept', 'medium', 'Mars is often referred to as the "Red Planet" because the reddish iron oxide prevalent on its surface gives it a reddish appearance.'),
    (v_user_id, 'What is 2 + 2?', 'choice', '["3", "4", "5", "6"]'::jsonb, '4', 'Math', 'Calculation', 'easy', 'Basic arithmetic addition.');

    -- Insert Fill-in-the-blank Questions
    INSERT INTO questions (user_id, question, question_type, correct_answer, subject, error_tag, difficulty, analysis)
    VALUES 
    (v_user_id, 'The powerhouse of the cell is the ______.', 'fill', 'mitochondria', 'Biology', 'Memory', 'medium', 'Mitochondria are membrane-bound cell organelles (mitochondrion, singular) that generate most of the chemical energy needed to power the cell''s biochemical reactions.'),
    (v_user_id, 'H2O is the chemical formula for ______.', 'fill', 'water', 'Chemistry', 'Concept', 'easy', 'Water is a substance composed of the chemical elements hydrogen and oxygen.');

    -- Insert Essay Questions
    INSERT INTO questions (user_id, question, question_type, correct_answer, subject, error_tag, difficulty, analysis)
    VALUES 
    (v_user_id, 'Explain the theory of relativity.', 'essay', 'E=mc^2...', 'Physics', 'Understanding', 'hard', 'The theory of relativity usually encompasses two interrelated theories by Albert Einstein: special relativity and general relativity.'),
    (v_user_id, 'Describe the causes of World War I.', 'essay', 'Assassination of Archduke Franz Ferdinand...', 'History', 'Analysis', 'hard', 'World War I was caused by a complex interaction of various factors, including imperialism, nationalism, militarism, and the alliance system.');

END $$;
