// GOES-R ABI fixed-grid projection: geodetic lat/lon → scan angles (x, y)
// → pixel position in an image that spans a known scan-angle window
// (GOES-R Product User Guide, Vol. 3, §4.2.8). Used to drop story pins onto
// the CONUS imagery. `p` = { satLon, x0, x1, y0, y1, width, height }, the
// window's left/right x and top/bottom y in radians (from /api/satellite).

const REQ = 6378137.0;
const RPOL = 6356752.31414;
const H = 35786023.0 + REQ;
const E2 = (REQ * REQ - RPOL * RPOL) / (REQ * REQ);

export function goesProject(lat, lon, p) {
  if (!p || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const lam0 = (p.satLon * Math.PI) / 180;
  const phiC = Math.atan(((RPOL * RPOL) / (REQ * REQ)) * Math.tan(phi));
  const rc = RPOL / Math.sqrt(1 - E2 * Math.cos(phiC) ** 2);
  const sx = H - rc * Math.cos(phiC) * Math.cos(lam - lam0);
  const sy = -rc * Math.cos(phiC) * Math.sin(lam - lam0);
  const sz = rc * Math.sin(phiC);
  // Behind the limb as seen from the satellite.
  if (H * (H - sx) < sy * sy + ((REQ * REQ) / (RPOL * RPOL)) * sz * sz) return null;
  const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz));
  const y = Math.atan(sz / sx);
  const px = ((x - p.x0) / (p.x1 - p.x0)) * p.width;
  const py = ((y - p.y0) / (p.y1 - p.y0)) * p.height;
  if (px < -40 || py < -40 || px > p.width + 40 || py > p.height + 40) return null;
  return { x: px, y: py };
}
