import type { CopilotActionType } from './types';

export const CORE_INGEST_ACTIONS = ['create_mistake', 'update_tags'] as const;
export type CoreIngestAction = (typeof CORE_INGEST_ACTIONS)[number];

export function isCoreIngestAction(input: unknown): input is CoreIngestAction {
  return typeof input === 'string' && (CORE_INGEST_ACTIONS as readonly string[]).includes(input);
}

export function isCoreIngestActionType(input: CopilotActionType): input is CoreIngestAction {
  return isCoreIngestAction(input);
}
