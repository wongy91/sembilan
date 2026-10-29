export function tokenize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 || /\p{Script=Han}/u.test(t));
}

export function scrub(text) {
  return String(text ?? '')
    .replace(/https?:\/\/[^\s)'"]+/g, (url) => {
      try {
        const { origin, pathname } = new URL(url);
        return origin + pathname;
      } catch {
        return '[url]';
      }
    })
    .replace(/\d+(?:\.\d+)+/g, '#')
    .slice(0, 600);
}
