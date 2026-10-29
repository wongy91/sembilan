import { scrub } from './text.js';
import { BUILD, RELEASE } from './version.js';

const MAX_REPORTS = 5;
const sent = new Set();

export function reportError(error) {
  if (error?.name === 'AbortError') return;
  const message = scrub(error?.message || error);
  if (!message || sent.has(message) || sent.size >= MAX_REPORTS) return;
  sent.add(message);
  const body = JSON.stringify({
    message,
    stack: scrub(String(error?.stack || '').split('\n').slice(0, 6).join('\n')),
    release: RELEASE,
    build: BUILD,
    mode: document.body?.dataset.mode || '',
  });
  try {
    if (!navigator.sendBeacon?.('/api/log', body)) fetch('/api/log', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {}
}

addEventListener('error', (e) => reportError(e.error || e.message));
addEventListener('unhandledrejection', (e) => reportError(e.reason));
