// npm run samples → regenerates placeholder "photos" in public/samples.
// Scene images are simple SVG illustrations (no real photos). Meter images are
// rendered to PNG with the pre-installed Playwright Chromium so that, in Live AI
// mode, the vision model can genuinely read them. Run `npm run seed` first.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("public/samples");
fs.mkdirSync(path.join(dir, "meters"), { recursive: true });

const frame = (title: string, bg: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<rect width="400" height="300" fill="${bg}"/>${body}
<rect x="0" y="262" width="400" height="38" fill="rgba(15,23,42,.72)"/>
<text x="14" y="286" font-family="Arial, sans-serif" font-size="15" fill="#fff">${title}</text>
<text x="386" y="286" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#cbd5e1">SAMPLE IMAGE</text></svg>`;

const scenes: Record<string, string> = {
  "staircase.svg": frame("Staircase, after mopping", "#e2e8f0",
    Array.from({ length: 7 }, (_, i) => `<rect x="${40 + i * 45}" y="${220 - i * 28}" width="${360 - i * 45}" height="28" fill="${i % 2 ? "#cbd5e1" : "#94a3b8"}"/>`).join("") +
      `<rect x="20" y="40" width="8" height="200" fill="#475569"/><path d="M28 60 L340 20" stroke="#475569" stroke-width="6"/>`),
  "lift_lobby.svg": frame("Lift lobby and lift car", "#f1f5f9",
    `<rect x="120" y="40" width="160" height="210" fill="#94a3b8"/><rect x="128" y="50" width="70" height="200" fill="#cbd5e1"/><rect x="202" y="50" width="70" height="200" fill="#cbd5e1"/><circle cx="300" cy="140" r="8" fill="#16a34a"/><rect x="0" y="250" width="400" height="12" fill="#e7e5e4"/>`),
  "basement.svg": frame("Basement driveway swept", "#d6d3d1",
    `<rect x="0" y="40" width="400" height="20" fill="#78716c"/><rect x="60" y="60" width="16" height="200" fill="#a8a29e"/><rect x="320" y="60" width="16" height="200" fill="#a8a29e"/>${[0, 1, 2, 3].map((i) => `<rect x="${180}" y="${90 + i * 45}" width="40" height="8" fill="#facc15"/>`).join("")}`),
  "garbage.svg": frame("Garbage segregation point", "#ecfccb",
    `${[["#16a34a", "WET"], ["#2563eb", "DRY"], ["#dc2626", "REJECT"]].map(([c, l], i) => `<rect x="${50 + i * 110}" y="110" width="80" height="120" rx="8" fill="${c}"/><text x="${90 + i * 110}" y="180" text-anchor="middle" font-family="Arial" font-size="14" fill="#fff">${l}</text>`).join("")}`),
  "washroom.svg": frame("Clubhouse washroom", "#e0f2fe",
    `<rect x="40" y="60" width="140" height="90" rx="6" fill="#fff" stroke="#94a3b8"/><ellipse cx="110" cy="190" rx="60" ry="22" fill="#fff" stroke="#94a3b8"/><rect x="240" y="50" width="110" height="200" fill="#bae6fd"/>`),
  "patrol.svg": frame("Night patrol checkpoint 12", "#1e293b",
    `<circle cx="320" cy="60" r="22" fill="#fef9c3"/><rect x="150" y="110" width="100" height="120" rx="6" fill="#334155"/><rect x="175" y="135" width="50" height="50" fill="#0f172a"/><text x="200" y="166" text-anchor="middle" font-family="Arial" font-size="12" fill="#a3e635">CP-12</text>`),
  "dg_panel.svg": frame("DG set panel during test run", "#fef3c7",
    `<rect x="60" y="50" width="280" height="190" rx="10" fill="#57534e"/>${[0, 1, 2].map((i) => `<circle cx="${130 + i * 70}" cy="110" r="24" fill="#f5f5f4"/><line x1="${130 + i * 70}" y1="110" x2="${140 + i * 70}" y2="94" stroke="#dc2626" stroke-width="3"/>`).join("")}<rect x="100" y="170" width="200" height="40" fill="#14532d"/><text x="200" y="196" text-anchor="middle" font-family="monospace" font-size="16" fill="#86efac">RUN 00:30</text>`),
  "extinguisher.svg": frame("Fire extinguisher tag", "#fee2e2",
    `<rect x="170" y="60" width="60" height="180" rx="20" fill="#dc2626"/><rect x="185" y="40" width="30" height="24" fill="#334155"/><circle cx="200" cy="120" r="14" fill="#fff"/><path d="M200 120 L208 112" stroke="#16a34a" stroke-width="3"/>`),
  "stp_outlet.svg": frame("STP outlet sample (clear)", "#ecfeff",
    `<rect x="160" y="60" width="80" height="170" rx="6" fill="none" stroke="#0e7490" stroke-width="4"/><rect x="164" y="110" width="72" height="116" fill="#cffafe"/><text x="200" y="250" text-anchor="middle" font-family="Arial" font-size="12" fill="#0e7490">outlet</text>`),
  "garden.svg": frame("Central lawn", "#dcfce7",
    `<rect x="0" y="170" width="400" height="92" fill="#22c55e"/>${[60, 160, 280, 350].map((x, i) => `<circle cx="${x}" cy="${130 - (i % 2) * 15}" r="${30 + (i % 2) * 10}" fill="#15803d"/><rect x="${x - 5}" y="150" width="10" height="30" fill="#78350f"/>`).join("")}`),
  "pest_report.svg": frame("Pest control service report", "#f5f5f4",
    `<rect x="110" y="30" width="180" height="220" fill="#fff" stroke="#a8a29e"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="130" y="${60 + i * 28}" width="${140 - (i % 3) * 20}" height="8" fill="#d6d3d1"/>`).join("")}`),
  "tank.svg": frame("Overhead tank after cleaning", "#e0f2fe",
    `<rect x="90" y="70" width="220" height="160" rx="12" fill="#e5e7eb" stroke="#64748b" stroke-width="3"/><rect x="100" y="150" width="200" height="72" fill="#7dd3fc"/>`),
  "lift_issue.svg": frame("Tower B lift, stopped between floors", "#f8fafc",
    `<rect x="130" y="30" width="140" height="220" fill="#94a3b8"/><rect x="140" y="120" width="120" height="130" fill="#cbd5e1"/><rect x="140" y="30" width="120" height="70" fill="#64748b"/><text x="200" y="74" text-anchor="middle" font-family="monospace" font-size="20" fill="#fca5a5">7 ▲ ▼ 8</text>`),
  "odour_drain.svg": frame("Drain chamber near clubhouse", "#e7e5e4",
    `<rect x="120" y="120" width="160" height="110" fill="#57534e"/><rect x="130" y="130" width="140" height="90" fill="#44403c"/>${[0, 1, 2].map((i) => `<path d="M${170 + i * 30} 110 q10 -20 0 -40 q-10 -20 0 -40" stroke="#a3e635" stroke-width="3" fill="none"/>`).join("")}`),
  "generic.svg": frame("Site photo", "#f1f5f9", `<rect x="100" y="80" width="200" height="140" rx="8" fill="#cbd5e1"/>`),
};
for (const [file, svg] of Object.entries(scenes)) fs.writeFileSync(path.join(dir, file), svg);

function meterSvg(serial: string, unit: string, reading: number, opts: { blur?: boolean; smudge?: boolean } = {}) {
  const intPart = String(Math.floor(reading)).padStart(5, "0");
  const dec = String(Math.round((reading % 1) * 10) % 10);
  const digits = [...intPart].map((d, i) => `<rect x="${103 + i * 34}" y="140" width="30" height="44" fill="#111827"/><text x="${118 + i * 34}" y="174" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="30" fill="#f9fafb">${d}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" width="480" height="360">
<defs><filter id="b"><feGaussianBlur stdDeviation="2.6"/></filter></defs>
<rect width="480" height="360" fill="#9ca3af"/><rect x="0" y="250" width="480" height="110" fill="#6b7280"/>
<g ${opts.blur ? 'filter="url(#b)"' : ""}>
<circle cx="240" cy="170" r="150" fill="#1d4ed8"/><circle cx="240" cy="170" r="128" fill="#e5e7eb"/>
<text x="240" y="96" text-anchor="middle" font-family="Arial" font-size="16" fill="#1f2937">WATER METER  m³ (KL)</text>
${digits}<rect x="273" y="140" width="30" height="44" fill="#b91c1c"/><text x="288" y="174" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="30" fill="#fff">${dec}</text>
<text x="240" y="222" text-anchor="middle" font-family="Arial" font-size="17" fill="#111827">S/N ${serial}</text>
</g>
<rect x="330" y="282" width="128" height="56" rx="6" fill="#fde68a" stroke="#92400e"/>
<text x="394" y="318" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="24" fill="#111827">${unit}</text>
${opts.smudge ? '<ellipse cx="394" cy="310" rx="56" ry="24" fill="#78716c" opacity="0.85"/>' : ""}
<text x="12" y="350" font-family="Arial" font-size="11" fill="#e5e7eb">SAMPLE IMAGE – synthetic meter</text></svg>`;
}

fs.writeFileSync(path.join(dir, "meters", "meter_generic.svg"), meterSvg("WM-000000", "UNIT", 1234.5));

const labelsPath = path.join(dir, "meters", "labels.json");
if (!fs.existsSync(labelsPath)) {
  console.error("Run `npm run seed` first (it writes public/samples/meters/labels.json).");
  process.exit(1);
}
const labels: { file: string; serial: string; unit_label: string; reading: number; confidence: number }[] = JSON.parse(fs.readFileSync(labelsPath, "utf8"));

const { chromium } = await import("playwright" as string).catch(async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("playwright");
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
for (const l of labels) {
  const svg = meterSvg(l.serial, l.unit_label, l.reading, { blur: l.confidence < 0.7, smudge: l.unit_label.includes("?") });
  fs.writeFileSync(path.join(dir, "meters", l.file.replace(".png", ".svg")), svg);
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: path.join(dir, "meters", l.file), clip: { x: 0, y: 0, width: 480, height: 360 } });
}
await browser.close();
console.log(`Wrote ${Object.keys(scenes).length} scene images and ${labels.length} meter photos to public/samples`);
