import type {View} from '../ui/src/contracts';
export interface PassageRequest {
  project: string;
  revision: number;
  snapshot_hash: string;
  document: string;
  token_ids: string[];
  comparison?: {document: string; token_ids: string[]};
  question: string;
}
export function preparePassage(view: View, request: PassageRequest): {
  groups: {utterance: string | null; gap_before: boolean; tokens: {id: string; text: string}[]}[];
  prompt: string;
};
