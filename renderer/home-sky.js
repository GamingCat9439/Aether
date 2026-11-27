'use strict';

(() => {
  let timer;
  function syncSky() {
    window.clearTimeout(timer);
    const now = new Date();
    const hour = now.getHours();
    const day = hour >= 6 && hour < 18;
    document.documentElement.dataset.sky = day ? 'day' : 'night';

    if (document.hidden) return;
    const next = new Date(now);
    if (hour >= 18) next.setDate(next.getDate() + 1);
    next.setHours(day ? 18 : 6, 0, 0, 0);
    timer = window.setTimeout(syncSky, next.getTime() - now.getTime());
  }
  syncSky();
  window.addEventListener('focus', syncSky);
  document.addEventListener('visibilitychange', syncSky);
})();
