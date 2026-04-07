import { questionsApi, tagIdApi } from './api'
import { normalizeMistakeDraft } from './copilot'
import { analyzeDuplicateAgainstCandidates, normalizeTextForDuplicateCheck } from './duplicateCheck'
import { readLearningContentState } from './knowledgeContent'
import { isKnowledgePointInSubjectTaxonomy } from './knowledgeTaxonomy'
import type { Question, Subject } from './types'

export type DraftLike = Partial<Question> & {
  options?: string[]
}

export type DraftIngestionBucketStatus = 'ready' | 'pending_tag' | 'unassigned'

export type DraftIngestionBucket = {
  bucketKey: string
  label: string
  status: DraftIngestionBucketStatus
  reason: string
  subject: Subject
  knowledgePoint: string
  absoluteIndexes: number[]
}

export type DraftIngestionBucketContext = {
  tagId: string
  category: string
  branch: string
  existingQuestionCount: number
  existingQuestionSamples: string[]
  existingKnowledgeMarkdown: string
  pathCount: number
}

export type DuplicateGuardResult = {
  finalInsertList: Array<Partial<Question>>
  duplicateCount: number
  aiDuplicateCount: number
  duplicateReasons: string[]
}

function normalizeSubject(subject: unknown): Subject {
  return subject === 'C语言' ? 'C语言' : '英语'
}

function buildBucketDescriptor(subject: Subject, knowledgePoint: string) {
  const trimmed = String(knowledgePoint || '').trim()
  if (!trimmed) {
    return {
      bucketKey: `unassigned:${subject}`,
      label: '待确认知识点',
      status: 'unassigned' as const,
      reason: '该分桶中的题目尚未命中稳定标签，需要先人工确认知识点',
    }
  }
  if (isKnowledgePointInSubjectTaxonomy(subject, trimmed)) {
    return {
      bucketKey: `ready:${subject}:${trimmed}`,
      label: trimmed,
      status: 'ready' as const,
      reason: '已命中现有标签，可继续读取上下文并确认入库',
    }
  }
  return {
    bucketKey: `pending_tag:${subject}:${trimmed}`,
    label: `待创建标签：${trimmed}`,
    status: 'pending_tag' as const,
    reason: '该分桶命中新标签候选，必须先显式创建或改为现有标签',
  }
}

export function buildDraftIngestionBuckets(
  drafts: DraftLike[],
  resolveDraft: (draft: DraftLike, absoluteIndex: number) => DraftLike,
) {
  const grouped = new Map<string, DraftIngestionBucket>()
  drafts.forEach((draft, absoluteIndex) => {
    const resolved = resolveDraft(draft, absoluteIndex)
    const subject = normalizeSubject(resolved.subject)
    const knowledgePoint = String(resolved.knowledge_point || '').trim()
    const descriptor = buildBucketDescriptor(subject, knowledgePoint)
    if (!grouped.has(descriptor.bucketKey)) {
      grouped.set(descriptor.bucketKey, {
        ...descriptor,
        subject,
        knowledgePoint,
        absoluteIndexes: [],
      })
    }
    grouped.get(descriptor.bucketKey)!.absoluteIndexes.push(absoluteIndex)
  })
  return Array.from(grouped.values())
}

export async function loadDraftIngestionBucketContext(bucket: DraftIngestionBucket): Promise<DraftIngestionBucketContext> {
  const learningState = readLearningContentState()
  const existingKnowledgeMarkdown = String(learningState.drawerByTag[bucket.knowledgePoint]?.markdown || '').trim()
  if (bucket.status !== 'ready' || !bucket.knowledgePoint) {
    return {
      tagId: '',
      category: '',
      branch: '',
      existingQuestionCount: 0,
      existingQuestionSamples: [],
      existingKnowledgeMarkdown,
      pathCount: 0,
    }
  }
  const [dictionaryPayload, existingQuestions] = await Promise.all([
    tagIdApi.getDictionary(),
    questionsApi.getAll({ subject: bucket.subject, nodes: [bucket.knowledgePoint] }),
  ])
  const tags = Array.isArray((dictionaryPayload as any)?.tags) ? (dictionaryPayload as any).tags : []
  const matchedTag = tags.find((item: any) => (
    String(item?.subject || '').trim() === bucket.subject
    && String(item?.tag_name || '').trim() === bucket.knowledgePoint
  ))
  const tagId = String(matchedTag?.tag_id || '').trim()
  const paths = tagId ? await tagIdApi.getPaths({ tagId }) : []
  return {
    tagId,
    category: String(matchedTag?.category || '').trim(),
    branch: String(matchedTag?.branch || '').trim(),
    existingQuestionCount: existingQuestions.length,
    existingQuestionSamples: existingQuestions
      .slice(0, 3)
      .map((item) => String(item.question_text || '').trim())
      .filter(Boolean),
    existingKnowledgeMarkdown,
    pathCount: Array.isArray(paths) ? paths.length : 0,
  }
}

