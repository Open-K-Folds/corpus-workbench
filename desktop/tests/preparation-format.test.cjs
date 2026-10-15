'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {inflateRawSync} = require('node:zlib');
const {buildPackage} = require('../preparation-format.cjs');

// These bytes are generated here. No corpus recording or transcript is a test fixture.
function syntheticWav(seconds = 2) {
  const samples = 16000 * seconds, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}
// Encoded 0.1-second mono silence, generated with local PyAV 19.0.1 and
// round-trip decoded during fixture creation. Deflate keeps these real
// container fixtures compact; tests require only Node built-ins.
const encodedSilence = {
  flac: 'S/NJdGZgYFBiaWBpYGDgZmDgZX7B8IGBgc1hPtf9288dTs+5IdFlWianUtbCwKDDw8DA4JNYlmZmrGeoZ2hgxMjAwCDCwMCQmpecn5JaZIss9/+HKQcDMwMDQ5bL/x+lHIyM+/cyMDCwTQMA',
  ogg: '809PD2ZgYoCCqX7fbED0t5+aSxiF/QtKiz1SE1MYGS0YG3aDFfiDlMMBSDkjAwPDhvXPlzOagJSHJKYX8zAwMPgklqWZGesZ6hkaGIFUiDAwMKTmJeenpBbZIsuBzWNhEEWYB3JLotB0YTZmMPjx/x8aAgA=',
  mp3: '83QxZmEAAaWQ4GBXBgYGPgYGZp/EsjQzYz1DPUMDIwYE+P854gCc45mXls/AwMDPwMDAysDA3MIQgwlasYB1WMB1LOA/FgCyF+Q2BnSgwgR1GHPL23+e/Shu9jgCEvcA63X0dQ0NDQVRxnqGBoah9Acg99TA3AMVG3XP0HJP6AACAA==',
  m4a: 'lVPNSsNAEP42tVpERbCiSA4V662KreJRehE8eBMFwcu2m9pgNhsy24IeZI++ig/hzcfw6nNUJkk1pSI4ZJjM7sz3zU8CwB/YxyQkowEPbEMyHZ2ctAHUBmkQANjTStoPXMpx//T4sH3YPurAO+quie3GEitQ2dHGjAFEejxUmJEzByx3IcDPj8w4834Xf4oHeOc2lQ8A7uxDxlmZR1suwwjxf95moCwB8IOI7E9GgZsDvmkVSgANrX7v/fo9cw6GKkqnN2RGcTnyyoxidSFjFQUcI4Y6jAcA1knPgDZVfu6rNGA7LWNllEaN/F20yPYiAM9kSZViYp2cyLm2BdanpQI4DUhxw6g45/YhsOCc2+puZpGrL0B1v+qcq9ZrN59YdM4JD0C9Z9N8PEUMj4NsNrpiXawLBbPH4/PJUr9UDSuvkG2DLD2VuubzDeQArHWyfVPKbQHYoftEsZOaiLtnTjGZZEy9+4RDi5sykxwpyzO51UFmWXbLi9IqTGWScN63tML8a2i+WsNl+EpmydlQL+V4MP1NvgA=',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function sameBytes(actual, expected, label = 'source bytes') {
  assert.ok(Buffer.isBuffer(actual), `${label}: missing Buffer`);
  assert.equal(actual.length, expected.length, `${label}: byte count`);
  assert.ok(actual.equals(expected), `${label}: exact bytes differ`);
}
function input(overrides = {}) {
  return {audioBytes: syntheticWav(), audioName: 'synthetic-tone.wav', transcriptBytes: Buffer.from('SYNTHETIC example.'), transcriptName: 'synthetic-transcript.txt', format: 'utf8-text', title: 'Synthetic import', ...overrides};
}
function wrapper(audioBytes = syntheticWav(), overrides = {}) {
  return {source_sha256: sha256(audioBytes), decoded_duration_seconds: 2, request_endpoint: '/v1/audio/transcriptions', response_format: 'text', chunks: [{index: 1, start_seconds: 0, end_seconds: 2, duration_seconds: 2, http_status: 200, error: null, empty: false, text: 'SYNTHETIC chunk.'}], ...overrides};
}
function wrapped(value, overrides = {}) {
  return input({format: 'omnilingual-json', transcriptName: 'synthetic-transcript.json', transcriptBytes: Buffer.from(JSON.stringify(value)), ...overrides});
}
const xml = result => result.files['xmlfiles/transcript.xml'].toString('utf8');
const provenance = result => JSON.parse(result.files['Resources/preparation-provenance.json'].toString('utf8'));
function decodeXML(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_match, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
    return {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"}[entity.toLowerCase()];
  });
}
function utterances(result) {
  return [...xml(result).matchAll(/<u\b([^>]*)>([\s\S]*?)<\/u>/g)].map(match => ({attributes: match[1], text: decodeXML(match[2].replace(/<[^>]*>/g, ''))}));
}
function transcriptText(result) {
  const body = xml(result).match(/<text\b[^>]*>([\s\S]*?)<\/text>/);
  assert.ok(body, 'The XML must contain a text projection');
  return decodeXML(body[1].replace(/<[^>]*>/g, ''));
}
function attributeNumber(attributes, name) {
  const value = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  assert.ok(value, `Missing ${name} attribute`);
  return Number(value[1]);
}
const reject = (options, pattern) => assert.rejects(async () => buildPackage(options), pattern);

