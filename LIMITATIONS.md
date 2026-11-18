# Limitations: what is simulated, and what production needs

## Simulated or assumed in this prototype

| Area | In the prototype | Production needs |
|---|---|---|
| WhatsApp | An in-app phone lookalike (`SimulatedAdapter`). No WhatsApp branding; nothing is sent. | WhatsApp Business Platform (Cloud API) account, verified number, approved message templates, webhook endpoint, media storage, opt-in from staff and client contacts. |
| WhatsApp groups | Reads a seeded `.txt` export (or one you drop in). | The Cloud API cannot read existing groups. Use exports or a supervised forwarding flow, with written consent from group members and a data-retention policy. |
| Email | Seeded JSON / dropped `.eml` files. | Mailbox integration (Microsoft 365 / Google Workspace API) with a dedicated address per project or zone. |
| Data | One fictional project, 90 days, deterministic seed. All names, phones, rates, vendors and messages are made up. | Real masters (staff, locations, meters), migration of current checklists, and a backend database (Postgres). |
| Hierarchy, SLAs, checklists, alert rules | Sirrus assumptions in `/config`. | Confirmation with Paradigm (see Discovery page). |
| Billing | Fake sample rates; billable = present + approved replacements; consumables need acknowledgement. No taxes, invoice numbers or resident billing. | Paradigm's actual billing rules and an export adapter for its billing software. |
| Meter export format | Generic columns, editable in the UI. | Paradigm's billing software import template. |
| Meter reading | Mock mode uses pre-labelled results for the 10 sample images; Live mode uses Claude vision. Own uploads are only read in Live mode. | Field testing on real meter photos (glare, angles, dial types), meter master with serials, technician app flow for retakes. |
| Message extraction | Mock mode uses deterministic rules tuned to the sample tone; Live mode uses Claude. Voice notes are not transcribed. | Evaluation on real (consented) chats, Kannada/Telugu/Hindi coverage, speech-to-text for voice notes. |
| Ask Paradigm | 7 read-only tools over one project. Mock mode routes common question shapes; anything else gets "not available". | More tools (multi-project, inspections, vendors), evaluation set, access control by role. |
| Scheduler | A simulation clock you advance by hand; the engine runs in the browser. Background staff replies are simulated ("autopilot"). | Server-side job queue and real staff behaviour. |
| Persistence | Browser IndexedDB, single user; ↺ resets. | Multi-user backend with audit trail. |
| Authentication | A role switcher, no login. | SSO / OTP login, role-based access, client read-only portal. |
| Multi-project | Other projects shown greyed out ("1 of ~100"). | Roll-up dashboards for Zonal Managers and the Operations Head. |
| Native apps, payroll, HRMS, procurement | Out of scope. | Integrations if needed later. |
| Images | Synthetic SVG/PNG placeholders labelled "SAMPLE IMAGE". | Real photos with location/time metadata and storage limits. |
| PDF | Browser print-to-PDF of an A4-styled page. | Server-side PDF generation and scheduled email to the committee. |

## Known prototype shortcuts

- The SLA clock runs 24×7 (no business-hours calendar or holidays).
- Changing an SLA or rule in Settings applies from the next simulated minute; past escalations are not recomputed.
- Security headcount uses one record per post per shift; overtime and double shifts are not modelled.
- The Live AI path is implemented against the Anthropic SDK and validated by schema, but was exercised in this build only through Mock mode (no API key was available in the build environment). Test Live mode with a key before showing it.
