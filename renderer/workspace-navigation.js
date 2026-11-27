'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('modalRoot');
  const search = byId('findLibrary');
  const libraryInput = byId('librarySearch');
  const libraryLink = document.querySelector('[data-scripts-view="library"]');

  function findScripts() {
    if (!dialog.hidden) return;
    libraryLink.click();
    libraryInput.focus();
    libraryInput.select();
  }
  search.addEventListener('click', findScripts);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
        !event.isComposing && event.key.toLowerCase() === 'k' && dialog.hidden) {
      event.preventDefault();
      findScripts();
    }
  });

  // The existing renderer owns dismissal and edits. Keep focus within its active dialog.
  let opener = null;
  let opened = false;
  const background = [...dialog.parentElement.children].filter((node) => node !== dialog);
  const previouslyInteractive = new Set();
  new MutationObserver(() => {
    if (!dialog.hidden) {
      const heading = dialog.querySelector('h2');
      if (heading) {
        heading.id = 'aetherDialogTitle';
        dialog.setAttribute('aria-labelledby', heading.id);
      }
      if (!opened) {
        opened = true;
        opener = document.activeElement;
        for (const node of background) {
          if (!node.inert) {
            node.inert = true;
            previouslyInteractive.add(node);
          }
        }
      }
    } else if (opened) {
      opened = false;
      for (const node of previouslyInteractive) node.inert = false;
      previouslyInteractive.clear();
      if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      else document.querySelector('#nav .active')?.focus({ preventScroll: true });
      opener = null;
    }
  }).observe(dialog, { childList: true, attributes: true, attributeFilter: ['hidden'] });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return;
    // Keep workspace shortcuts from firing behind the dialog.
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const targets = [...dialog.querySelectorAll('button:enabled, input:enabled, select:enabled, textarea:enabled, a[href], [tabindex="0"]')]
      .filter((node) => node.getClientRects().length);
    if (!targets.length) return;
    const first = targets[0], last = targets[targets.length - 1];
    if (event.shiftKey && (document.activeElement === first || !targets.includes(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