test('plain UTF-8 creates a complete local package and retains exact source bytes', async () => {
  const source = input(), audioBefore = Buffer.from(source.audioBytes), transcriptBefore = Buffer.from(source.transcriptBytes);
  const result = await buildPackage(source);
  assert.equal(result.version, 'local-transcript/1');
  assert.deepEqual(Object.keys(result.files).sort(), ['Audio/recording.wav', 'Raw/transcript.raw.txt', 'Resources/preparation-provenance.json', 'Resources/settings.xml', 'Workbench/definitions.json', 'xmlfiles/transcript.xml'].sort());
  for (const bytes of Object.values(result.files)) assert.ok(Buffer.isBuffer(bytes));
  sameBytes(result.files['Audio/recording.wav'], audioBefore);
  sameBytes(result.files['Raw/transcript.raw.txt'], transcriptBefore);
  sameBytes(source.audioBytes, audioBefore); sameBytes(source.transcriptBytes, transcriptBefore);
  assert.equal(result.summary.format, 'utf8-text'); assert.equal(result.summary.segments, 0);
  assert.ok(result.summary.tokens > 0); assert.equal(result.summary.text, 'SYNTHETIC example.');
  assert.match(result.summary.timing, /unknown|untimed|no.*tim/i);
  assert.equal(transcriptText(result), 'SYNTHETIC example.');
  assert.equal(utterances(result).length, 0, 'Untimed text must not invent utterance boundaries');
  const p = provenance(result);
  assert.deepEqual(p.sources.audio, {path: 'Audio/recording.wav', name: source.audioName, sha256: sha256(audioBefore), bytes: audioBefore.length});
  assert.deepEqual(p.sources.transcript, {path: 'Raw/transcript.raw.txt', name: source.transcriptName, sha256: sha256(transcriptBefore), bytes: transcriptBefore.length});
});

