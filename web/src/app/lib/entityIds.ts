type EntitySource = Record<string, unknown> | null | undefined;

function readFirstNonEmpty(source: EntitySource, keys: string[]) {
  if (!source) return '';
  for (const key of keys) {
    const value = String(source[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function hashSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
}

function buildLegacyBusinessId(prefix: string, fields: Array<unknown>) {
  const seed = fields.map((item) => String(item || '').trim()).filter(Boolean).join('|');
  if (!seed) {
    return `${prefix}_LEGACY_UNKNOWN`;
  }
  return `${prefix}_LEGACY_${hashSeed(seed)}`;
}

export function resolveCanonicalTagId(source: EntitySource) {
  return readFirstNonEmpty(source, ['tag_id', 'tagId']) || buildLegacyBusinessId('TAG', [
    source?.subject,
    source?.category,
    source?.branch,
    source?.tag_name,
    source?.knowledge_point,
    source?.node,
    source?.name,
  ]);
}

export function resolveCanonicalNodeId(source: EntitySource) {
  return readFirstNonEmpty(source, ['node_id', 'nodeId', 'knowledge_point_id', 'knowledgePointId', 'kp_id', 'kpId']) || buildLegacyBusinessId('NODE', [
    source?.subject,
    source?.category,
    source?.branch,
    source?.node,
    source?.knowledge_point,
    source?.name,
  ]);
}

export function resolveCanonicalMistakeId(source: EntitySource) {
  return readFirstNonEmpty(source, ['mistake_id', 'mistakeId', 'question_id', 'questionId', 'id']) || buildLegacyBusinessId('MISTAKE', [
    source?.subject,
    source?.knowledge_point,
    source?.question_text,
    source?.created_at,
  ]);
}

export function buildCanonicalQuestionPath(tagId: string, mistakeId: string) {
  const normalizedTagId = String(tagId || '').trim() || 'TAG_UNKNOWN';
  const normalizedMistakeId = String(mistakeId || '').trim() || 'MISTAKE_UNKNOWN';
  return `/${normalizedTagId}/mistakes/${normalizedMistakeId}`;
}

export function attachCanonicalQuestionIds<T extends Record<string, any>>(row: T) {
  const tagId = resolveCanonicalTagId(row);
  const mistakeId = resolveCanonicalMistakeId(row);
  const nodeId = resolveCanonicalNodeId(row);
  return {
    ...row,
    question_id: readFirstNonEmpty(row, ['question_id', 'questionId']) || mistakeId,
    mistake_id: mistakeId,
    tag_id: tagId,
    knowledge_point_id: readFirstNonEmpty(row, ['knowledge_point_id', 'knowledgePointId']) || nodeId,
    node_id: nodeId,
    id_path: readFirstNonEmpty(row, ['id_path', 'idPath']) || buildCanonicalQuestionPath(tagId, mistakeId),
  };
}

export function attachCanonicalKnowledgePointIds<T extends Record<string, any>>(row: T) {
  const tagId = resolveCanonicalTagId(row);
  const nodeId = resolveCanonicalNodeId(row);
  return {
    ...row,
    kp_id: readFirstNonEmpty(row, ['kp_id', 'kpId']) || nodeId,
    node_id: nodeId,
    tag_id: tagId,
  };
}

export function attachCanonicalKnowledgeNodeIds<T extends Record<string, any>>(row: T) {
  const tagId = resolveCanonicalTagId(row);
  const nodeId = resolveCanonicalNodeId(row);
  return {
    ...row,
    tag_id: tagId,
    node_id: nodeId,
  };
}

export function matchesQuestionIdentifier(question: EntitySource, identifier: string) {
  const normalized = String(identifier || '').trim();
  if (!normalized || !question) return false;
  return [
    String(question.id || '').trim(),
    resolveCanonicalMistakeId(question),
    readFirstNonEmpty(question, ['question_id', 'questionId']),
    readFirstNonEmpty(question, ['mistake_id', 'mistakeId']),
  ].filter(Boolean).includes(normalized);
}
