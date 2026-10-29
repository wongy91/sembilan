export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      rules.push({ pattern: new RegExp(`^${pattern}$`), headers: {} });
    } else {
      const at = line.indexOf(':');
      rules.at(-1).headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return rules;
}

export function headersFor(rules, path) {
  return Object.assign({}, ...rules.filter((rule) => rule.pattern.test(path)).map((rule) => rule.headers));
}