test('exact spaces, CRLF, tabs, Unicode, punctuation and literal entities survive tokenization', async () => {
  const text = '  SYNTHETIC\talpha\r\n\r\nβeta 👩🏽‍🔬  a\u00a0b\u202fc — e\u0301 &amp;lt; & < > " \'  ';
  const result = await buildPackage(input({transcriptBytes: Buffer.from(text)}));
  assert.equal(transcriptText(result), text);
  assert.equal(result.summary.text, text);
  assert.match(xml(result), /&#(?:x0*d|13);/i, 'CR must be an XML character reference to survive XML newline normalization');
  assert.doesNotMatch(xml(result), /<(?:w|tok)\b[^>]*\b(?:start|end|begin|dur)\s*=/);
});

test('plain-text BOM is a preserved source code point, and JSON BOM is only ignored for parsing', async () => {
  const plainBytes = Buffer.from('\ufeffSYNTHETIC BOM');
  const plain = await buildPackage(input({transcriptBytes: plainBytes}));
  assert.equal(transcriptText(plain), '\ufeffSYNTHETIC BOM');
  sameBytes(plain.files['Raw/transcript.raw.txt'], plainBytes);
  const jsonBytes = Buffer.from('\ufeff{"text":"SYNTHETIC JSON BOM"}');
  const json = await buildPackage(wrapped({}, {transcriptBytes: jsonBytes}));
  assert.equal(transcriptText(json), 'SYNTHETIC JSON BOM');
  sameBytes(json.files['Raw/transcript.raw.json'], jsonBytes);
});

test('source text and a hostile title remain inert XML text', async () => {
  const text = 'SYNTHETIC </w></u><script>alert("test")</script> & &#13;';
  const result = await buildPackage(input({transcriptBytes: Buffer.from(text), title: '<title " quoted & >'}));
  assert.equal(transcriptText(result), text);
  assert.doesNotMatch(xml(result), /<script\b|<title " quoted/);
  assert.match(xml(result), /&lt;script&gt;/);
});

test('server JSON text is untimed and retains its original JSON bytes', async () => {
  const raw = Buffer.from('{\n  "text": " SYNTHETIC server\\ntext "\n}\n');
  const result = await buildPackage(wrapped({}, {transcriptBytes: raw}));
  assert.equal(result.summary.format, 'omnilingual-json'); assert.equal(result.summary.segments, 0);
  assert.equal(result.summary.text, ' SYNTHETIC server\ntext ');
  sameBytes(result.files['Raw/transcript.raw.json'], raw);
  assert.equal(transcriptText(result), ' SYNTHETIC server\ntext ');
  assert.equal(utterances(result).length, 0);
});

test('local Omnilingual chunks retain recording-relative bounds without inventing word alignment', async () => {
  const chunks = [
    {index: 1, start_seconds: 0, end_seconds: 0.75, duration_seconds: 0.75, http_status: 200, error: null, empty: false, text: 'SYNTHETIC first\t'},
    {index: 2, start_seconds: 0.75, end_seconds: 2, duration_seconds: 1.25, http_status: 200, error: null, empty: false, text: '\r\nsecond.'},
  ];
  const result = await buildPackage(wrapped(wrapper(undefined, {chunks})));
  const units = utterances(result);
  assert.equal(result.summary.segments, 2); assert.equal(result.summary.text, chunks.map(chunk => chunk.text).join(''));
  assert.deepEqual(units.map(u => u.text), chunks.map(chunk => chunk.text));
  assert.equal(attributeNumber(units[0].attributes, 'start'), 0); assert.equal(attributeNumber(units[0].attributes, 'end'), 0.75);
  assert.equal(attributeNumber(units[1].attributes, 'start'), 0.75); assert.equal(attributeNumber(units[1].attributes, 'end'), 2);
  assert.doesNotMatch(xml(result), /<(?:w|tok)\b[^>]*\b(?:start|end|begin|dur)\s*=/);
  assert.equal(transcriptText(result), chunks.map(chunk => chunk.text).join(''));
  assert.match(result.summary.timing, /chunk/i);
});

test('the fixed package content is deterministic for identical source bytes', async () => {
  const source = wrapped(wrapper());
  const first = await buildPackage(source), second = await buildPackage(source);
  for (const name of Object.keys(first.files)) sameBytes(second.files[name], first.files[name], name);
});

test('source payloads are independent copies and cannot mutate the supplied buffers', async () => {
  const source = input(), audioHash = sha256(source.audioBytes), transcriptHash = sha256(source.transcriptBytes);
  const result = await buildPackage(source);
  result.files['Audio/recording.wav'].fill(0);
  result.files['Raw/transcript.raw.txt'].fill(0);
  assert.equal(sha256(source.audioBytes), audioHash);
  assert.equal(sha256(source.transcriptBytes), transcriptHash);
});

test('unknown run data, word timing, language and review remain explicitly unknown', async () => {
  for (const source of [input(), wrapped({text: 'SYNTHETIC no run metadata'})]) {
    const result = await buildPackage(source), p = provenance(result);
    for (const value of Object.values(p.asr.supplied)) assert.equal(value, null);
    for (const field of ['word_times', 'confidence', 'speaker_assignment', 'language_assignment']) assert.equal(p.asr[field], null, field);
    for (const field of ['word_times', 'chunks', 'human_corrections', 'normalized_forms']) assert.equal(p.projection[field], null, field);
    assert.deepEqual(p.review, {approved: false, decision: null});
    assert.match(p.asr.missing, /unknown/i);
    assert.match(p.rights, /local|restrict/i);
    assert.equal(p.projection.sha256, sha256(result.files['xmlfiles/transcript.xml']));
    const definitions = JSON.parse(result.files['Workbench/definitions.json'].toString('utf8'));
    assert.equal(definitions.language_default, null); assert.deepEqual(definitions.language_values, {});
    assert.doesNotMatch(xml(result), /<(?:w|tok)\b[^>]*\b(?:speaker|who|lang|variety|confidence|start|end)\s*=/);
  }
});

test('supplied run claims and older package versions retain their values and source pointers', async () => {
  const claims = {model: 'SYNTHETIC-model', device: 'cpu', dtype: 'float32', runtime_image_id: 'sha256:' + 'b'.repeat(64), run_started_unix: 1234567890, package_versions: {torch: '2.8.0+cu126', fairseq2: '0.6', 'omnilingual-asr': '0.2.0'}};
  const source = wrapped(wrapper(undefined, claims)), result = await buildPackage(source), p = provenance(result);
  for (const [field, value] of Object.entries(claims)) assert.deepEqual(p.asr.supplied[field], {value, json_pointer: `/${field}`});
  for (const field of ['checkpoint', 'code_version', 'config_version', 'run_id']) assert.equal(p.asr.supplied[field], null);
  assert.equal(p.asr.confidence, null); assert.equal(p.asr.word_times, null);
  assert.deepEqual(p.projection.chunks, [{index: 1, start_us: 0, end_us: 2000000}]);
  sameBytes(result.files['Raw/transcript.raw.json'], source.transcriptBytes);
  assert.ok(result.summary.warnings.some(warning => /supplied claims|independently/i.test(warning)));
  for (const value of [[], {torch: 2.8}, {torch: null}]) await reject(wrapped(wrapper(undefined, {package_versions: value})), /package|version|metadata/i);
});

test('malformed UTF-8 and XML-forbidden controls are rejected instead of replaced', async () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('SYNTHETIC\u0000text'), Buffer.from('SYNTHETIC\u000btext')]) {
    await reject(input({transcriptBytes: bytes}), /UTF|XML|control|character|encod/i);
  }
  await reject(wrapped({text: '\ud800'}), /XML|surrogate|character|Unicode/i);
});

