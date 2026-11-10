/** Versions as apps write them, part by part, numbers as numbers: 1.10 is after 1.9. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[^0-9A-Za-z]+/);
  const pb = String(b).split(/[^0-9A-Za-z]+/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const c = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (c) return Math.sign(c);
  }
  return 0;
}
