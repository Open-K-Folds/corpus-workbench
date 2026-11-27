import {h} from './effect-view';
// Self-hosted Google Material Symbols. The subset and license are documented in assets/README.md.
export const symbols = [
  'add', 'adjust', 'arrow_back', 'arrow_forward', 'attach_file',
  'auto_awesome', 'book_2', 'center_focus_strong', 'chat', 'check',
  'chevron_right', 'close', 'dark_mode', 'description', 'dock_to_right',
  'download', 'edit_note', 'expand_less', 'expand_more', 'fact_check',
  'folder_open', 'forum', 'fullscreen', 'graphic_eq', 'headphones',
  'history', 'keyboard', 'left_panel_close', 'left_panel_open', 'library_books',
  'light_mode', 'link', 'menu_book', 'mic', 'more_horiz',
  'north', 'notes', 'orbit', 'pause', 'play_arrow',
  'radio_button_checked', 'remove', 'repeat', 'search', 'settings',
  'skip_next', 'stop_circle', 'tune', 'unfold_more', 'view_agenda',
  'view_sidebar', 'volume_off', 'volume_up',
] as const;
export type SymbolName = typeof symbols[number];
export function icon(name: SymbolName) {
  return h.span.class('material-symbol').attrs({'aria-hidden': 'true'}).children(name);
}