function toAlgorithmReason(reason: string) {
  if (reason === 'exact_match') return '题干完全一致'
  if (reason === 'containment') return '题干互相包含'
  if (reason === 'small_char_diff') return '文本差异极小'
  if (reason === 'high_similarity') return '文本相似度达到高阈值'
  return '算法判定为相似题'
}

export async function runUnifiedDuplicateGuard(itemsToCreate: DraftLike[]): Promise<DuplicateGuardResult> {
  const allQuestions = await questionsApi.getAll()
  const existingCandidates = allQuestions
    .map((question) => ({
      originalText: String(question.question_text || ''),
      normalizedText: normalizeTextForDuplicateCheck(question.question_text || ''),
    }))
    .filter((item) => item.normalizedText.length > 5)
  const existingNormalizedTexts = existingCandidates.map((item) => item.normalizedText)
  const preparedItems = itemsToCreate.map((draft) => {
    const normalized = normalizeMistakeDraft(draft)
    const normalizedText = normalizeTextForDuplicateCheck(normalized.question_text || '')
    return { normalized, normalizedText }
  })

  const duplicates: Array<{ source: 'algorithm' | 'ai'; reason: string }> = []
  const uncertainPairs: Array<{ existingQuestionText: string; incomingQuestionText: string; draftIndex: number }> = []
  const finalInsertList: Array<Partial<Question>> = []

  preparedItems.forEach((item, draftIndex) => {
    if (item.normalizedText.length <= 5 || existingNormalizedTexts.length === 0) {
      finalInsertList.push(item.normalized)
      return
    }
    const analysis = analyzeDuplicateAgainstCandidates(item.normalizedText, existingNormalizedTexts)
    if (analysis.decision === 'definite_duplicate') {
      duplicates.push({
        source: 'algorithm',
        reason: toAlgorithmReason(analysis.reason),
      })
      return
    }
    if (analysis.decision === 'definite_unique' || analysis.candidateIndex < 0) {
      finalInsertList.push(item.normalized)
      return
    }
    const candidate = existingCandidates[analysis.candidateIndex]
    if (!candidate?.originalText.trim()) {
      finalInsertList.push(item.normalized)
      return
    }
    uncertainPairs.push({
      existingQuestionText: candidate.originalText,
      incomingQuestionText: String(item.normalized.question_text || ''),
      draftIndex,
    })
  })

  if (uncertainPairs.length > 0) {
    const semanticResult = await questionsApi.checkSemanticDuplicate(
      uncertainPairs.map((pair) => ({
        existingQuestionText: pair.existingQuestionText,
        incomingQuestionText: pair.incomingQuestionText,
      })),
    )
    semanticResult.forEach((item, index) => {
      const pair = uncertainPairs[index]
      if (!pair) return
      if (item.is_duplicate) {
        duplicates.push({
          source: 'ai',
          reason: item.reason || 'AI 判定两题语义等价',
        })
        return
      }
      finalInsertList.push(preparedItems[pair.draftIndex].normalized)
    })
  }

  return {
    finalInsertList,
    duplicateCount: duplicates.length,
    aiDuplicateCount: duplicates.filter((item) => item.source === 'ai').length,
    duplicateReasons: Array.from(new Set(duplicates.map((item) => item.reason.trim()).filter(Boolean))),
  }
}
