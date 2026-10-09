/** Arrow keys complement Tab/Space on a small mutually exclusive button group. */
export function buttonGroup(group:HTMLElement){
  group.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    const buttons=[...group.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.disabled);
    const current=buttons.indexOf(event.target as HTMLButtonElement);
    if(current<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
    buttons[next].focus();buttons[next].click();
  });
}

/** Keep overflow native; show subtle scroll thumbs during activity and focus. */
export function scrollIndicators(root:HTMLElement){
  const timers=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
  root.addEventListener('scroll',event=>{
    const pane=event.target as HTMLElement;
    if(!(pane instanceof HTMLElement))return;
    pane.classList.add('is-scrolling');clearTimeout(timers.get(pane));
    timers.set(pane,setTimeout(()=>pane.classList.remove('is-scrolling'),900));
  },true);
}