test('empty or whitespace-only transcripts and unknown explicit formats are rejected', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from(' \r\n\t ')]) await reject(input({transcriptBytes: bytes}), /empty|transcript|text|token|whitespace|bytes/i);
  await reject(input({format: 'auto'}), /format|support|explicit/i);
  await reject(input({format: 'srt'}), /format|support|explicit/i);
});

test('unsupported or ambiguous Omnilingual shapes are rejected without heuristic conversion', async () => {
  for (const value of [[], null, 'SYNTHETIC', {segments: [{text: 'SYNTHETIC'}]}, {text: 12}, {text: 'SYNTHETIC', chunks: []}, {chunks: []}]) {
    await reject(wrapped(value), /shape|schema|support|text|chunk|object|ambig|empty|source/i);
  }
  for (const claim of ['schema', '$schema', 'schema_version', 'schemaVersion', 'version', 'format', 'format_version', 'segments', 'words', 'word_times', 'word_timestamps', 'word-times']) {
    await reject(wrapped(wrapper(undefined, {[claim]: 1})), /shape|schema|support|version|align/i);
  }
  const chunk = wrapper().chunks[0];
  await reject(wrapped(wrapper(undefined, {chunks: [{...chunk, schemaVersion: 1}]})), /shape|schema|support|version|align/i);
});

test('duplicate JSON keys and excessive nesting are rejected', async () => {
  await reject(wrapped({}, {transcriptBytes: Buffer.from('{"text":"SYNTHETIC first","text":"SYNTHETIC second"}')}), /duplicat/i);
  const deep = '{"text":"SYNTHETIC","nested":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}';
  await reject(wrapped({}, {transcriptBytes: Buffer.from(deep)}), /depth|nest/i);
});

test('wrapper import requires the selected recording hash and supported request provenance', async () => {
  await reject(wrapped(wrapper(undefined, {source_sha256: 'f'.repeat(64)})), /hash|recording|audio|source/i);
  const missing = wrapper(); delete missing.source_sha256;
  await reject(wrapped(missing), /hash|source/i);
  await reject(wrapped(wrapper(undefined, {request_endpoint: '/other'})), /endpoint|provenance|support/i);
  await reject(wrapped(wrapper(undefined, {response_format: 'verbose_json'})), /format|provenance|support/i);
});

test('failed, empty or erroneous chunks never become editable transcript content', async () => {
  const base = wrapper().chunks[0];
  for (const changes of [{http_status: 500}, {error: 'synthetic failure'}, {empty: true}, {text: ''}, {text: ' \t'}]) {
    await reject(wrapped(wrapper(undefined, {chunks: [{...base, ...changes}]})), /chunk|fail|error|empty|text|status/i);
  }
});

