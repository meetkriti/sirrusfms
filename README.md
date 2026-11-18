# Paradigm Services · Operations Intelligence Prototype (by Sirrus.ai)

A clickable, working prototype that shows how one residential project's WhatsApp and email
operations can become structured, trackable data: checklists, reminders and alerts, tickets
with escalation, meter readings, billing inputs, patterns, a plain-English assistant and a
client report.

> **Prototype on synthetic data.** "Lakeshore Greens" (Bengaluru, 4 towers, 384 units), its
> association, every person, phone number, rate and message are fictional. WhatsApp and the
> email inbox are simulated. See [LIMITATIONS.md](LIMITATIONS.md).

## Run it

Requires Node.js 20+.

```bash
npm install && npm run seed && npm run dev
```

Open http://localhost:5173. Click **Start demo** in the top bar for the guided 10-step walkthrough.

| Command | What it does |
|---|---|
| `npm run seed` | Writes 90 days of deterministic sample data ending today to `public/data/` (seed.json, whatsapp_export.txt, emails.json) and the meter photo labels. `SEED_TODAY=2026-11-16 npm run seed` pins the date. |
| `npm run samples` | Regenerates the placeholder images in `public/samples/` (meter photos are rendered to PNG with Playwright's Chromium). Already committed; only needed after changing the seed. |
| `npm run dev` | Vite dev server, including the local AI proxy at `/api/ai`. |
| `npm run smoke` | Headless checks of the acceptance criteria against the engine (Mock mode). |
| `npm run build` / `npm run preview` | Type-check and production build / serve the build (the AI proxy also runs in preview). |

The demo state survives a browser refresh (saved in IndexedDB). Use **↺** in the top bar to reset to
the seeded state (sim clock 07:00 today).

## Mock and Live AI

Every AI feature works offline in **Mock** mode (deterministic rules and pre-labelled results for the
sample images), so the demo cannot fail on stage. To use Claude:

```bash
cp .env.example .env
```

Then set `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`, default `claude-opus-5-5`) in `.env`,
restart `npm run dev`, and switch **AI: Mock / Live** in the top bar. The key stays on the server
(the Vite middleware in `server/aiMiddleware.ts`); the browser only talks to `/api/ai/*`.

In Live mode:

| Feature | What Claude does | Guardrails |
|---|---|---|
| Complaint classification (M4) | category, priority, location | strict JSON schema, Zod validation, editable by a human |
| Reply understanding (M1) | fallback when the rule parser cannot read a reply | used only for low-confidence / unknown replies |
| Message intelligence (M5) | extracts events from WhatsApp threads and emails | schema-validated, retried once, then routed to the review queue; mapping to records is done in code |
| Meter photos (M6) | reads serial, unit label and reading (vision) | readings < 0.80 confidence go to review; matching and validation in code |
| Ask Paradigm (M7) | tool use over the data layer (7 tools) | answers only from tool results; "not available in the data" otherwise |
| Insight wording (M9) | rewords computed findings | rejected if it introduces any number that is not in the computation |

Requests use server-side refusal fallbacks (`fallbacks: "default"`). Every call, mock or live, is
logged on the **AI audit** page (input hash, output, confidence, latency). Prompts live in
[`/prompts`](prompts) so they can be tuned without code changes.

## What is where

| Page | Module |
|---|---|
| Right-hand phone panel | M1 WhatsApp workflow simulator (personas, buttons, Hinglish, photos, stepwise checklists) |
| Dashboard, Tasks | M2 Operations dashboard (KPI tiles, heatmap, today's board, service lines, attendance, evidence) |
| Alerts, Settings → Alert rules | M3 Reminders and alerts engine |
| Tickets, ticket detail | M4 Issue and escalation workflow (SLA, L1→L4, client closure loop) |
| Messages | M5 Message intelligence (import, before/after, review queue, drag-and-drop) |
| Meters | M6 Meter reading automation (grid, validation, review, configurable export) |
| Ask Paradigm | M7 Chat over project data |
| Billing | M8 Billing data capture (security man-days, consumables, quotations, XLSX invoice draft) |
| Insights | M9 Pattern analysis |
| Client Report | M10 Monthly service report (print / save as PDF) |
| Discovery: to confirm | Open questions for Paradigm |
| AI audit | Log of every AI call |

## Configuration

All assumptions are in [`/config`](config) and most are editable live on the Settings page:
`hierarchy.json`, `alert_rules.json`, `sla_matrix.json`, `checklist_templates.json`,
`meter_export_format.json`, `billing_rules.json`.

## Docs

- [DEMO.md](DEMO.md): the 10-minute demo script
- [ARCHITECTURE.md](ARCHITECTURE.md): modules, data flow, WhatsApp Cloud API swap path, scaling to ~100 projects
- [LIMITATIONS.md](LIMITATIONS.md): what is simulated and what production needs
