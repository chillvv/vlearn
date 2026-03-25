create extension if not exists pgcrypto;

drop policy if exists "Anyone can view valid shared questions" on public.shared_questions;

create policy "Users can view their own shares"
on public.shared_questions
for select
using (auth.uid() = user_id);

create or replace function public.create_share_code(p_question_ids uuid[] default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_questions jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
    into v_questions
  from public.questions q
  where q.user_id = auth.uid()
    and (p_question_ids is null or q.id = any(p_question_ids));

  for i in 1..5 loop
    v_code := upper(encode(gen_random_bytes(4), 'hex'));
    begin
      insert into public.shared_questions(code, user_id, questions, expires_at)
      values (v_code, auth.uid(), v_questions, now() + interval '7 days');
      return v_code;
    exception when unique_violation then
    end;
  end loop;

  raise exception 'FAILED_TO_GENERATE_CODE';
end;
$$;

create or replace function public.get_shared_questions(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select sq.questions
    into v
  from public.shared_questions sq
  where sq.code = upper(p_code)
    and now() < sq.expires_at;

  if v is null then
    raise exception 'NOT_FOUND_OR_EXPIRED';
  end if;

  return v;
end;
$$;

grant execute on function public.get_shared_questions(text) to anon;
grant execute on function public.get_shared_questions(text) to authenticated;
grant execute on function public.create_share_code(uuid[]) to authenticated;

