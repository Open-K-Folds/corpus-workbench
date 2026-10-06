// Official self-hosted Google Material Symbols subset; see assets/README.md.
export const symbols = ['dark_mode','description','download','expand_less','expand_more','fact_check','folder_open','graphic_eq','headphones','history','light_mode','link','notes','pause','play_arrow','repeat','search','skip_next','tune','unfold_more','view_agenda','view_sidebar','volume_off','volume_up'] as const;
export type SymbolName = typeof symbols[number];
export function icon(name:SymbolName){return `<span class="material-symbol" aria-hidden="true">${name}</span>`}
