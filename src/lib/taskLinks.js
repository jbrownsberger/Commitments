const TYPES = new Set(['web', 'email', 'shortcut']);

export const LINK_TYPES = [
  { value: 'web', label: 'Webpage' },
  { value: 'email', label: 'Email' },
  { value: 'shortcut', label: 'Mac Shortcut' },
];

export function normaliseTaskLink(link) {
  const type = TYPES.has(link?.type) ? link.type : 'web';
  let value = String(link?.value || '').trim();
  const label = String(link?.label || '').trim();
  if (!value) return null;

  if (type === 'web') {
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      value = url.href;
    } catch {
      return null;
    }
  } else if (type === 'email') {
    if (/^mailto:/i.test(value)) value = value.slice(7);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  } else if (/^shortcuts:\/\/run-shortcut/i.test(value)) {
    const name = value.match(/[?&]name=([^&]*)/i)?.[1];
    try {
      value = name ? decodeURIComponent(name) : '';
    } catch {
      return null;
    }
    if (!value) return null;
  }

  return { type, label: label || defaultLinkLabel(type, value), value };
}

export function taskLinkHref(link) {
  const clean = normaliseTaskLink(link);
  if (!clean) return null;
  if (clean.type === 'email') return `mailto:${clean.value}`;
  if (clean.type === 'shortcut') return `shortcuts://run-shortcut?name=${encodeURIComponent(clean.value)}`;
  return clean.value;
}

export function defaultLinkLabel(type, value) {
  if (type === 'shortcut') return value;
  if (type === 'email') return value;
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
}

export function normaliseTaskLinks(links) {
  return Array.isArray(links) ? links.map(normaliseTaskLink).filter(Boolean) : [];
}
