const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "net.uk",
  "sch.uk",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "net.nz",
  "co.za",
  "org.za",
  "co.in",
  "org.in",
  "net.in",
  "gov.in",
  "co.kr",
  "or.kr",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "org.mx",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.tw",
  "org.tw",
  "com.sg",
  "org.sg",
  "co.id",
  "or.id",
  "co.th",
  "or.th",
  "com.hk",
  "org.hk",
]);

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// Not backed by the full public suffix list — covers the common multi-part
// TLDs so that SSO subdomains (e.g. accounts.example.co.uk vs
// app.example.co.uk) resolve to the same registrable domain. Uncommon or
// newly registered multi-part TLDs will fall back to a two-label split.
export function getRegistrableDomain(hostname: string): string {
  if (hostname === "localhost" || IPV4_PATTERN.test(hostname) || hostname.includes(":")) {
    return hostname;
  }

  const labels = hostname.split(".");
  if (labels.length <= 2) {
    return hostname;
  }

  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }

  return lastTwo;
}
