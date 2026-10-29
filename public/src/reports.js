export const REPORT_KINDS = ['accident', 'police', 'hazard', 'jam', 'closure', 'flood', 'pothole'];
export const REPORT_ICON = { accident: '💥', police: '👮', hazard: '⚠️', jam: '🚗', closure: '⛔', flood: '🌊', pothole: '🕳️' };

async function send(path, init) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

export async function health() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return { traffic: false, reports: false, fares: false };
    const data = await res.json();
    return { traffic: !!data.traffic, reports: !!data.reports, fares: !!data.fares };
  } catch {
    return { traffic: false, reports: false, fares: false };
  }
}

export async function fetchReports([minLon, minLat, maxLon, maxLat]) {
  const bbox = [minLon, minLat, maxLon, maxLat].map((n) => n.toFixed(4)).join(',');
  return (await send(`/api/reports?bbox=${bbox}`)).reports || [];
}

export function postReport(report) {
  return send('/api/reports', { method: 'POST', body: JSON.stringify(report) });
}

export function voteReport(id, up) {
  return send(`/api/reports/${id}/vote`, { method: 'POST', body: JSON.stringify({ up }) });
}
