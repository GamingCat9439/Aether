/* The two transparent textures move in CSS. Only lifecycle events touch JS. */
(() => {
  const layer = document.getElementById('fluxWallpaper');
  const toggle = document.getElementById('toggleFluxWallpaper');
  const preference = 'aether.appearance.fluxWallpaper';
  let enabled = true;
  try { enabled = localStorage.getItem(preference) !== 'off'; } catch { /* Session only. */ }

  function update() {
    layer.hidden = !enabled;
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.classList.toggle('on', enabled);
    layer.classList.toggle('is-resting', document.hidden || !document.hasFocus());
  }

  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(preference, enabled ? 'on' : 'off'); } catch { /* Session only. */ }
    update();
  });
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  update();
})();
