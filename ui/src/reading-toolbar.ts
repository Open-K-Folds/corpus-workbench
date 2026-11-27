import {h} from './effect-view';
import {icon} from './icons';

export function readingToolbar(){
  return h.div.class('stage-actions').children(
    h.details.class('reading-settings').children(
      h.summary(icon('tune'), 'Reading controls', icon('expand_more')),
      h.div
        .class('reader-sheet')
        .attrs({'data-reader-section': 'display'})
        .children(
          h.div
            .id('reader-section-switch')
            .attrs({role: 'group', 'aria-label': 'Reading settings sections'})
            .children(
              h.button
                .attrs({type: 'button', 'aria-controls': 'reader-display', 'aria-pressed': 'true'})
                .children('Display'),
              h.button
                .attrs({type: 'button', 'aria-controls': 'reader-source', 'aria-pressed': 'false'})
                .children('Source'),
            ),
          h.section
            .id('reader-display')
            .class('reader-display')
            .attrs({'aria-labelledby': 'reader-display-heading'})
            .children(
              h.div
                .class('reader-section-heading')
                .children(
                  h.h2.id('reader-display-heading').children('Text display'),
                  h.button
                    .id('reading-guide-button')
                    .class('reader-text-command')
                    .attrs({
                      type: 'button',
                      popovertarget: 'reading-guide',
                      'aria-label': 'Selection guide',
                      title: 'Selection guide',
                    })
                    .children(icon('keyboard'), h.span('Selection guide')),
                ),
              h.fieldset
                .id('transcript-layout')
                .class('segmented-radio')
                .children(
                  h.legend.class('sr-only').children('Text layout'),
                  h.label(
                    h.input.attrs({
                      type: 'radio',
                      name: 'layout',
                      value: 'paragraphs',
                      'aria-label': 'Flowing paragraphs',
                      checked: '',
                    }),
                    h.span(icon('notes'), 'Flow'),
                  ),
                  h.label(
                    h.input.attrs({
                      type: 'radio',
                      name: 'layout',
                      value: 'lines',
                      'aria-label': 'Source lines',
                    }),
                    h.span(icon('view_agenda'), 'Lines'),
                  ),
                ),
              h.label
                .class('switch-field interlinear-toggle')
                .children(
                  h.input.id('show-interlinear').attrs({type: 'checkbox', role: 'switch'}),
                  h.span('Interlinear'),
                ),
              h.div
                .class('reader-layer-field')
                .children(
                  h.label.class('reader-layer').attrs({for: 'reading-layer'}).children('Reading layer'),
                  h.select
                    .id('reading-layer')
                    .children(
                      h.option.attrs({value: 'corrected'}).children('Human-corrected'),
                      h.option.attrs({value: 'original'}).children('Original source'),
                      h.option.attrs({value: 'normalized'}).children('Normalized fallback'),
                    ),
                ),
            ),
          h.section
            .id('reader-source')
            .class('reader-source')
            .attrs({'aria-labelledby': 'reader-source-heading'})
            .children(
              h.h2.id('reader-source-heading').children('Source reference'),
              h.form
                .id('source-jump-form')
                .class('reader-input-group')
                .children(
                  h.label.class('sr-only').attrs({for: 'source-location'}).children('Go to source'),
                  h.input
                    .id('source-location')
                    .attrs({placeholder: 'Utterance or token ID', autocomplete: 'off', required: ''}),
                  h.button
                    .id('jump-source')
                    .attrs({type: 'submit', 'aria-label': 'Go', title: 'Go to source'})
                    .children(icon('arrow_forward')),
                ),
              h.div
                .class('reader-source-actions')
                .children(
                  h.button.id('copy-citation').class('reader-text-command').children(icon('link'), 'Copy link'),
                  h.button.id('native-problems').class('reader-text-command').children('Package checks'),
                ),
              h.p.id('source-location-status').attrs({role: 'status'}),
            ),
        ),
    ),
    h.div
      .class('reading-status')
      .children(
        h.button
          .id('find-in-transcript')
          .class('secondary')
          .attrs({
            'aria-label': 'Find in transcript',
            'aria-expanded': 'false',
            'aria-controls': 'reader-find',
            title: 'Find in transcript (Ctrl / ⌘ K)',
          })
          .children(icon('search'), h.span('Find')),
        h.button
          .id('open-reading-canvas')
          .class('secondary')
          .attrs({
            'aria-expanded': 'false',
            'aria-controls': 'tokens',
            'aria-label': 'Focus mode (Open reading canvas)',
            title: 'Focus mode',
          })
          .children(icon('center_focus_strong'), h.span('Focus mode')),
      ),
    h.section
      .id('reader-find')
      .attrs({'aria-label': 'Find in transcript', hidden: ''})
      .children(
        h.div
          .class('reader-input-group reader-query')
          .children(
            h.label.class('sr-only').attrs({for: 'token-query'}).children('Find tokens'),
            icon('search'),
            h.input
              .id('token-query')
              .attrs({type: 'search', autocomplete: 'off', placeholder: 'Find by reading, ID or variety'}),
          ),
        h.label.class('sr-only').attrs({for: 'token-filter'}).children('Token filter'),
        h.select
          .id('token-filter')
          .children(
            h.option.attrs({value: 'all'}).children('All tokens'),
            h.option.attrs({value: 'corrected'}).children('With corrections'),
            h.option.attrs({value: 'untimed'}).children('Without word timing'),
            h.option.attrs({value: 'attention'}).children('Needs attention'),
          ),
        h.div
          .class('reader-find-results')
          .children(
            h.span.id('reading-match-count').attrs({role: 'status', 'aria-atomic': 'true'}),
            h.button
              .id('next-match')
              .class('reader-text-command')
              .attrs({'aria-label': 'Next match', title: 'Next match (F3)', hidden: ''})
              .children(icon('skip_next')),
            h.button
              .id('clear-token-search')
              .class('reader-text-command')
              .attrs({'aria-label': 'Clear search and filters', title: 'Close find and clear filters'})
              .children(icon('close')),
          ),
      ),
    h.aside
      .id('reading-guide')
      .attrs({popover: '', 'aria-labelledby': 'reading-guide-title'})
      .children(
        h.div
          .class('reader-section-heading')
          .children(
            h.h2.id('reading-guide-title').children('Selection guide'),
            h.button
              .class('reader-text-command')
              .attrs({
                type: 'button',
                popovertarget: 'reading-guide',
                popovertargetaction: 'hide',
                'aria-label': 'Close selection guide',
              })
              .children(icon('close')),
          ),
        h.dl
          .id('selection-help')
          .children(
            h.dt('Select a passage'),
            h.dd(
              'Drag across words, or click the first word, choose ',
              h.strong('Select through'),
              ' and click the last word.',
            ),
            h.dt('Open selection tools'),
            h.dd('Tap the selected count, right-click, or press ', h.kbd('Shift'), ' + ', h.kbd('F10'), '.'),
            h.dt('Choose a training lens'),
            h.dd('Press and hold a word.'),
            h.dt('Clear the selection'),
            h.dd('Click away or press ', h.kbd('Esc'), '.'),
          ),
      ),
  );
}
