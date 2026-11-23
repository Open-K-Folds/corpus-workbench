import type {preparePassage} from '../../desktop/coanalysis-prompt.mjs';

export interface Memo {
  format: 'corpus-workbench/coanalysis-1';
  revision: number;
  snapshot_hash: string;
  document: string;
  project: string;
  prompt: string;
  question: string;
  first_reading?: string;
  model: string;
  method: 'llama.cpp' | 'manual';
  proposal: string;
  decision: string;
  interpretation: string;
}

type PassageGroups = ReturnType<typeof preparePassage>['groups'];

// Existing exported annotations carry their original source words in the saved prompt.
export function savedExcerpt(memo: Pick<Memo, 'prompt'>): PassageGroups | null {
  const marker = '\n\nTranscript excerpt: ';
  const start = typeof memo.prompt === 'string' ? memo.prompt.lastIndexOf(marker) : -1;
  if (start < 0) return null;
  try {
    const groups = JSON.parse(memo.prompt.slice(start + marker.length)) as PassageGroups;
    if (!Array.isArray(groups) || !groups.length || !groups.every(group =>
      group && (group.utterance === null || typeof group.utterance === 'string') &&
      typeof group.gap_before === 'boolean' && Array.isArray(group.tokens) && group.tokens.length &&
      group.tokens.every(token => token && typeof token.id === 'string' && typeof token.text === 'string'))) return null;
    return groups;
  } catch { return null; }
}
