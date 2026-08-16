/** Pick light or dark text from a card's computed background. */

const LIGHT = '#FFFDF8';
const DARK = '#1C1B19';
const SELECTOR = '.sidebar-card, .agenda-unsch, .agenda-unsch-card';

function parseRgb(bg) {
  const m = String(bg || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function relativeLuminance([r, g, b]) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function apply(el) {
  const rgb = parseRgb(getComputedStyle(el).backgroundColor);
  if (!rgb) return;
  const darkBg = relativeLuminance(rgb) < 0.45;
  el.dataset.contrast = darkBg ? 'light' : 'dark';
  el.style.color = darkBg ? LIGHT : DARK;
}

function scan() {
  document.querySelectorAll(SELECTOR).forEach(apply);
}

export function initTaskContrast() {
  if (typeof document === 'undefined') return;
  const run = () => {
    if (document.body) scan();
  };
  const obs = new MutationObserver(run);
  const start = () => {
    run();
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
