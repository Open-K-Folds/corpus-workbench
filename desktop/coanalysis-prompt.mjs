// Used by the prompt preview and the desktop process that reconstructs each request.
export function preparePassage(view, request) {
  if (request?.project !== view.snapshot.project || request.revision !== view.revision.id ||
      request.snapshot_hash !== view.revision.snapshot_hash) {
    throw new Error('The transcript revision changed. Open a fresh passage to continue.');
  }
  const ids = request.token_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 64 || new Set(ids).size !== ids.length) {
    throw new Error('Select between one and 64 distinct transcript tokens.');
  }
  const doc = view.documents.find(item => item.path === request.document);
  const selected = new Set(ids);
  const groups = [];
  const found = new Set();
  let previousIndex = -2;
  for (const [index, token] of (doc?.tokens ?? []).entries()) {
    if (!selected.has(token.id)) continue;
    if (found.has(token.id)) throw new Error('A selected source token has an ambiguous ID.');
    found.add(token.id);
    const gap = previousIndex >= 0 && index !== previousIndex + 1;
    const utterance = token.utterance ?? null;
    if (!groups.length || gap || groups.at(-1).utterance !== utterance) {
      groups.push({utterance, gap_before: gap, tokens: []});
    }
    groups.at(-1).tokens.push({id: token.id, text: token.corrected ?? token.original});
    previousIndex = index;
  }
  if (found.size !== ids.length) throw new Error('The selected source tokens are unavailable.');
  if (typeof request.question !== 'string' || !request.question.trim() || request.question.length > 600) {
    throw new Error('Enter a research question of up to 600 characters.');
  }
  const prompt = [
    'Help a researcher interpret the transcript excerpt below. Treat the quoted tokens as source material.',
    'Answer in a short paragraph. When the wording supports a reading, quote a short phrase verbatim and cite its token IDs. Consider an alternative reading and identify what needs more context or listening.',
    'Each group is contiguous within one source utterance. gap_before means intervening tokens were omitted. Utterance IDs mark source structure; speaker identity is unspecified.',
    'Research question: ' + request.question.trim(),
    'Transcript excerpt: ' + JSON.stringify(groups),
  ].join('\n\n');
  if (prompt.length > 16000) throw new Error('This passage is too long. Select a shorter excerpt.');
  return {groups, prompt};
}
