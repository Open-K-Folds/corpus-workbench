# Google Material Symbols

Copyright Google LLC. Apache License 2.0; the complete license is in LICENSE.txt.
This is an official Google Fonts Material Symbols Outlined subset retrieved
2026-11-22. The upstream response is retained in source-css.txt as provenance;
it is not a runtime stylesheet. The font and application CSS are served locally.
No Google or third-party requests are made by the workbench.

Official guide: https://developers.google.com/fonts/docs/material_symbols
Upstream: https://github.com/google/material-design-icons

The 15,076-byte WOFF2 contains 53 named ligatures. The upstream font fixes
optical size at 20 and weight at 400. Its variable axes cover fill 0–1 and
grade -50–200. Workbench uses fill for selected controls, grade 0 in light
appearance and grade -25 in dark appearance. Each name in `ui/src/icons.ts`
shapes to one distinct glyph in all four combinations. Decorative glyphs are
hidden from the accessibility tree. Icon-only controls supply an accessible name.

Subset SHA-256: b9c0219c0faec1f4ab2eb9cc710458967c5626d1c5e267486921139a8c66a618
Google Fonts API response version: v385.

Reproduction URL (development asset retrieval only):
https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0..1,-25..0&icon_names=add,adjust,arrow_back,arrow_forward,attach_file,auto_awesome,book_2,center_focus_strong,chat,check,chevron_right,close,dark_mode,description,dock_to_right,download,edit_note,expand_less,expand_more,fact_check,folder_open,forum,fullscreen,graphic_eq,headphones,history,keyboard,left_panel_close,left_panel_open,library_books,light_mode,link,menu_book,mic,more_horiz,north,notes,orbit,pause,play_arrow,radio_button_checked,remove,repeat,search,settings,skip_next,stop_circle,tune,unfold_more,view_agenda,view_sidebar,volume_off,volume_up&display=block

Request with a modern Chrome user agent to receive WOFF2. Before replacing the
asset, verify its wOF2 signature, update the digest and response version here,
and inspect all glyphs in both appearances. Keep the source response and license
in the built UI and preview package. The subset lives in
ui/src/assets/material-symbols-subset.woff2 in corresponding source.
