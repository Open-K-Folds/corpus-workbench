'use strict';

// Synthetic qualification against the real native authority. No ASR, model,
// compiler, original corpus or external service is used by this script.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {Backend, runCLI} = require('../desktop/backend.cjs');
const {PreparationController} = require('../desktop/preparation.cjs');
const {Registry} = require('../desktop/registry.cjs');
const {buildPackage, VERSION} = require('../desktop/preparation-format.cjs');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = path.resolve(__dirname, '..');

function argumentsFor(values) {
  if (values.includes('--help')) {
    console.log('node scripts/verify-local-transcript-import.cjs --binary NATIVE_EXECUTABLE --out NEW_DIRECTORY');
    return null;
  }
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    assert(['--binary', '--out'].includes(name) && values[index + 1], 'Supply --binary and --out only.');
    assert(!Object.hasOwn(result, name), 'Duplicate argument.');
    result[name] = path.resolve(values[index + 1]);
  }
  assert(result['--binary'] && result['--out'], 'Supply --binary and --out.');
  return result;
}

function recording() {
  const rate = 16000, samples = rate * 2, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++)
    bytes.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 220 * sample / rate)), 44 + sample * 2);
  return bytes;
}

function native(binary, store, project, command, ...args) {
  const result = spawnSync(binary, [command, '--store', store, '--project', project, ...args.map(String)],
    {cwd: repository, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024});
  if (result.error) throw result.error;
  return result;
}

function successful(binary, store, project, command, ...args) {
  const result = native(binary, store, project, command, ...args);
  assert.equal(result.status, 0, result.stderr || 'Native command failed.');
  return command === 'export' ? result.stdout : JSON.parse(result.stdout);
}

async function writeFiles(root, files) {
  await fs.mkdir(root);
  for (const [name, bytes] of Object.entries(files)) {
    assert(Buffer.isBuffer(bytes), 'Prepared package files must be byte buffers.');
    const target = path.resolve(root, name), relative = path.relative(root, target);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Prepared file escapes package.');
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes, {flag: 'wx'});
  }
}

async function exactArtifacts(store, view, files) {
  for (const [name, bytes] of Object.entries(files)) {
    const artifact = view.snapshot.files[name];
    assert(artifact, 'Prepared artifact missing from native snapshot.');
    assert.equal(artifact.sha256, hash(bytes), 'Native artifact hash changed.');
    assert.equal(artifact.bytes, bytes.length);
    assert.deepEqual(await fs.readFile(path.join(store, 'objects', artifact.sha256)), bytes);
  }
}

