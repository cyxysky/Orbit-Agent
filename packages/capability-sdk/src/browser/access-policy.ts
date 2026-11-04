/** Domain rules are host names or URLs; *.example.com matches subdomains only. */
export function normalizeBrowserDomainRules(value: string) {
  return [...new Set(value.split(/[\s,;]+/u).filter(Boolean).map(rule => {
    const wildcard = rule.startsWith('*.');
    const source = wildcard ? rule.slice(2) : rule;
    try {
      const url = new URL(source.includes('://') ? source : `https://${source}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || !url.hostname || url.hostname.includes('*')) throw new Error();
      return `${wildcard ? '*.' : ''}${url.hostname.toLowerCase().replace(/\.$/u, '')}`;
    } catch { throw new Error(`浏览器名单中的域名无效：${rule}`); }
  }))].join('\n');
}

export function browserNavigationAllowed(urlValue: string, env: Record<string, string | undefined> = process.env) {
  const allow = normalizeBrowserDomainRules(env.BROWSER_DOMAIN_ALLOWLIST || '').split('\n').filter(Boolean);
  const deny = normalizeBrowserDomainRules(env.BROWSER_DOMAIN_DENYLIST || '').split('\n').filter(Boolean);
  if (!allow.length && !deny.length) return true;
  let url: URL;
  try { url = new URL(urlValue); } catch { return false; }
  if (url.protocol === 'about:') return url.href === 'about:blank';
  // Local documents and inline documents do not have a remote site identity.
  if (!['http:', 'https:'].includes(url.protocol)) return !allow.length;
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  const matches = (rule: string) => rule.startsWith('*.') ? host.endsWith(rule.slice(1)) : host === rule;
  return !deny.some(matches) && (!allow.length || allow.some(matches));
}
