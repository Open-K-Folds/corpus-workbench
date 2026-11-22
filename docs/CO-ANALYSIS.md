# Reading a transcript with a model

In the desktop welcome screen, choose **Start a new practice copy**. The
transcript stage opens on **Who gets the notice?**. You can also import the
[standalone practice package](../fixtures/coanalysis). Two fictional speakers
describe when they heard about a meeting. The exercise is to distinguish what
they report from what a researcher might infer about how the notice reached them.

1. Drag the numbered handle beside the current turn to move through the
   source, or use the slider and arrow controls below the text. **Focus mode**
   gives the transcript more room. Adjust
   the text size with the **−** and **+** buttons. Drag across “I only heard
   after the meeting.” and choose **Co-analyse**. In the inspector you can see
   the saved excerpt, its revision and its token IDs.
   To experiment with another passage of the same length, choose **Pin on canvas**.
   Drag the underlined middle word onto a new word and release. You can also
   focus that underline and press Left or Right to move one word at a time.
   Click it or press Enter to open the passage tools. Delete removes the pin.
   The pin lasts for the current reading projection. Saving a training example
   still requires an explicit review in the training panel. The interaction
   follows Chuanqi Sun’s [Spaceship attention-lock demonstration](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/extra/clips/attention-lock.gif).
2. Optionally write **Your first reading** while the passage is in front of you.
   This note stays out of the prompt. It appears beside the model response when
   you review the two together. Choose **Competing readings** or write your own
   question. For example,
   “What does this speaker tell us about timing? What else would we need to know
   to explain it?” Expand the prompt to see exactly what the model receives.
