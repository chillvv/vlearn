export const DEFINITE_DUPLICATE_THRESHOLD = 90;
export const DEFINITE_UNIQUE_THRESHOLD = 40;

export type DuplicateDecision = 'definite_duplicate' | 'definite_unique' | 'uncertain';

export type PairDuplicateAnalysis = {
  decision: DuplicateDecision;
  similarity: number;
  reason: 'exact_match' | 'containment' | 'small_char_diff' | 'high_similarity' | 'low_similarity' | 'uncertain_range';
};

export type BestDuplicateAnalysis = {
  decision: DuplicateDecision;
  similarity: number;
  candidateIndex: number;
  reason: PairDuplicateAnalysis['reason'] | 'no_candidate';
};

export function normalizeTextForDuplicateCheck(text: string) {
  return String(text || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
}

function buildNGrams(text: string, gramSize = 2) {
  if (!text) return new Set<string>();
  if (text.length <= gramSize) return new Set([text]);
  const grams = new Set<string>();
  for (let i = 0; i <= text.length - gramSize; i += 1) {
    grams.add(text.slice(i, i + gramSize));
  }
  return grams;
}

function calculateCharacterDiffCount(a: string, b: string) {
  const len = Math.min(a.length, b.length);
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff;
}

export function calculateStringSimilarity(a: string, b: string) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right) return 0;
  if (left === right) return 100;
  const gramsA = buildNGrams(left, 2);
  const gramsB = buildNGrams(right, 2);
  const union = new Set([...gramsA, ...gramsB]);
  if (union.size === 0) return 0;
  let intersectionSize = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersectionSize += 1;
  }
  return Math.round((intersectionSize / union.size) * 100);
}

export function analyzeDuplicatePair(sourceText: string, candidateText: string): PairDuplicateAnalysis {
  const source = String(sourceText || '');
  const candidate = String(candidateText || '');
  if (!source || !candidate) {
    return {
      decision: 'definite_unique',
      similarity: 0,
      reason: 'low_similarity',
    };
  }
  if (source === candidate) {
    return {
      decision: 'definite_duplicate',
      similarity: 100,
      reason: 'exact_match',
    };
  }
  if (source.length > 5 && candidate.length > 5 && (source.includes(candidate) || candidate.includes(source))) {
    return {
      decision: 'definite_duplicate',
      similarity: 100,
      reason: 'containment',
    };
  }
  if (Math.abs(source.length - candidate.length) <= 5 && calculateCharacterDiffCount(source, candidate) <= 3) {
    return {
      decision: 'definite_duplicate',
      similarity: 95,
      reason: 'small_char_diff',
    };
  }
  const similarity = calculateStringSimilarity(source, candidate);
  if (similarity >= DEFINITE_DUPLICATE_THRESHOLD) {
    return {
      decision: 'definite_duplicate',
      similarity,
      reason: 'high_similarity',
    };
  }
  if (similarity <= DEFINITE_UNIQUE_THRESHOLD) {
    return {
      decision: 'definite_unique',
      similarity,
      reason: 'low_similarity',
    };
  }
  return {
    decision: 'uncertain',
    similarity,
    reason: 'uncertain_range',
  };
}

export function analyzeDuplicateAgainstCandidates(sourceText: string, candidateTexts: string[]): BestDuplicateAnalysis {
  const source = String(sourceText || '');
  if (!source || candidateTexts.length === 0) {
    return {
      decision: 'definite_unique',
      similarity: 0,
      candidateIndex: -1,
      reason: 'no_candidate',
    };
  }

  let bestSimilarity = -1;
  let bestIndex = -1;
  let bestReason: PairDuplicateAnalysis['reason'] = 'low_similarity';

  for (let index = 0; index < candidateTexts.length; index += 1) {
    const analysis = analyzeDuplicatePair(source, String(candidateTexts[index] || ''));
    if (analysis.similarity > bestSimilarity) {
      bestSimilarity = analysis.similarity;
      bestIndex = index;
      bestReason = analysis.reason;
    }
    if (analysis.decision === 'definite_duplicate') {
      return {
        decision: 'definite_duplicate',
        similarity: analysis.similarity,
        candidateIndex: index,
        reason: analysis.reason,
      };
    }
  }

  if (bestIndex < 0 || bestSimilarity <= DEFINITE_UNIQUE_THRESHOLD) {
    return {
      decision: 'definite_unique',
      similarity: Math.max(bestSimilarity, 0),
      candidateIndex: bestIndex,
      reason: bestIndex < 0 ? 'no_candidate' : 'low_similarity',
    };
  }

  return {
    decision: 'uncertain',
    similarity: bestSimilarity,
    candidateIndex: bestIndex,
    reason: bestReason === 'uncertain_range' ? 'uncertain_range' : 'uncertain_range',
  };
}
