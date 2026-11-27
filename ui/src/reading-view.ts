import {Html} from '@effect/ui/html';
import {Schema} from 'effect';
import type {Document} from './contracts';
import {reading, visibleToken, type ReadingPreferences} from './workspace';

export interface ReadingBlock {
  source_id: string|null; source_kind: string; anchor_token: string|null;
  sections: {id: string; kind: string; number: string|null}[];
  runs: {token: string|null; text: string}[];
}

const Literal = Schema.Struct({_tag: Schema.Literal('Literal'), text: Schema.String});
const Word = Schema.Struct({
  _tag: Schema.Literal('Word'), id: Schema.String, text: Schema.String, original: Schema.String,
  normalized: Schema.String, language: Schema.String, visible: Schema.Boolean, selected: Schema.Boolean,
});
const Block = Schema.Struct({
  number: Schema.String, ordinal: Schema.Number, source: Schema.NullOr(Schema.String), utterance: Schema.NullOr(Schema.String),
  playbackOwner: Schema.NullOr(Schema.String), className: Schema.String, runs: Schema.Array(Schema.Union([Literal, Word])),
});
export const ReadingFrame = Schema.Union([
  Schema.Struct({_tag: Schema.Literal('Loading')}),
  Schema.Struct({_tag: Schema.Literal('Failed')}),
  Schema.Struct({_tag: Schema.Literal('Ready'), epoch: Schema.Number, interlinear: Schema.Boolean,
    empty: Schema.Boolean, blocks: Schema.Array(Block)}),
]);
export type ReadingFrame = typeof ReadingFrame.Type;

export function projectReading(blocks: ReadingBlock[], doc: Document, preferences: ReadingPreferences,
  selected: readonly string[], interlinear: boolean, epoch: number): ReadingFrame {
  const tokens = new Map(doc.tokens.map(token => [token.id, token]));
  const segments = new Set(doc.segments.map(segment => segment.id));
  const selection = new Set(selected);
  let ordinal = 0;
  const projected = blocks.map((block): typeof Block.Type => {
    const hasWords = block.runs.some(run => run.token !== null);
    const separator = !hasWords && block.runs.every(run => !run.text.trim());
    const source = block.source_id ?? block.anchor_token;
    const utterance = block.source_id && segments.has(block.source_id) ? block.source_id : null;
    // A paragraph inside a timed utterance has its own source ID and may share a playback owner.
    const owner = !utterance && block.anchor_token ? tokens.get(block.anchor_token)?.utterance : null;
    const playbackOwner = owner && block.runs.every(run => run.token === null || tokens.get(run.token)?.utterance === owner) ? owner : null;
    return {
      number: hasWords ? String(++ordinal) : '', ordinal, source, utterance, playbackOwner,
      className: hasWords ? 'reading-block utterance' : separator ? 'reading-block utterance literal-block turn-separator' : 'reading-block utterance literal-block',
      runs: block.runs.map(run => {
        if (run.token === null) return {_tag: 'Literal', text: run.text};
        const token = tokens.get(run.token);
        if (!token) throw new Error('Unknown token in reading projection');
        return {
          _tag: 'Word', id: token.id, text: reading(token, preferences.layer), original: token.original,
          normalized: (token.normalized ?? '—') + (token.attrs.wb_normalized_status === 'unresolved' ? ' · unresolved' : ''),
          language: token.language_effective ?? 'Unknown language', visible: visibleToken(token, preferences), selected: selection.has(token.id),
        };
      }),
    };
  });
  return {_tag: 'Ready', epoch, interlinear, empty: !doc.tokens.some(token => visibleToken(token, preferences)), blocks: projected};
}

export const TranscriptReading = Html.component({
  name: 'TranscriptReading', props: ReadingFrame, model: Schema.Null, message: Schema.Never,
}).make({
  init: () => null, update: () => null,
  view: h => {
    const frame = h.props;
    const surface = h.div.id('tokens').class('prose').attrs({tabindex: '0', 'aria-describedby': 'selection-help'});
    if (frame._tag === 'Loading') return surface.children('Loading exact saved transcript…');
    if (frame._tag === 'Failed') return surface.children('Could not load faithful transcript. Preserved XML remains available in Tools.');
    return surface.children(
      frame.empty && h.p.class('empty-state').children('No matching tokens. Clear the filter to return to the transcript.'),
      frame.blocks.map((block, index) => h.section.key(frame.epoch + '/' + index).class(block.className)
        .attrs({'data-utterance': block.utterance ?? undefined, 'data-playback-utterance': block.playbackOwner ?? undefined,
          'data-location': block.source ?? undefined}).children(
          h.span.class('source-number').attrs({'aria-hidden': 'true', title: 'Display number ' + block.ordinal + '; source ' + (block.source ?? 'unanchored literal text')}).children(block.number),
          h.span.class('reading-content').children(block.runs.map(run => run._tag === 'Literal'
            ? h.span.class('reading-text separator').children(run.text)
            : h.span.key(run.id).class('lexeme', !run.visible && 'filtered', run.selected && 'selected')
              .attrs({[run.visible ? 'data-token' : 'data-filtered-token']: run.id, tabindex: '-1', title: run.id + ' · ' + run.language})
              .children(h.span.class('reading-text').children(run.text), frame.interlinear && h.span.class('interlinear')
                .attr('aria-hidden', 'true').children(h.span('Raw ', run.original), h.span('Normalized ', run.normalized), h.span(run.language))))),
        )),
    );
  },
});