async function qualify(binary, output, fixture, audioBytes, ui) {
  const root = path.join(output, fixture.name);
  await fs.mkdir(root);
  const sourceAudio = path.join(root, 'SYNTHETIC-recording.wav');
  const sourceTranscript = path.join(root, 'SYNTHETIC-source.' + fixture.extension);
  await fs.writeFile(sourceAudio, audioBytes, {flag: 'wx'});
  await fs.writeFile(sourceTranscript, fixture.bytes, {flag: 'wx'});
  const prepared = buildPackage({
    audioBytes, audioName: path.basename(sourceAudio),
    transcriptBytes: fixture.bytes, transcriptName: path.basename(sourceTranscript),
    format: fixture.format, title: 'SYNTHETIC native preparation verification',
  });
  assert.equal(prepared.version, VERSION);
  assert.equal(prepared.summary.text, fixture.text);
  assert.equal(prepared.summary.segments, fixture.bounds.length);
  const rawPath = 'Raw/transcript.raw.' + fixture.extension;
  assert.deepEqual(prepared.files[rawPath], fixture.bytes);
  assert.deepEqual(prepared.files['Audio/recording.wav'], audioBytes);
  const provenance = JSON.parse(prepared.files['Resources/preparation-provenance.json']);
  assert.equal(provenance.adapter, VERSION);
  assert.equal(provenance.sources.transcript.sha256, hash(fixture.bytes));
  assert.equal(provenance.sources.audio.sha256, hash(audioBytes));
  assert.equal(provenance.review.approved, false);
  assert.equal(provenance.asr.word_times, null);
  assert.equal(provenance.asr.confidence, null);
  assert.equal(provenance.asr.supplied.checkpoint, null);
  if (fixture.model) assert.deepEqual(provenance.asr.supplied.model, {value: fixture.model, json_pointer: '/model'});
  else assert.equal(provenance.asr.supplied.model, null);

  const packageRoot = path.join(root, 'prepared-package'), store = path.join(root, 'authority');
  await writeFiles(packageRoot, prepared.files);
  const project = 'prepared-' + fixture.name;
  const revision = successful(binary, store, project, 'import', '--package', packageRoot);
  const imported = successful(binary, store, project, 'view');
  assert.equal(imported.revision.id, revision.id);
  assert.equal(imported.approved, false, 'Preparing a transcript must never grant approval.');
  assert.equal(successful(binary, store, project, 'generations').length, 0);
  assert.notEqual(native(binary, store, project, 'contract', '--revision', revision.id).status, 0);
  const duplicate = native(binary, store, project, 'import', '--package', packageRoot);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /project already imported/);
  assert.equal(successful(binary, store, project, 'view').revision.id, revision.id);
  await exactArtifacts(store, imported, prepared.files);
  assert.equal(imported.snapshot.files[rawPath].role, 'immutable-machine-draft');
  assert.equal(imported.snapshot.files['Audio/recording.wav'].role, 'source-media');
  assert.match(imported.snapshot.config.machine_draft_provenance, /unreviewed/i);
  assert.match(imported.snapshot.config.rights, /redistribution and training not granted/);
  assert.equal(imported.issues.filter(issue => issue.blocking).length, 0);
  const document = imported.documents[0];
  assert.equal(document.path, 'xmlfiles/transcript.xml');
  assert.deepEqual(document.media, ['Audio/recording.wav']);
  assert.equal(document.tokens.length, prepared.summary.tokens);
  assert(document.tokens.every(token => token.editable && token.corrected === null && token.normalized === null));
  assert(document.tokens.every(token => token.start_us === null && token.end_us === null), 'No word timing may be inferred.');
  assert.deepEqual(document.segments.map(segment => [segment.start_us, segment.end_us]), fixture.bounds);

  const backend = new Backend(binary, ui, path.join(root, 'runtime'));
  try {
    await backend.start(store, project);
    const history = await backend.request('/api/history');
    assert.equal(history.status, 200);
    assert.equal((await history.json()).length, 1);
    const readingResponse = await backend.request('/api/reading?' + new URLSearchParams({
      path: document.path, revision: String(revision.id),
    }));
    assert.equal(readingResponse.status, 200);
    const reading = await readingResponse.json();
    assert.equal(reading.snapshot_hash, revision.snapshot_hash);
    assert.equal(reading.artifact_hash, imported.snapshot.files[document.path].sha256);
    assert.equal(reading.blocks.flatMap(block => block.runs).map(run => run.text).join(''), fixture.text,
      'Native lexical reading must retain exact CRLF, separators and Unicode.');
    const media = await backend.request('/api/media?' + new URLSearchParams({
      path: 'Audio/recording.wav', revision: String(revision.id),
    }));
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), audioBytes);
  } finally {
    await backend.stop();
  }

  const command = {
    schema: 1, project, command_id: 'synthetic-human-correction',
    base_revision: revision.id, preimage_hash: revision.snapshot_hash,
    config_version: imported.snapshot.config.version, label: 'SYNTHETIC human correction',
    operations: [{kind: 'set_token', document: document.path, token: document.tokens[0].id,
      fields: {nform: 'SYNTHETIC-corrected'}}],
  };
  const commandFile = path.join(root, 'synthetic-correction.json');
  await fs.writeFile(commandFile, JSON.stringify(command), {flag: 'wx'});
  successful(binary, store, project, 'apply', '--command', commandFile);
  const corrected = successful(binary, store, project, 'view');
  assert.equal(corrected.documents[0].tokens[0].original, document.tokens[0].original);
  assert.equal(corrected.documents[0].tokens[0].corrected, 'SYNTHETIC-corrected');
  assert.equal(corrected.approved, false);
  assert.deepEqual(corrected.snapshot.files[rawPath], imported.snapshot.files[rawPath]);
  assert.deepEqual(corrected.snapshot.files['Audio/recording.wav'], imported.snapshot.files['Audio/recording.wav']);

  const exported = path.join(root, 'complete-export');
  successful(binary, store, project, 'export', '--revision', corrected.revision.id, '--out', exported);
  for (const [name, bytes] of Object.entries(prepared.files))
    if (name !== document.path) assert.deepEqual(await fs.readFile(path.join(exported, name)), bytes);
  const reimportedStore = path.join(root, 'reimported-authority');
  successful(binary, reimportedStore, project, 'import', '--package', exported);
  const restored = successful(binary, reimportedStore, project, 'view');
  assert.equal(restored.approved, false);
  assert.equal(restored.documents[0].tokens[0].original, document.tokens[0].original);
  assert.equal(restored.documents[0].tokens[0].corrected, 'SYNTHETIC-corrected');
  assert.deepEqual(restored.snapshot.config, corrected.snapshot.config);
  assert.deepEqual(await fs.readFile(path.join(sourceAudio)), audioBytes);
  assert.deepEqual(await fs.readFile(path.join(sourceTranscript)), fixture.bytes);
  await exactArtifacts(reimportedStore, restored, Object.fromEntries(
    Object.entries(prepared.files).filter(([name]) => name !== document.path)));
  return {
    case: fixture.name, tokens: document.tokens.length, supplied_chunks: fixture.bounds.length,
    raw_sha256: hash(fixture.bytes), audio_sha256: hash(audioBytes),
    raw_bytes_exact: true, source_files_unchanged: true, lexical_reading_exact: true,
    token_times_absent: true, unapproved_on_import_and_reimport: true,
    duplicate_project_refused: true, correction_preserves_original: true, complete_export_verified: true,
  };
}

