// Runs before anything else. GitHub Pages can't send a frame-ancestors / X-Frame-Options header,
// so the page stays hidden (see app.css) unless it is the top window. That stops another site
// from framing it and tricking someone into clicking "Save form" or "Clear all data".
if (window.top === window.self) {
  document.documentElement.setAttribute('data-ready', '');
} else {
  try {
    window.top.location.replace(window.location.href);
  } catch {
    /* cross-origin parent: the page just stays hidden */
  }
}
