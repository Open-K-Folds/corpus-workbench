# Recording and transcript preparation

**Recording + transcript** opens existing local audio and supplied transcript
output as a new, unreviewed corpus. It preserves both selected source files byte
for byte and creates a separate editable working projection. It does not run ASR,
alignment, translation, language identification or a model.

## Open and review a local transcript

1. Choose **Recording + transcript** from the welcome screen, project controls or
   File menu. Existing save and draft guards still apply when changing projects.
2. Choose **Plain text · UTF-8** or **Omnilingual JSON** explicitly. An optional
   project title does not change the source transcript.
3. Choose **Choose recording and transcript**, then select the two local files.
   Inspect the preview, source hashes, mechanical token count, timing description
   and warnings. A long transcript is shown as an excerpt.
4. Choose **Import for review**. A source already imported with the same format
   and preparation version instead offers **Open existing copy**, retaining its
   saved corrections and review history.
5. Listen, correct, annotate and review in the ordinary workbench. Import never
   approves the transcript. A complete corpus export preserves the authoring
   package; the approved Semantica workflow remains a separate operation.

**Cancel** removes that owned preview without importing a corpus or changing the
selected source files. A preview freezes its copied bytes: changing a source file
after preview does not silently change the pending import. Cancel and choose the
files again to preview newer contents.

## Supported transcript contracts

Plain text must be valid UTF-8. Text, Unicode code points, punctuation, tabs and
line endings are retained in the working reading. Token IDs identify maximal
non-whitespace spans mechanically; they are not model word IDs or a linguistic
tokenization claim. Human corrections and normalized readings start absent.

The supported Omnilingual server response is exactly an object with a text string:

```json
{"text":"SYNTHETIC supplied transcript"}
```

It supplies no timing or run identity. Objects with additional fields or another
result shape are rejected rather than partially interpreted.

The documented local chunk wrapper uses these supplied fields:

- `request_endpoint` is `/v1/audio/transcriptions` and `response_format` is `text`.
- `source_sha256` is the selected recording's SHA-256; it must match.
- `decoded_duration_seconds` is the supplied decoded duration.
- `chunks` contains ordered, consecutive integer indices and successful results.
  Each has `index`, `start_seconds`, `end_seconds`, `duration_seconds`,
  `http_status: 200`, `error: null`, a boolean `empty`, and string `text`.
  The empty flag must agree with the text.
- Optional supplied run fields are `model`, `checkpoint`, `code_version`,
  `config_version`, `run_id`, `device`, `dtype`, `runtime_image_id` and
  `run_started_unix` and bounded string-valued `package_versions`. Supported values retain their JSON pointers in provenance;
  missing values remain unknown.

Chunk text is concatenated in supplied order **without inserting separators**.
Chunk cuts remain explicit in provenance. Supplied nonnegative chunk times must
fit the supplied duration, agree with their durations and have microsecond
precision. They become recording chunk intervals, not inferred speech or word
boundaries. The preparer does not independently measure the claimed duration,
model, device or run configuration. Unsupported schema/version claims, alternate
segment or word-timing shapes, failed chunks and duplicate JSON keys are rejected.

No token times, speaker assignments, language assignments or confidence values
are inferred. Without supplied chunk bounds, seeking uses the recording timeline;
the transcript does not claim aligned word navigation.

## Preserved package

| Path | Purpose |
| --- | --- |
| `Audio/recording.<detected-extension>` | Exact original recording bytes |
| `Raw/transcript.raw.txt` or `Raw/transcript.raw.json` | Exact supplied transcript bytes |
| `xmlfiles/transcript.xml` | Separate editable working projection |
| `Resources/settings.xml` | TEITOK-compatible field descriptions |
| `Resources/preparation-provenance.json` | Versioned source hashes, supplied/unknown run fields and projection policy |
| `Workbench/definitions.json` | Native definitions, restricted local rights and provenance reference |

Recording container headers are checked and determine the packaged extension;
bytes are never transcoded or repaired. A recognized header does not establish
browser decodability, duration, speech content or transcription accuracy.
Original basenames are provenance, not package paths.

XML character references preserve CR, LF and tabs through native XML reading.
No formatting whitespace is added inside the transcript. Source bytes remain
immutable when a correction creates a new native revision.

The default rights remain restricted local research: redistribution and model
training permission are not granted. Preparing, exporting or compiling a source
does not change those rights. Keep original corpus media and provenance out of
public fixtures, screenshots and logs.

## Retry and cancellation

Preparation identity binds the audio hash, raw transcript hash, explicit input
format and preparation version. Filename or title changes do not overwrite an
existing copy. Repeated confirmation, reselecting identical inputs and restarting
the controller reuse its recorded authority. A later human correction remains
intact.

The controller checks the native committed authority after import, including
when the import acknowledgement is lost. A registry failure leaves the committed
corpus and retry identity intact. An uncertain or failed operation preserves its
owned pending data; retry or reselect the same inputs to recover the existing
identity. Cancellation never erases a committed authority or original source.

## Current limits

| Item | Limit |
| --- | --- |
| Original recording | 64 MiB |
| Supplied transcript | 2 MiB |
| Mechanical tokens | 50,000 |
| One mechanical token | 64 KiB of UTF-8 |
| Supplied chunks | 10,000 |
| Generated transcript XML | 16 MiB |
| Native package | 256 MiB total; each artifact at most 64 MiB |

An over-limit or unsupported input is rejected before a new corpus is imported.
The preparer does not automatically compress, split or rewrite a source to make
it fit. A derivative requires its own explicit source identity and provenance.

## Synthetic native qualification

Run against an existing built native executable and a fresh output directory:

```sh
node scripts/verify-local-transcript-import.cjs --binary <native-executable> --out <new-directory>
```

The script generates its own recording, UTF-8 text, Omnilingual server JSON and
chunk wrapper. It checks raw/object hashes, exact native lexical reading and media
bytes, absent word times, supplied chunk intervals, unapproved import, correction
separation, duplicate refusal and complete export/reimport. It also exercises the
real desktop preparation controller's cancellation, frozen preview, concurrent
confirmation guard, duplicate/restart reuse and lost-acknowledgement recovery.
It retains synthetic evidence in the requested directory and refuses an existing
output path. This script does not execute ASR or Semantica; actual Semantica
qualification is described in [SEMANTIC-HANDOFF.md](SEMANTIC-HANDOFF.md).
