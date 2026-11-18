# Demo script (10–15 minutes)

**Before you start:** `npm run dev`, open http://localhost:5173 on a laptop at 1440px or wider,
click **↺** (reset) so the sim clock reads **07:00 AM today**, keep AI on **Mock** unless a key is
configured. Click **Start demo**: the guide bar at the bottom moves through these steps, switches
the role and the phone for you, and has buttons for each action.

Opening line: *"This is one of your ~100 projects, Lakeshore Greens, on sample data. Nothing here
needs your ground staff to learn a new app: they stay on WhatsApp."*

---

### 1 · Before (1 min) — Messages › Before: raw messages
**Show:** the site group, ~300 messages in two weeks, and the inspection emails.
**Say:** "This is how it runs today. Most of it is 'good morning', 'ok', photos without context.
If the association asks 'was Tower C cleaned on Sunday?', someone has to scroll."

### 2 · Structured WhatsApp workflow (2 min) — Tasks, phone = Ravi
**Click:** *Move clock to 07:35*. In the phone, the bot has sent Ravi his staircase checklists.
Type **`A tower ho gaya sir`** (or tap *1 Done* on the Tower A prompt), then 📷 and pick the staircase photo.
**Show:** the Tower A card moves to **Done** on today's board immediately.
**Optional:** switch the phone to **Suresh (STP)**, tap *Start log*, send **9.1** → the bot says pH is
outside 6.5–8.5; reply with a remark → an R4 alert goes to the Technical Supervisor and FM.
**Say:** "Buttons, numbers, Hinglish or a photo all work. Every reply updates the record."

### 3 · Missed activity (1.5 min) — Alerts, phone = Priya (FM)
**Click:** *Jump clock to 09:35*.
**Show:** R1 reminder to Ravi at 9:00; at 9:30 R2 "Missed: Tower C staircase" to the Supervisor and FM
(also on Priya's phone); R3 **Recurring miss** to the Zonal Manager because Tower C was missed 3+ times in 7 days.
**Say:** "Each alert says which rule fired and why. Thresholds are editable in Settings."

### 4 · Society complaint (2 min) — Tickets, phone = AOA Secretary, role = Zonal
**Click:** *Send the complaint* ("Lift in B tower again stuck between 7 and 8 floor…").
**Show:** the bot replies with a ticket number; the ticket is Lift · P1 · Tower B with an owner.
**Click:** *Advance 2 hours* → open the ticket: **L1 → L2 at 30 min → L3 at 2 h** on the timeline,
SLA breach markers, linked WhatsApp messages. *Escalation view* lists repeat Tower B lift tickets.
**Optional:** add a note and *Resolve* → the Secretary's phone gets "Reply YES if resolved, NO to reopen".

### 5 · Intelligence layer (1.5 min) — Messages › Before / after
**Click:** *Import sample export*.
**Show:** left = raw chat, right = structured events. Click an event to highlight its source
message. KPI tiles: tasks **inferred done** from the group, messages **linked to tickets**, and the
**review queue** (voice notes, a group-only leak report, a mismatched headcount).
**Say:** "Value from data you already have, before anyone changes behaviour. Every record traces back to its message."

### 6 · Meter readings (1 min) — Meters, role = Finance
**Click:** *Upload 10 sample meter photos*.
**Show:** each photo → reading + serial → unit → validation. **B-1204 flagged** (3.8× its 3-month
average), D-0902 rejected (lower than last month), a blurred photo and an unknown serial in review.
Progress bar "x of 384 captured". Export CSV/XLSX; rename columns to match the billing software.

### 7 · Billing inputs (1 min) — Billing (previous month)
**Show:** billable security man-days (present + approved replacements) vs contracted, days below
contract, consumables that **cannot be billed** without acknowledgement, quotation variance
(110 of 120 plants delivered), readiness checklist, *Export XLSX invoice draft*.

### 8 · Patterns (1 min) — Insights, role = Operations Head
**Show:** Tower B lift (repeat breakdowns, all to Zonal), Tower C staircase on Sundays, night patrol
at month end, STP odour after rain, security below contract. Click evidence chips into the records.
**Say:** "Numbers are computed; the AI only words them."

### 9 · Ask in plain English (1 min) — Ask Paradigm
Click the suggested questions, including **"Kal STP ka log fill hua tha?"** and
**"What was the diesel cost this month?"** (→ "not available in the data"). Open *Figures used*.

### 10 · Client report (1 min) — Client Report, role = Client
**Show:** the one-page monthly report; misses are shown with the corrective action. *Print / save as PDF*.
**Close:** open **Discovery: to confirm** and use it to run the conversation: hierarchy, checklists,
KPIs, SLAs, billing rules, billing software format, consent, pilot use cases.

---

**If something goes wrong:** ↺ resets everything; pages are isolated by an error boundary; Mock mode needs no network.