async function qualifyController(binary, output, audioBytes) {
  const root = path.join(output, 'controller'), profile = path.join(root, 'isolated-profile');
  await fs.mkdir(root);
  const audioPath = path.join(root, 'SYNTHETIC-recording.wav');
  const transcriptPath = path.join(root, 'SYNTHETIC-transcript.txt');
  const original = Buffer.from('SYNTHETIC frozen preview e\u0301\r\n\ttext', 'utf8');
  await fs.writeFile(audioPath, audioBytes, {flag: 'wx'});
  await fs.writeFile(transcriptPath, original, {flag: 'wx'});
  const registry = await new Registry(profile).load();
  const controller = new PreparationController({profile, binary, registry});
  const input = {audioPath, transcriptPath, format: 'utf8-text', title: 'SYNTHETIC controller proof'};

  const cancelled = await controller.preview(input);
  assert.deepEqual(await controller.cancel(cancelled.token), {cancelled: true});
  await assert.rejects(controller.commit(cancelled.token), /unavailable/);
  assert.equal((await fs.readdir(path.join(profile, 'projects'))).length, 0);
  assert.deepEqual(await fs.readFile(audioPath), audioBytes);
  assert.deepEqual(await fs.readFile(transcriptPath), original);

  const frozen = await controller.preview(input);
  assert.equal(frozen.copy_policy, 'frozen-preview');
  await fs.writeFile(transcriptPath, 'SYNTHETIC changed after preview', 'utf8');
  const [committed, concurrent] = await Promise.allSettled([
    controller.commit(frozen.token), controller.commit(frozen.token),
  ]);
  assert.equal(committed.status, 'fulfilled', committed.reason?.message);
  assert.equal(concurrent.status, 'rejected');
  assert.match(concurrent.reason.message, /already in progress/);
  const imported = committed.value;
  assert.equal(imported.reused, false);
  assert.equal(imported.recovered, false);
  const view = successful(binary, imported.entry.store, imported.entry.project, 'view');
  assert.equal(view.approved, false);
  const raw = view.snapshot.files['Raw/transcript.raw.txt'];
  assert.equal(raw.sha256, hash(original), 'Commit must use exactly the previewed copy.');
  assert.deepEqual(await fs.readFile(path.join(imported.entry.store, 'objects', raw.sha256)), original);

  const retry = await controller.commit(frozen.token);
  assert.equal(retry.reused, true);
  assert.equal(retry.entry.store, imported.entry.store);
  const commandFile = path.join(root, 'synthetic-controller-correction.json');
  await fs.writeFile(commandFile, JSON.stringify({
    schema: 1, project: imported.entry.project, command_id: 'synthetic-controller-correction',
    base_revision: view.revision.id, preimage_hash: view.revision.snapshot_hash,
    config_version: view.snapshot.config.version, label: 'SYNTHETIC correction before duplicate import',
    operations: [{kind: 'set_token', document: view.documents[0].path,
      token: view.documents[0].tokens[0].id, fields: {nform: 'SYNTHETIC-kept-correction'}}],
  }), {flag: 'wx'});
  successful(binary, imported.entry.store, imported.entry.project, 'apply', '--command', commandFile);
  await fs.writeFile(transcriptPath, original);
  const duplicate = await controller.preview(input);
  assert.equal(duplicate.duplicate, true);
  const reused = await controller.commit(duplicate.token);
  assert.equal(reused.reused, true);
  assert.equal(reused.entry.store, imported.entry.store);
  const preserved = successful(binary, reused.entry.store, reused.entry.project, 'view');
  assert.equal(preserved.documents[0].tokens[0].corrected, 'SYNTHETIC-kept-correction');
  assert.equal(preserved.revision.id, view.revision.id + 1);
  assert.equal((await fs.readdir(path.join(profile, 'projects'))).length, 1);
  const restarted = new PreparationController({profile, binary, registry: await new Registry(profile).load()});
  const reopened = await restarted.commit(duplicate.token);
  assert.equal(reopened.reused, true);
  assert.equal(reopened.entry.store, imported.entry.store);

  // Lose only the acknowledgement after a real native import has committed.
  // Recovery must discover that same authority instead of importing twice.
  let nativeImports = 0;
  const losingResponse = new PreparationController({
    profile, binary, registry,
    runCLI: async (executable, args) => {
      const response = await runCLI(executable, args);
      if (args[0] === 'import') {nativeImports++; throw new Error('SYNTHETIC lost import response');}
      return response;
    },
  });
  await fs.writeFile(transcriptPath, Buffer.from('SYNTHETIC separate response-loss input', 'utf8'));
  const recoverable = await losingResponse.preview(input);
  const recovered = await losingResponse.commit(recoverable.token);
  assert.equal(recovered.recovered, true);
  assert.equal(nativeImports, 1);
  const recoveredRetry = await losingResponse.commit(recoverable.token);
  assert.equal(recoveredRetry.reused, true);
  assert.equal(recoveredRetry.entry.store, recovered.entry.store);
  assert.equal(nativeImports, 1);
  return {cancel_before_import: true, frozen_preview_bytes: true, concurrent_commit_refused: true,
    duplicate_reuses_authority: true, human_correction_retained: true,
    restart_reuses_authority: true, native_response_loss_recovered_once: true};
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (!args) return;
  const binary = await fs.realpath(args['--binary']), output = args['--out'];
  assert((await fs.stat(binary)).isFile(), 'Native executable required.');
  await fs.mkdir(output); // Reserve a fresh synthetic-only qualification directory.
  const ui = path.join(output, 'api-test-ui');
  await fs.mkdir(ui);
  await fs.writeFile(path.join(ui, 'index.html'), '<!doctype html><title>SYNTHETIC API qualification</title>', {flag: 'wx'});
  const audio = recording();
  const plain = 'SYNTHETIC  e\u0301 & < > "quoted"\tisiXhosa\r\n\u00a0mixed \u{1f642}\r\n';
  const serverText = 'SYNTHETIC server e\u0301\r\n\tunaligned & text';
  const chunkOne = 'SYNTHETIC timed e\u0301\r\n', chunkTwo = 'second\tchunk';
  const model = 'SYNTHETIC supplied model claim';
  const wrapper = {
    source_sha256: hash(audio), decoded_duration_seconds: 2,
    request_endpoint: '/v1/audio/transcriptions', response_format: 'text',
    model, checkpoint: null, run_id: 'SYNTHETIC-run',
    chunks: [
      {index: 1, start_seconds: 0, end_seconds: 1, duration_seconds: 1, http_status: 200, error: null, empty: false, text: chunkOne},
      {index: 2, start_seconds: 1, end_seconds: 2, duration_seconds: 1, http_status: 200, error: null, empty: false, text: chunkTwo},
    ],
  };
  const json = value => Buffer.from(JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
  const fixtures = [
    {name: 'plain', format: 'utf8-text', extension: 'txt', bytes: Buffer.from(plain), text: plain, bounds: []},
    {name: 'server-json', format: 'omnilingual-json', extension: 'json', bytes: json({text: serverText}), text: serverText, bounds: []},
    {name: 'chunk-json', format: 'omnilingual-json', extension: 'json', bytes: json(wrapper),
      text: chunkOne + chunkTwo, bounds: [[0, 1000000], [1000000, 2000000]], model},
  ];
  const cases = [];
  for (const fixture of fixtures) cases.push(await qualify(binary, output, fixture, audio, ui));
  const controller = await qualifyController(binary, output, audio);
  const evidence = {schema: 1, adapter: VERSION, synthetic_only: true, native_authority: true,
    actual_asr_or_semantica_executed: false, output, cases, controller};
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(evidence));
}

main().catch(error => {console.error(error.stack || String(error)); process.exitCode = 1;});
