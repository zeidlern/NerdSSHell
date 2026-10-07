'use strict';
// Shared real-renderer checks; only synthetic notes in disposable fixtures.
async function scratchpadWrapSmoke({ evaluate, wait, check, screenshot }) {
  const note = '$value = "' + 'long note with spaces '.repeat(30) + '"\n\t' + 'x'.repeat(160) + '  \n';
  await evaluate(`(() => { const e=$('scratchText'); e.value=${JSON.stringify(note)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.setSelectionRange(9,25,'backward'); return true; })()`);
  await wait(`$('scratchText').dataset.highlight==='current'`, 'Wrap fixture highlighting did not settle.');
  check('Scratchpad starts with wrapping off and long lines scroll horizontally', await evaluate(`$('scratchWrap').getAttribute('aria-pressed')==='false' && $('scratchText').wrap==='off' && $('scratchText').scrollWidth>$('scratchText').clientWidth`));
  await evaluate(`$('scratchText').scrollLeft=100; $('scratchWrap').click(); true`);
  check('Word wrap contains prose and long tokens without changing text or selection', await evaluate(`(() => { const e=$('scratchText'),m=$('scratchHighlight'); return $('scratchWrap').getAttribute('aria-pressed')==='true' && e.wrap==='soft' && e.value===${JSON.stringify(note)} && e.selectionStart===9 && e.selectionEnd===25 && e.selectionDirection==='backward' && document.activeElement===e && e.scrollLeft===0 && e.scrollWidth===e.clientWidth && m.scrollWidth===m.clientWidth && e.clientWidth===m.clientWidth && Math.abs(e.scrollHeight-m.scrollHeight)<2; })()`));
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await screenshot('scratchpad-wrap');
  await evaluate(`$('scratchGrip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})); true`);
  check('Wrapped highlight and native editor stay aligned after resizing and scrolling', await evaluate(`(() => { const e=$('scratchText'),m=$('scratchHighlight'); e.scrollTop=80; e.dispatchEvent(new Event('scroll')); return e.scrollWidth===e.clientWidth && m.clientWidth===e.clientWidth && Math.abs(e.scrollHeight-m.scrollHeight)<2 && e.scrollTop===m.scrollTop; })()`));
  await evaluate(`$('scratchCollapse').click(); $('scratchpadToggle').click(); true`);
  check('Collapsing and reopening preserves word wrap and the exact note', await evaluate(`$('scratchWrap').getAttribute('aria-pressed')==='true' && $('scratchText').value===${JSON.stringify(note)}`));
  await evaluate(`$('scratchMode').value='plain'; $('scratchMode').dispatchEvent(new Event('change')); true`);
  check('Plain text wraps with the syntax overlay hidden', await evaluate(`$('scratchHighlight').hidden && $('scratchText').dataset.highlight==='plain' && $('scratchText').scrollWidth===$('scratchText').clientWidth`));
  await evaluate(`$('scratchWrap').click(); true`);
  check('Turning wrapping off restores horizontal scrolling and preserves literal newlines', await evaluate(`$('scratchText').wrap==='off' && $('scratchWrap').getAttribute('aria-pressed')==='false' && $('scratchText').scrollWidth>$('scratchText').clientWidth && $('scratchText').value===${JSON.stringify(note)}`));
  await evaluate(`$('scratchMode').value='auto'; $('scratchMode').dispatchEvent(new Event('change')); true`);
}
module.exports = { scratchpadWrapSmoke };
