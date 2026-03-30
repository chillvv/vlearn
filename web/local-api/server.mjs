import http from 'node:http';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const port = Number(process.env.PORT || 8080);
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const corsOrigin = String(process.env.CORS_ORIGIN || '*').trim();

if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatHexAsUuid(hex) {
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = chars.join('');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

function normalizeUserId(rawUserId) {
  const cleaned = String(rawUserId || '').trim();
  if (!cleaned) return '';
  if (isUuid(cleaned)) return cleaned;
  const hash = createHash('sha256').update(cleaned).digest('hex');
  return formatHexAsUuid(hash);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function resolveUser(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new Error('缺少 access token');
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('无效 token');
  const payloadRaw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadRaw.padEnd(payloadRaw.length + ((4 - payloadRaw.length % 4) % 4), '=');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    throw new Error('无效 token');
  }
  const userId = typeof payload?.sub === 'string' ? payload.sub : '';
  if (!userId) throw new Error('无法识别用户');
  const normalizedId = normalizeUserId(userId);
  if (!normalizedId) throw new Error('无法识别用户');
  if (payload?.exp && Number(payload.exp) * 1000 <= Date.now()) {
    throw new Error('token 已过期');
  }
  return {
    id: normalizedId,
    email: typeof payload?.email === 'string' ? payload.email : null,
  };
}

async function ensureLocalAuthUser(user) {
  await pool.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1::uuid, $2)
     ON CONFLICT (id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, auth.users.email),
       updated_at = now()`,
    [user.id, user.email ?? null],
  );
}

function boolFromQuery(value) {
  return value === '1' || value === 'true';
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function generateShareCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: '请求无效' });
    return;
  }
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { data: { ok: true } });
    return;
  }
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    const user = await resolveUser(req);
    await ensureLocalAuthUser(user);
    if (url.pathname === '/api/questions' && req.method === 'GET') {
      const values = [user.id];
      const where = ['user_id = $1'];
      const subject = url.searchParams.get('subject');
      const category = url.searchParams.get('category');
      const l2 = url.searchParams.get('l2');
      const nodesRaw = url.searchParams.get('nodes');
      const onlyDue = boolFromQuery(url.searchParams.get('onlyDue'));
      const onlyUnmastered = boolFromQuery(url.searchParams.get('onlyUnmastered'));
      const onlyStubborn = boolFromQuery(url.searchParams.get('onlyStubborn'));
      const includeArchived = boolFromQuery(url.searchParams.get('includeArchived'));
      const onlyArchived = boolFromQuery(url.searchParams.get('onlyArchived'));
      const sortBy = url.searchParams.get('sortBy');
      const limit = Number(url.searchParams.get('limit') || 0);
      const offset = Number(url.searchParams.get('offset') || 0);
      if (subject) {
        values.push(subject);
        where.push(`subject = $${values.length}`);
      }
      if (category) {
        values.push(category);
        where.push(`category = $${values.length}`);
      }
      if (l2) {
        values.push(l2);
        where.push(`ability = $${values.length}`);
      }
      if (nodesRaw) {
        const nodes = nodesRaw.split(',').map((item) => item.trim()).filter(Boolean);
        if (nodes.length > 0) {
          values.push(nodes);
          where.push(`COALESCE(node, knowledge_point) = ANY($${values.length}::text[])`);
        }
      }
      if (onlyDue) {
        where.push('(next_review_date IS NULL OR next_review_date <= NOW())');
      }
      if (onlyUnmastered) {
        where.push('COALESCE(mastery_level, ROUND(COALESCE(confidence, 0.5) * 100)) < 80');
      }
      if (onlyStubborn) {
        where.push('stubborn_flag = TRUE');
      }
      if (onlyArchived) {
        where.push('is_archived = TRUE');
      } else if (!includeArchived) {
        where.push('COALESCE(is_archived, FALSE) = FALSE');
      }
      let orderBy = 'created_at DESC';
      if (sortBy === 'lowestMastery') orderBy = 'mastery_level ASC NULLS FIRST';
      if (sortBy === 'nearestDue') orderBy = 'next_review_date ASC NULLS FIRST';
      const hasLimit = Number.isFinite(limit) && limit > 0;
      const hasOffset = Number.isFinite(offset) && offset > 0;
      let limitSql = '';
      if (hasLimit) {
        values.push(limit);
        limitSql += ` LIMIT $${values.length}`;
      }
      if (hasOffset) {
        values.push(offset);
        limitSql += ` OFFSET $${values.length}`;
      }
      const sql = `SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY ${orderBy}${limitSql}`;
      const result = await pool.query(sql, values);
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/questions/signature' && req.method === 'GET') {
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS total FROM questions WHERE user_id = $1',
        [user.id],
      );
      const headResult = await pool.query(
        'SELECT id, created_at FROM questions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [user.id],
      );
      const total = countResult.rows[0]?.total || 0;
      const head = headResult.rows[0];
      const signature = `${total}:${head?.id || ''}:${head?.created_at || ''}`;
      sendJson(res, 200, { data: { signature } });
      return;
    }
    if (url.pathname === '/api/questions/count' && req.method === 'GET') {
      const values = [user.id];
      const where = ['user_id = $1'];
      const subject = url.searchParams.get('subject');
      const category = url.searchParams.get('category');
      const l2 = url.searchParams.get('l2');
      const nodesRaw = url.searchParams.get('nodes');
      const onlyDue = boolFromQuery(url.searchParams.get('onlyDue'));
      const onlyStubborn = boolFromQuery(url.searchParams.get('onlyStubborn'));
      const includeArchived = boolFromQuery(url.searchParams.get('includeArchived'));
      const onlyArchived = boolFromQuery(url.searchParams.get('onlyArchived'));
      if (subject) {
        values.push(subject);
        where.push(`subject = $${values.length}`);
      }
      if (category) {
        values.push(category);
        where.push(`category = $${values.length}`);
      }
      if (l2) {
        values.push(l2);
        where.push(`ability = $${values.length}`);
      }
      if (nodesRaw) {
        const nodes = nodesRaw.split(',').map((item) => item.trim()).filter(Boolean);
        if (nodes.length > 0) {
          values.push(nodes);
          where.push(`COALESCE(node, knowledge_point) = ANY($${values.length}::text[])`);
        }
      }
      if (onlyDue) {
        where.push('(next_review_date IS NULL OR next_review_date <= NOW())');
      }
      if (onlyStubborn) {
        where.push('stubborn_flag = TRUE');
      }
      if (onlyArchived) {
        where.push('is_archived = TRUE');
      } else if (!includeArchived) {
        where.push('COALESCE(is_archived, FALSE) = FALSE');
      }
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM questions WHERE ${where.join(' AND ')}`,
        values,
      );
      sendJson(res, 200, { data: { count: Number(countResult.rows[0]?.count || 0) } });
      return;
    }
    if (url.pathname === '/api/weakness' && req.method === 'GET') {
      const result = await pool.query(
        `SELECT * FROM user_weakness
         WHERE user_id = $1
         ORDER BY error_count DESC, last_updated DESC`,
        [user.id],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/weakness/increment' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const knowledgePoint = String(body.knowledge_point || '').trim();
      const ability = String(body.ability || '').trim();
      if (!knowledgePoint || !ability) throw new Error('缺少 knowledge_point 或 ability');
      await pool.query(
        `INSERT INTO user_weakness (user_id, knowledge_point, ability, error_count, last_updated)
         VALUES ($1,$2,$3,1,NOW())
         ON CONFLICT (user_id, knowledge_point, ability)
         DO UPDATE SET error_count = user_weakness.error_count + 1, last_updated = NOW()`,
        [user.id, knowledgePoint, ability],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/learning-state' && req.method === 'GET') {
      const result = await pool.query(
        `SELECT * FROM user_learning_state
         WHERE user_id = $1
         LIMIT 1`,
        [user.id],
      );
      const row = result.rows[0] || {
        user_id: user.id,
        tag_extensions: {},
        taxonomy_overrides: {},
        learning_content: {
          tipsByNode: {},
          drawerByTag: {},
        },
      };
      sendJson(res, 200, { data: row });
      return;
    }
    if (url.pathname === '/api/learning-state/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await pool.query(
        `INSERT INTO user_learning_state (
          user_id, tag_extensions, taxonomy_overrides, learning_content, updated_at
        ) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          tag_extensions = EXCLUDED.tag_extensions,
          taxonomy_overrides = EXCLUDED.taxonomy_overrides,
          learning_content = EXCLUDED.learning_content,
          updated_at = NOW()
        RETURNING *`,
        [
          user.id,
          body.tag_extensions || {},
          body.taxonomy_overrides || {},
          body.learning_content || {
            tipsByNode: {},
            drawerByTag: {},
          },
        ],
      );
      sendJson(res, 200, { data: result.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const insertResult = await pool.query(
        `INSERT INTO questions (
          user_id, subject, question_text, category, node, image_url, knowledge_point, ability, error_type,
          question_type, correct_answer, raw_ai_response, normalized_payload, payload_version,
          validation_status, render_mode, note, summary, confidence, mastery_level, next_review_date,
          stubborn_flag, mastery_state, mastered_at, is_archived, archived_at, review_count
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        ) RETURNING *`,
        [
          user.id,
          body.subject || '英语',
          body.question_text || '',
          body.category || null,
          body.node || null,
          body.image_url || null,
          body.knowledge_point || '',
          body.ability || '规则应用',
          body.error_type || body.knowledge_point || '未分类',
          body.question_type || null,
          body.correct_answer || null,
          body.raw_ai_response || body.question_text || '',
          body.normalized_payload || null,
          body.payload_version || null,
          body.validation_status || null,
          body.render_mode || null,
          body.note || null,
          body.summary || null,
          typeof body.confidence === 'number' ? body.confidence : null,
          typeof body.mastery_level === 'number' ? body.mastery_level : null,
          toIsoOrNull(body.next_review_date),
          Boolean(body.stubborn_flag),
          body.mastery_state || null,
          toIsoOrNull(body.mastered_at),
          Boolean(body.is_archived),
          toIsoOrNull(body.archived_at),
          Number.isFinite(Number(body.review_count)) ? Number(body.review_count) : 0,
        ],
      );
      sendJson(res, 200, { data: insertResult.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions/update' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const id = String(body.id || '').trim();
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
      if (!id) throw new Error('缺少 id');
      const keys = Object.keys(updates).filter((key) => key !== 'id' && key !== 'user_id');
      if (keys.length === 0) throw new Error('缺少 updates');
      const values = [];
      const sets = [];
      for (const key of keys) {
        values.push(updates[key]);
        sets.push(`"${key}" = $${values.length}`);
      }
      values.push(id);
      values.push(user.id);
      const result = await pool.query(
        `UPDATE questions SET ${sets.join(', ')}
         WHERE id = $${values.length - 1} AND user_id = $${values.length}
         RETURNING *`,
        values,
      );
      if (!result.rows[0]) throw new Error('题目不存在');
      sendJson(res, 200, { data: result.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions/batch-update' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
      if (ids.length === 0) {
        sendJson(res, 200, { data: { updated: 0 } });
        return;
      }
      const keys = Object.keys(updates).filter((key) => key !== 'id' && key !== 'user_id');
      if (keys.length === 0) throw new Error('缺少 updates');
      const values = [];
      const sets = [];
      for (const key of keys) {
        values.push(updates[key]);
        sets.push(`"${key}" = $${values.length}`);
      }
      values.push(ids);
      values.push(user.id);
      const result = await pool.query(
        `UPDATE questions
         SET ${sets.join(', ')}
         WHERE id = ANY($${values.length - 1}::uuid[]) AND user_id = $${values.length}
         RETURNING id`,
        values,
      );
      sendJson(res, 200, { data: { updated: result.rowCount } });
      return;
    }
    if (url.pathname === '/api/questions/delete' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const id = String(body.id || '').trim();
      if (!id) throw new Error('缺少 id');
      await pool.query(
        `DELETE FROM questions WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/review/attempt' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const rpc = await pool.query(
        `SELECT * FROM submit_review_attempt(
          $1::uuid,$2::text,$3::boolean,$4::text,$5::text,$6::text,$7::jsonb
        )`,
        [
          body.questionId,
          body.userAnswer || '',
          Boolean(body.isCorrect),
          body.rating || 'vague',
          body.correctAnswer || null,
          body.selectedOptionText || null,
          body.diagnosis || {},
        ],
      );
      const questionResult = await pool.query(
        'SELECT * FROM questions WHERE id = $1 AND user_id = $2 LIMIT 1',
        [body.questionId, user.id],
      );
      const rpcRow = rpc.rows[0] || {};
      const question = questionResult.rows[0];
      if (!question) {
        throw new Error('复习提交成功，但读取题目快照失败');
      }
      sendJson(res, 200, {
        data: {
          attempt_id: rpcRow.attempt_id || null,
          next_review_date: rpcRow.next_review_date || question.next_review_date,
          question,
        },
      });
      return;
    }
    if (url.pathname === '/api/review/plan-cache/rebuild' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const days = Math.max(1, Number(body.days || 14));
      await pool.query('SELECT trigger_plan_cache_rebuild($1::int)', [days]);
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/review/global-error-stats' && req.method === 'GET') {
      const days = Math.max(1, Number(url.searchParams.get('days') || 7));
      const result = await pool.query('SELECT * FROM get_global_error_stats($1::int)', [days]);
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/review/recent-attempts' && req.method === 'GET') {
      const questionId = String(url.searchParams.get('questionId') || '').trim();
      const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 6)));
      if (!questionId) throw new Error('缺少 questionId');
      const result = await pool.query(
        `SELECT id, question_id, user_answer, selected_option_text, correct_answer, is_correct, rating, ai_diagnosis, next_review_date, created_at
         FROM question_review_attempts
         WHERE user_id = $1 AND question_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [user.id, questionId, limit],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/knowledge/node-mastery' && req.method === 'GET') {
      const subject = String(url.searchParams.get('subject') || '').trim();
      if (!subject) throw new Error('缺少 subject');
      const result = await pool.query(
        'SELECT * FROM get_knowledge_node_mastery($1::uuid, $2::text)',
        [user.id, subject],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/stats/dashboard' && req.method === 'GET') {
      const result = await pool.query('SELECT * FROM get_dashboard_stats($1::uuid)', [user.id]);
      sendJson(res, 200, { data: result.rows[0] || null });
      return;
    }
    if (url.pathname === '/api/practice/overview' && req.method === 'GET') {
      const sessionLimit = Math.max(1, Math.min(20, Number(url.searchParams.get('sessionLimit') || 5)));
      const attemptLimit = Math.max(1, Math.min(30, Number(url.searchParams.get('attemptLimit') || 10)));
      const [sessionsResult, attemptsResult] = await Promise.all([
        pool.query(
          `SELECT id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at, completed_at
           FROM practice_sessions
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [user.id, sessionLimit],
        ),
        pool.query(
          `SELECT id, session_id, question_index, question_text, question_type, correct_answer, user_answer, is_correct, knowledge_point, duration_seconds, created_at
           FROM practice_attempts
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [user.id, attemptLimit],
        ),
      ]);
      const sessions = sessionsResult.rows;
      const attempts = attemptsResult.rows;
      sendJson(res, 200, {
        data: {
          sessions,
          attempts,
          totals: {
            sessionCount: sessions.length,
            activeCount: sessions.filter((item) => item.status === 'active').length,
            completedCount: sessions.filter((item) => item.status === 'completed').length,
            correctCount: attempts.filter((item) => item.is_correct === true).length,
            wrongCount: attempts.filter((item) => item.is_correct === false).length,
          },
        },
      });
      return;
    }
    if (url.pathname === '/api/practice/sessions' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await pool.query(
        `INSERT INTO practice_sessions (
          user_id, subject, strategy, nodes, planned_amount, generated_amount, status
        ) VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [
          user.id,
          body.subject,
          body.strategy,
          body.nodes || [],
          Number(body.planned_amount || 0),
          Number(body.generated_amount || 0),
        ],
      );
      sendJson(res, 200, { data: { id: result.rows[0]?.id || null } });
      return;
    }
    if (url.pathname === '/api/practice/attempts/record' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      await pool.query(
        `INSERT INTO practice_attempts (
          user_id, session_id, question_index, question_text, question_type, correct_answer, user_answer,
          is_correct, knowledge_point, duration_seconds, source_node, ai_prompt_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          user.id,
          body.session_id,
          Number(body.question_index || 0),
          body.question_text || '',
          body.question_type || 'essay',
          body.correct_answer || '',
          body.user_answer || '',
          Boolean(body.is_correct),
          body.knowledge_point || null,
          Number(body.duration_seconds || 0),
          body.source_node || null,
          body.ai_prompt_version || null,
        ],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/practice/attempts/submit' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const rpc = await pool.query(
        `SELECT * FROM submit_practice_attempt(
          $1::uuid,$2::int,$3::text,$4::text,$5::text,$6::text,$7::text[],$8::text,$9::text,
          $10::text,$11::text,$12::int,$13::text,$14::text,$15::boolean
        )`,
        [
          body.session_id,
          Number(body.question_index || 0),
          body.question_text || '',
          body.question_type || 'essay',
          body.correct_answer || '',
          body.user_answer || '',
          body.acceptable_answers || [],
          body.subject || '英语',
          body.knowledge_point || '',
          body.ability || '规则应用',
          body.error_type || body.knowledge_point || '未分类',
          Number(body.duration_seconds || 0),
          body.source_node || null,
          body.ai_prompt_version || null,
          Boolean(body.is_final),
        ],
      );
      sendJson(res, 200, { data: rpc.rows[0] || { is_correct: false } });
      return;
    }
    if (url.pathname.startsWith('/api/practice/sessions/') && url.pathname.endsWith('/abandon') && req.method === 'POST') {
      const parts = url.pathname.split('/');
      const sessionId = parts[4];
      await pool.query(
        `UPDATE practice_sessions SET status = 'abandoned', completed_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [sessionId, user.id],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/sync/import' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      const list = Array.isArray(body.questions) ? body.questions : [];
      if (mode === 'replace') {
        await pool.query('DELETE FROM questions WHERE user_id = $1', [user.id]);
      }
      let imported = 0;
      for (const item of list) {
        try {
          await pool.query(
            `INSERT INTO questions (
              user_id, subject, question_text, category, node, image_url, knowledge_point, ability, error_type,
              question_type, correct_answer, note, summary, confidence, mastery_level, next_review_date, stubborn_flag, review_count,
              mastery_state, mastered_at, is_archived, archived_at, raw_ai_response, normalized_payload, payload_version, validation_status, render_mode
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
            )`,
            [
              user.id,
              item.subject || '英语',
              item.question_text || '',
              item.category || null,
              item.node || null,
              item.image_url || null,
              item.knowledge_point || '',
              item.ability || '规则应用',
              item.error_type || item.knowledge_point || '未分类',
              item.question_type || null,
              item.correct_answer || null,
              item.note || null,
              item.summary || null,
              typeof item.confidence === 'number' ? item.confidence : null,
              typeof item.mastery_level === 'number' ? item.mastery_level : null,
              toIsoOrNull(item.next_review_date),
              Boolean(item.stubborn_flag),
              item.mastery_state || null,
              toIsoOrNull(item.mastered_at),
              Boolean(item.is_archived),
              toIsoOrNull(item.archived_at),
              Number.isFinite(Number(item.review_count)) ? Number(item.review_count) : 0,
              item.raw_ai_response || item.question_text || '',
              item.normalized_payload || null,
              item.payload_version || null,
              item.validation_status || null,
              item.render_mode || null,
            ],
          );
          imported += 1;
        } catch {
        }
      }
      sendJson(res, 200, { data: { imported } });
      return;
    }
    if (url.pathname === '/api/sync/share-code' && req.method === 'POST') {
      const all = await pool.query('SELECT * FROM questions WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
      const payloadQuestions = all.rows.map((item) => {
        const next = { ...item };
        delete next.id;
        delete next.user_id;
        delete next.created_at;
        delete next.updated_at;
        return next;
      });
      const rpc = await pool.query('SELECT create_share_code(NULL::uuid[]) AS code');
      const rpcCode = String(rpc.rows[0]?.code || '').trim();
      if (rpcCode) {
        sendJson(res, 200, { data: { shareCode: rpcCode, count: payloadQuestions.length } });
        return;
      }
      const code = generateShareCode();
      await pool.query(
        `INSERT INTO shared_questions (code, user_id, questions, expires_at)
         VALUES ($1,$2,$3,NOW() + interval '7 days')`,
        [code, user.id, payloadQuestions],
      );
      sendJson(res, 200, { data: { shareCode: code, count: payloadQuestions.length } });
      return;
    }
    if (url.pathname === '/api/sync/import-by-code' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
      if (!code) throw new Error('缺少 code');
      const rpc = await pool.query('SELECT * FROM get_shared_questions($1::text)', [code]).catch(() => ({ rows: [] }));
      if (rpc.rows && rpc.rows.length > 0) {
        sendJson(res, 200, { data: { questions: rpc.rows } });
        return;
      }
      const result = await pool.query(
        `SELECT questions, expires_at FROM shared_questions
         WHERE code = $1
         LIMIT 1`,
        [code],
      );
      const row = result.rows[0];
      if (!row) throw new Error('分享码不存在或已过期');
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
        throw new Error('分享码已过期');
      }
      sendJson(res, 200, { data: { questions: Array.isArray(row.questions) ? row.questions : [] } });
      return;
    }
    sendJson(res, 404, { error: '接口不存在' });
  } catch (error) {
    sendJson(res, 500, { error: String(error?.message || error || '服务异常') });
  }
});

server.listen(port, () => {
  process.stdout.write(`local-api running at http://localhost:${port}\n`);
});
