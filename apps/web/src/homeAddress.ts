/** An address on a home network: a private IP, this computer, or a local name (nas.local, a name without a dot). */
export function homeAddress(value: string): boolean {
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === 'localhost' || !host.includes('.') || /\.(local|lan|home|home\.arpa|internal)$/.test(host)) return true;
  const ip = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!ip) return host.startsWith('[') && /^\[(::1|f[cd]|fe80)/.test(host);
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
