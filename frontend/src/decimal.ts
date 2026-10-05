/** Exact decimal arithmetic on quantity strings with at most 6 decimal places (never floating point). */
export const scaled = (v: string): bigint => {
  const [i, f = ''] = v.split('.');
  return BigInt(i + f.padEnd(6, '0').slice(0, 6));
};
export const unscaled = (n: bigint): string => {
  const s = (n < 0n ? -n : n).toString().padStart(7, '0');
  const out = `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, '');
  return n < 0n ? `-${out}` : out;
};
