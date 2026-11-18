# Architecture

## Overview

```
 WhatsApp (simulated phone)        Existing group export / emails
          │ Cloud-API-shaped webhook          │ .txt / .eml / .json
          ▼                                   ▼
  MessagingAdapter ──► Bot (engine/bot.ts)   Extraction pipeline (engine/extract.ts)
          ▲                │                   parse → thread → candidates → map → apply
          │                ▼                          │ (Mock rules | Claude, JSON schema)
  Scheduler / sim clock ─► Records (tasks, tickets, alerts, attendance, meters, consumables …)
  (engine/sim.ts)          │
                           ├─► Rule engine (alerts.ts, tasks.ts) and SLA escalation (tickets.ts)
                           ├─► Metrics, billing, patterns (metrics.ts, billing.ts, patterns.ts)  ← all numbers
                           └─► Ask tools (ask.ts) ─► Mock router | Claude tool use
  React UI (src/pages) reads the records; the AI proxy (server/aiMiddleware.ts) holds the API key.
```

| Layer | Files | Notes |
|---|---|---|
| Data model | `src/types.ts` | Every record has `id, project_id, created_at, updated_at, source`. |
| Seed | `src/engine/generate.ts`, `seedMessages.ts`, `scripts/seed.ts` | Fixed random seed; 90 days; plants the patterns; runs the live engine from 00:00 to 07:00 today. |
| Messaging | `src/engine/messaging.ts` | `MessagingAdapter { sendMessage, sendInteractive, onInboundMessage }`; payloads mirror the WhatsApp Cloud API. Only `SimulatedAdapter` ships. |
| Bot | `src/engine/bot.ts`, `nlp.ts` | Prompts, buttons, numbered/Hinglish replies, photo capture, stepwise checklists with range validation, complaint intake, closure loop. |
| Scheduler | `src/engine/sim.ts` | Minute-by-minute: send prompts, simulated staff replies, R1/R2/R3, shift-start headcount (R5), ticket SLA/escalation, day roll-over. |
| Rules | `config/*.json` → `src/config.ts` | Live-editable copy; Settings page mutates it. |
| AI | `src/ai/client.ts`, `server/aiMiddleware.ts`, `prompts/*.md` | Mock/Live per call, Zod validation, one retry, review routing, audit log. |
| UI | `src/pages`, `src/components` | React + Tailwind, Recharts, SheetJS. State in a Zustand store; persisted to IndexedDB. |

**Design rule:** the LLM reads, classifies, extracts and words. Every figure on a dashboard, report,
insight or invoice is computed in code from records (`metrics.ts`, `billing.ts`, `patterns.ts`).

## Why the engine runs in the browser (prototype only)

To make the demo offline-safe and a single command, the engine and data store run client-side and
the only server code is the AI proxy. The engine has no browser dependencies (the seed script and
`npm run smoke` run it in Node), so it moves to a backend unchanged.

## Swap path: simulator → WhatsApp Cloud API

1. **Outbound.** Implement `CloudApiAdapter implements MessagingAdapter` that POSTs the same payloads
   (`OutboundText`, `OutboundInteractive`, `OutboundImage`) to `https://graph.facebook.com/<ver>/<PHONE_NUMBER_ID>/messages`.
   Prompts sent outside the 24-hour customer-service window must use **pre-approved message templates**
   (e.g. `checklist_due`, `reminder`, `ticket_update`); the bot's texts map 1:1 to template parameters.
2. **Inbound.** Expose `POST /webhooks/whatsapp` (verify token + `X-Hub-Signature-256`), and pass
   the body, already in `InboundWebhook` shape, to `handleInbound`. Download media via the media
   ID into object storage and store the URL as the photo.
3. **Identity.** Map `wa_id` to staff via the staff master (already done by phone number in `parseWebhook`).
4. **Scheduler.** Replace the sim clock with a real job queue (e.g. a cron tick per minute or delayed
   jobs per task `send_at` / `due_at`) calling the same `tickMinute` logic per project.
5. **Group chats.** The Cloud API does not read existing WhatsApp groups. M5 works on exported chats
   (or a supervised forwarder number) with members' consent; the pipeline is unchanged.

## From one project to ~100

| Concern | Change |
|---|---|
| Storage | Move from JSON/IndexedDB to Postgres; `project_id` is already on every record. Add indexes on `(project_id, date)`, `(project_id, status)`. |
| Config | Per-project overrides of templates, SLA and billing rules layered on organisation defaults. |
| Hierarchy | Zone → projects mapping; L3/L4 dashboards aggregate across projects (roll-up of the same metric functions). |
| Scheduler | One worker processing due events across projects; idempotent task generation per project/day. |
| Messaging | One WhatsApp Business number (or one per city) with project routing by staff phone. |
| Auth | Real login and role-based access (FM sees own projects, Zonal sees zone, Ops Head sees all; client sees read-only report). |
| AI cost | Batch extraction, prompt caching on the static system prompts, Mock rules first and LLM only for low-confidence items. |
| Exports | Billing export adapters per billing software, configured once per organisation. |