3. In Electron, **Ask local model** sends that prompt to a single-model
   `llama-server` listening on `127.0.0.1:8080`. With a GGUF model already on
   your computer, start it with
   `llama-server -m path/to/model.gguf --host 127.0.0.1 --port 8080`.
   In a browser, or to use another local model, copy the prompt, run it yourself,
   and enter the model identity and reply. [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
4. Read the proposal against the passage. Under **Check a quoted phrase**, enter
   `only heard after` to resolve it to tokens `b2, b3, b4`. Try
   `never saw the board` to see an unsupported quotation. A literal match locates
   wording. Record your own assessment of the meaning and your reasoning.
   **Save reviewed annotation** keeps both voices on the selected tokens in a
   named revision. Corpus approval remains a separate action in **Review**.
5. Return to the transcript and inspect the third turn. “I heard beforehand,
   from my neighbour” is a counterexample to “everyone heard too late.” It
   still leaves open whether either speaker read the board. Reopen the saved
   annotation to compare the initial interpretation with this new evidence.

Only the selected saved readings, their anchors and the question are needed for
the model prompt. The response is free text. A citation or factual assertion
inside it needs checking against the passage. The local endpoint is operated by
the researcher. Use a model and data appropriate to that environment.

For a transcript with audio, **Listen to pinned passage** replays the supplied
word interval, or its source utterance if word timing is unavailable. The
control names the timing basis. Changing the current selection keeps the
original passage pinned. A text-only document has no listening action available.

## Collect training examples

Open **Who gets the notice?** in a new practice copy. Select the second turn by clicking
“I” and Shift-clicking “meeting.” Open **Training collections** on the rail. Choose
**Label a passage** for a speech act, topic, language observation, transcription issue
or another category from your project. A passage can carry several distinct labels.

To compare passages, choose **Same meaning**, **Similar wording** or **Easy to confuse**.
You can also click a selected word twice, hold the second press and drag towards a lens.
Drag farther to request up to 3, 6 or 12 candidates. Release near the starting point to
cancel. For keyboard control, open the selection tools with Shift+F10 and choose
**Training lenses**. The angle and distance select the search mode and number of results.

Try comparing “I only heard after the meeting” with “By the time I found out, it was
already over.” Open **Source context** on each passage before judging whether both refer
to the same event. Compare again with “I got there after the meeting.” The wording is
close, but arriving and hearing about something describe different events. You can also
find a passage by entering words from the corpus. Candidate ranking uses vocabulary
and nearby text, so rephrasings with little shared wording can be missed.

For a repeated expression, enter its wording and choose **Matched words only** under
**Search result span**. Each occurrence has its own token IDs. **Source context**
shows the surrounding text while the exported comparison contains just the matching
source tokens. This is especially helpful with long transcripts lacking punctuation.

Name the collection and enter your own relationship, such as **Same meaning**,
**Partial overlap**, **Different** or **Needs context**. **Model second reading** lets
you inspect the prompt and ask the desktop’s local model, or attach a reply obtained
manually. The saved example keeps the model name, prompt and reply alongside your
label. A confirmed save creates a revision. Suggestions alone create no examples.

Open **Saved collections** to revisit the source at its captured revision or export
one JSONL record per reviewed example. Each record carries document and snapshot
hashes, token IDs, the reviewer's label and the observed speaker, language and timing
where available. A passage with linked media includes the source document’s media
references for use with the corpus package. The display quote joins token readings with spaces. The per-token
readings retain original strings and human corrections separately. Source context can
play an excerpt when the project provides an unambiguous recording and a usable interval.
Distinct utterances and speaker IDs are counted within documents. A recurring label
such as “A” in two interviews therefore makes no claim about the person's identity.

The library shows the project's corpus-use terms before export. Each JSONL row
includes those terms and the project's machine-draft provenance at the export
revision in `exportedFrom`.

## Where the interaction comes from

Chuanqi Sun (MIT Media Lab), *Spaceship IDE: Steer Your Ideas in Realtime,
Space Pilot Style* (2026), is the design inspiration for this workflow. Sun's
prototype lets a writer lock a phrase, tune a generation direction, and explore
alternative continuations. Its focus monitor asks a model to nominate relevant
phrases. Corpus Workbench adapts those ideas to reading evidence. Thank you to
Sun and the Spaceship contributors for making the design and implementation
public. The workbench implementation is original. [Spaceship IDE](https://github.com/chuanqisun/spaceship) · [Interactive demo](https://chuanqisun.github.io/spaceship/) · [Author's citation](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/CITATION.cff) · [MIT license](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/LICENSE)

| Interaction in Spaceship | Workbench adaptation | What a researcher can check |
| --- | --- | --- |
| Open text field with controls at the edge | A reading canvas with a movable reading position and native text selection | The saved words under a selection and the source turn being inspected |
| Lock a phrase | Select the saved tokens that enter the model prompt | The excerpt, omissions, source document and revision |
| Steer the next generation | Pick a lens or edit its question | The complete prompt before running a model |
| Explore another continuation | Save a judgment, then ask a different question of the passage | The proposal, researcher assessment and rationale in each annotation |
| Focus monitor | Check a quotation from a proposal against the pinned passage | Exact text and IDs, ambiguity and missing matches |

Spaceship also invalidates speculative continuations after a change of
direction. The counterpart in transcript analysis is revision checking. A
proposal about an earlier reading belongs with that reading. [Focus monitor source](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/src/text/live-attention.ts) · [Upstream design notes](https://github.com/chuanqisun/spaceship#design-process)

Spaceship's open reading surface sets ordinary text in a narrow central column.
Dragging its handle steers how much generated text is revealed. In a transcript
the words are already evidence. The Workbench scrubber moves the reading
position through those source turns, and dragging across words selects the
passage for analysis. [Upstream reading surface](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/index.html) · [Upstream interaction implementation](https://github.com/chuanqisun/spaceship/blob/0499b9930bdc0c471ee62ee1b1c01e1a986fb4ec/src/text/main.ts)

## Practice observations, 22 November 2026

The four [quotation checks](../ui/tests/quote-check.spec.ts) passed twice in Chrome 157.
Each browser journey started with a fresh native import. “only heard after”
resolved to `b2, b3, b4`. A wrong-turn phrase, invented words, a phrase
spanning two turns and a phrase spanning omitted tokens produced zero matches.
With both turns pinned, “heard” offered `b3` and `c2`. Lookups made zero
write requests and the authority stayed at R1 with zero annotations. Matching
uses whole saved tokens, with the displayed spaces, punctuation, case and
Unicode spelling. The researcher's temporary lookup is a reading aid.

A Windows Electron session used llama.cpp b12631 and Qwen2.5-0.5B-Instruct
(Q4_K_M) on the same synthetic passage. The model acknowledged that the cause
of the delay was unspecified, but conflated hearing about the meeting with
hearing the meeting itself. The tester recorded that distinction. The model
call left R1 intact. Saving the assessment created an unapproved R2
annotation on `b1…b6`. The original XML hash matched R1, and the exported
package reopened with the exact annotation note. This run exercises provenance
and review mechanics. Analytical quality on field interviews needs a separate
evaluation. [llama.cpp build](https://github.com/ggml-org/llama.cpp/releases/tag/b12631) · [Test model](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67)

On a second run from the packaged app's **Start a new practice copy** action,
the same model proposed a technical issue as the cause of the delay. The tester
used **Check a quoted phrase** to locate “only heard after”, recorded the lack
of evidence for the proposed cause, and reopened both accounts. This negative
example shows why it is worth recording an independent reading before opening a proposal. The run
record retains the exact question, reply, assessment, token IDs and model
identity. [Packaged practice run](../evidence/coanalysis/noticeboard.json)

We then used **Corpus search** for `heard`. It returned `b3` in the late
account and `c2` in the early one. In the reading canvas we selected both
turns and recorded a first reading before sending the question. The model
rejected “everybody heard too late”, then contradicted the second speaker
while explaining its answer. Export and reimport retained the independent
observation, untouched reply, final assessment and all twelve token IDs. The
model received neither the initial observation nor the rest of the document.

Listening checks used a separate 16-second generated tone. An early run found
that a text-only document carrying a timestamp still offered playback. After
repair, both the selection tools and the pinned-passage button reported missing
audio. A word anchored at 2.0–2.6 seconds and an utterance anchored at
7.0–12.0 seconds each played to its supplied boundary. Two competing readings
of the same word reopened separately. This qualifies playback and evidence
retention. Assessing speech or comparing analysts' interpretations requires
actual listening and an appropriate research protocol.
