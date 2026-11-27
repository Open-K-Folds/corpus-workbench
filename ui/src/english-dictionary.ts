const directory = '/third-party/english-wordnet-2025';
export const dictionaryCredit = 'Open English Wordnet 2025';
export const dictionaryNotice = directory + '/README.md';

type Partition = {words: Record<string, string[]>; senses: Record<string, string>};
const partitions = new Map<string, Promise<Partition>>();
const parts: Record<string, string> = {n:'noun', v:'verb', a:'adjective', s:'adjective', r:'adverb'};

export function termKey(term: string) {
  return term.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function loadPartition(letter: string): Promise<Partition> {
  const result = await fetch(directory + '/' + letter + '.json.gz');
  if (!result.ok || !result.body) throw new Error('Dictionary unavailable');
  const json = new Response(result.body.pipeThrough(new DecompressionStream('gzip')));
  return json.json();
}

export async function lookupEnglish(term: string) {
  const key = termKey(term);
  if (!key) return [];
  const letter = /^[a-z]/.test(key) ? key[0] : 'other';
  let pending = partitions.get(letter);
  if (!pending) {
    pending = loadPartition(letter).catch(error => { partitions.delete(letter); throw error; });
    partitions.set(letter, pending);
  }
  const {words, senses} = await pending;
  let ids = Object.hasOwn(words, key) ? words[key] : [];
  if (!ids.length && key.endsWith('s') && !key.endsWith('ss')) {
    const bases = [key.slice(0, -1)];
    if (/(ches|shes|sses|xes|zes)$/.test(key)) bases.push(key.slice(0, -2));
    if (key.endsWith('ies')) bases.push(key.slice(0, -3) + 'y');
    ids = [...new Set(bases.flatMap(base => Object.hasOwn(words, base) ? words[base].filter(id => id.endsWith('-n')) : []))];
  }
  return ids.map(id => ({id, part: parts[id.slice(-1)], definition: senses[id]}));
}