test('chunk bounds must be finite, increasing, in range and consistent with their duration', async () => {
  const base = wrapper().chunks[0];
  for (const changes of [{start_seconds: -1}, {start_seconds: 2}, {end_seconds: 0}, {end_seconds: 3}, {duration_seconds: 1}, {start_seconds: null}, {end_seconds: '2'}]) {
    await reject(wrapped(wrapper(undefined, {chunks: [{...base, ...changes}]})), /time|bound|duration|chunk|number|range|finite/i);
  }
  const missing = {...base}; delete missing.end_seconds;
  await reject(wrapped(wrapper(undefined, {chunks: [missing]})), /time|bound|duration|chunk|number/i);
  await reject(wrapped(wrapper(undefined, {decoded_duration_seconds: -1})), /duration|time|number|range/i);
  await reject(wrapped(wrapper(undefined, {chunks: [{...base, end_seconds: 1, duration_seconds: 1}, {...base, index: 2, start_seconds: 0.5, end_seconds: 2, duration_seconds: 1.5}]})), /overlap|order|bound|chunk|time/i);
});

test('source names are basenames and cannot address absolute, hidden or reserved paths', async () => {
  for (const name of ['../source.wav', 'nested/source.wav', 'nested\\source.wav', '/source.wav', 'C:\\private\\source.wav', '\\\\server\\share\\source.wav', '.source.wav', 'source.wav.', 'source.wav ', 'source\n.wav', 'CON.wav', 'nul.wav', 'COM1.wav']) {
    await reject(input({audioName: name}), /name|path|reserved|safe|recording|audio/i);
  }
  for (const name of ['../source.txt', 'C:\\private\\source.txt', '.hidden.txt', 'NUL.txt']) await reject(input({transcriptName: name}), /name|path|reserved|safe|transcript/i);
});

test('renamed recordings use the detected container for the fixed local destination', async () => {
  for (const extension of ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'webm', 'exe']) {
    const result = await buildPackage(input({audioName: `synthetic.${extension}`}));
    sameBytes(result.files['Audio/recording.wav'], syntheticWav());
    assert.ok(xml(result).includes('Audio/recording.wav'));
    assert.equal(provenance(result).sources.audio.name, `synthetic.${extension}`);
  }
});

test('real generated compressed containers are detected independently of their filename', async () => {
  for (const [extension, compressed] of Object.entries(encodedSilence)) {
    const audioBytes = inflateRawSync(Buffer.from(compressed, 'base64'));
    const result = await buildPackage(input({audioBytes, audioName: 'renamed.wav'}));
    sameBytes(result.files[`Audio/recording.${extension}`], audioBytes, extension);
    assert.ok(xml(result).includes(`Audio/recording.${extension}`), extension);
  }
});

test('arbitrary bytes and truncated container headers cannot pass as recordings', async () => {
  const bytes = syntheticWav();
  for (const audioBytes of [Buffer.from('SYNTHETIC not an audio container'), bytes.subarray(0, 20), Buffer.from('RIFF\x00\x00\x00\x00WAVE'), Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00')]) {
    await reject(input({audioBytes}), /container|header|recording|audio|payload|WAV|MP3/i);
  }
  const invalidLength = Buffer.from(bytes); invalidLength.writeUInt32LE(bytes.length + 100, 40);
  await reject(input({audioBytes: invalidLength}), /container|header|WAV|size|length|data|truncat/i);
});

test('size and token limits fail explicitly before creating an oversized working copy', async () => {
  await reject(input({transcriptBytes: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)}), /large|size|limit|MiB|bytes/i);
  await reject(input({transcriptBytes: Buffer.from('word '.repeat(50001))}), /token|limit|large/i);
  await reject(input({transcriptBytes: Buffer.from('🦊'.repeat(16385))}), /token|limit|KiB|large/i);
  await reject(input({audioBytes: Buffer.alloc(0)}), /recording|audio|nonempty/i);
});

test('the segment limit bounds supported wrapper imports', async () => {
  const chunks = Array.from({length: 10001}, (_unused, index) => ({index: index + 1, start_seconds: index, end_seconds: index + 1, duration_seconds: 1, http_status: 200, error: null, empty: false, text: 'x'}));
  await reject(wrapped(wrapper(undefined, {decoded_duration_seconds: chunks.length, chunks})), /segment|chunk|limit|large/i);
});
