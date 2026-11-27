'use strict';

(() => {
  // Earlier Aether renderers write to this counter. The refreshed renderer
  // implements these controls itself, so it can leave the adapter dormant.
  const legacyCounter = document.getElementById('homeClientCount');
  const startup = new MutationObserver(() => {
    startup.disconnect();
    bindWorkspaceControls();
  });
  startup.observe(legacyCounter, { childList: true });

  function bindWorkspaceControls() {
    const byId = (id) => document.getElementById(id);
    const tabs = byId('docTabs');
    const libraryCount = byId('libraryBadge');
    const focusButton = byId('editorFocus');
    const recent = byId('homeRecent');
    const clients = byId('homeClientsList');

    function updateSummary() {
      const open = tabs.querySelectorAll('[data-doc-index]:not(.leaving)').length;
      const saved = Number(libraryCount.textContent) || 0;
      byId('homeSummary').textContent =
        `${open} open tab${open === 1 ? '' : 's'} · ${saved} saved script${saved === 1 ? '' : 's'}`;
    }

    const counts = new MutationObserver(updateSummary);
    counts.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-doc-index', 'class'] });
    counts.observe(libraryCount, { childList: true, characterData: true, subtree: true });
    updateSummary();

    function updateRecent() {
      const empty = recent.querySelector('.empty-block');
      if (empty) {
        empty.querySelector('div > span').textContent = 'Press Ctrl+S in the editor to add your first script.';
        empty.querySelector('button')?.remove();
      }
      for (const label of recent.querySelectorAll('.recent-meta')) {
        label.textContent = label.textContent.replace(/\b1 lines\b/g, '1 line');
      }
    }
    new MutationObserver(updateRecent).observe(recent, { childList: true });
    updateRecent();

    function showClientList() {
      clients.hidden = !clients.querySelector('.client-mini-row');
    }
    new MutationObserver(showClientList).observe(clients, { childList: true });
    showClientList();

    byId('homeOpenFile').addEventListener('click', () => byId('fileInput').click());
    for (const link of document.querySelectorAll('[data-scripts-view]')) {
      link.addEventListener('click', () => {
        byId('scriptsTabs').querySelector(`[data-view="${link.dataset.scriptsView}"]`).click();
      });
    }

    function setFocusMode(enabled) {
      focusButton.setAttribute('aria-pressed', String(enabled));
      focusButton.title = enabled ? 'Restore workspace panels (Esc)' : 'Hide the explorer and console';
      (enabled ? byId('code') : focusButton).focus({ preventScroll: true });
    }
    focusButton.addEventListener('click', () => setFocusMode(focusButton.getAttribute('aria-pressed') !== 'true'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && byId('inlineCompletionHint').hidden && focusButton.getAttribute('aria-pressed') === 'true' &&
          byId('page-editor').classList.contains('active') &&
          byId('modalRoot').hidden && byId('clientsPopover').hidden) {
        setFocusMode(false);
      }
    }, true);

    for (const [id, attribute, activeValue] of [
      ['nav', 'aria-current', 'page'],
      ['settingsNav', 'aria-current', 'true'],
      ['scriptsTabs', 'aria-pressed', 'true'],
    ]) {
      const group = byId(id);
      function syncSelection() {
        for (const button of group.querySelectorAll('button')) {
          if (button.classList.contains('active')) button.setAttribute(attribute, activeValue);
          else if (attribute === 'aria-pressed') button.setAttribute(attribute, 'false');
          else button.removeAttribute(attribute);
        }
      }
      new MutationObserver(syncSelection).observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
      syncSelection();
    }

    for (const group of [byId('themeGrid'), byId('accentRow')]) {
      group.addEventListener('click', (event) => {
        if (event.target.closest('button')) group.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
    }
  }
})();
