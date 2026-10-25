// Runs before first paint so the saved theme never flashes. A file, not an
// inline script, so the served dashboard can keep a strict script-src 'self'.
try {
  var theme = localStorage.getItem('allowance-theme') || 'light';
  document.documentElement.dataset.theme = theme;
  var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121411' : '#1B4D3E');
} catch (e) {}
