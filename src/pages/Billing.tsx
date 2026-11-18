import { useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { CheckCircle2, Download, XCircle } from "lucide-react";
import { useDB, useStore } from "../store";
import { config } from "../config";
import { billingReadiness, invoiceDraft } from "../engine/billing";
import { addDays, istDate, monthLabel } from "../lib/time";
import { dmy, inr, groupIndian } from "../lib/format";
import { Badge, Button, Card, cx, Empty, PageHeader, Select, Td, Th, Warn } from "../components/ui";

export default function Billing() {
  const db = useDB();
  const { now, mutate } = useStore();
  const [sp, setSp] = useSearchParams();
  const today = istDate(now);
  const months = [...new Set(db.attendance.map((a) => a.date.slice(0, 7)))].sort();
  const month = sp.get("month") ?? addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const inv = invoiceDraft(db, month);
  const blockers = billingReadiness(db, month);
  const shiftName: Record<string, string> = { sec_m: "Morning 06–14", sec_a: "Afternoon 14–22", sec_n: "Night 22–06" };

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      ["Paradigm Services · Monthly invoice draft (PROTOTYPE, SAMPLE RATES)"],
      ["Client", db.project.client_name],
      ["Project", `${db.project.name}, ${db.project.city}`],
      ["Month", monthLabel(month)],
      ["Note", "Taxes and invoice numbering are handled in Paradigm's billing software."],
      [],
      ["Section", "Description", "Qty", "Unit", "Rate (INR)", "Amount (INR)"],
    ];
    inv.sections.forEach((s) => s.lines.forEach((l) => rows.push([s.title, l.description, l.qty, l.unit, l.rate, l.amount])));
    rows.push([], ["", "Total before taxes", "", "", "", inv.total]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Invoice draft");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inv.sec.days.map((d) => ({ Date: dmy(d.date), "On duty": d.onDuty, Contracted: d.contracted, Billable: d.billable, "Below contract": d.below ? "Yes" : "", Verified: d.verified ? "Yes" : "No" }))), "Security days");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inv.con.items.map((c) => ({ Date: dmy(c.delivery_date), Item: c.item, Qty: c.quantity, Unit: c.unit, Rate: c.rate, Amount: c.quantity * c.rate, Acknowledgement: c.acknowledgement ? `${c.acknowledgement.type} by ${c.acknowledgement.by}` : "MISSING: cannot bill" }))), "Consumables");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inv.pw.rows.map((r) => ({ Quotation: r.quotation.number, Description: r.line.description, Status: r.quotation.approval_status, Quoted: r.line.quantity, Delivered: r.delivered, Variance: r.variance, Rate: r.line.rate, Billable: r.amount, Note: r.note }))), "Project work");
    XLSX.writeFile(wb, `invoice_draft_lakeshore_greens_${month}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Billing data capture"
        sub="Operational records → billing inputs. Resident-level billing is out of scope. Sample rates only."
        actions={
          <>
            <Select label="Month" value={month} onChange={(v) => setSp({ month: v })} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
            <Button variant="primary" onClick={exportXlsx}>
              <Download size={14} /> Export XLSX invoice draft
            </Button>
          </>
        }
      />
      <Card className="mb-4" title={blockers.length ? `${monthLabel(month)}: ${blockers.length} item(s) blocking the invoice` : `${monthLabel(month)}: ready to invoice`}>
        {blockers.length === 0 ? (
          <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 size={18} /> All deliveries acknowledged, attendance verified, project work has proof.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {blockers.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <XCircle size={15} className="text-red-600" />
                <Badge tone="red">{b.kind}</Badge>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card id="invoice" className="xl:col-span-3" title={`Monthly invoice draft · ${db.project.client_name}`}>
          {inv.sections.map((s) => (
            <div key={s.title} className="mb-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</div>
              {s.lines.length === 0 ? (
                <div className="text-sm text-slate-400">No billable lines this month.</div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i}>
                        <Td>{l.description}</Td>
                        <Td className="whitespace-nowrap text-right text-xs text-slate-500">{groupIndian(l.qty, l.qty % 1 ? 1 : 0)} {l.unit} × {inr(l.rate)}</Td>
                        <Td className="whitespace-nowrap text-right font-medium">{inr(l.amount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total before taxes</span>
            <span>{inr(inv.total)}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Sample rates from config/billing_rules.json. Taxes and invoice numbering are handled in Paradigm's billing software.</p>
        </Card>

        <Card id="security" className="xl:col-span-2" title="Security: attendance → billable man-days">
          <div className="mb-2 grid grid-cols-3 gap-2 text-center">
            <Stat k="Contracted" v={groupIndian(inv.sec.guardContracted)} />
            <Stat k="Billable" v={groupIndian(inv.sec.guardBillable, inv.sec.guardBillable % 1 ? 1 : 0)} good />
            <Stat k="Short" v={groupIndian(inv.sec.guardShortfall, inv.sec.guardShortfall % 1 ? 1 : 0)} bad={inv.sec.guardShortfall > 0} />
          </div>
          <table className="w-full">
            <thead><tr><Th>Shift</Th><Th>Contract</Th><Th>Present</Th><Th>Repl.</Th><Th>Half</Th><Th>Billable</Th></tr></thead>
            <tbody>
              {inv.sec.perShift.map((s) => (
                <tr key={s.shift_id}><Td>{shiftName[s.shift_id]}</Td><Td>{s.contracted}</Td><Td>{s.present}</Td><Td>{s.replacements}</Td><Td>{s.halfDays}</Td><Td className="font-medium">{s.billable}</Td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Rule [assumption, configurable]: billable = present + {config.billing.security.count_approved_replacements ? "approved replacements" : "(replacements excluded)"} + half-days × {config.billing.security.half_day_factor}.</p>
          <div className="mt-2 text-sm">
            <span className="font-semibold text-red-700">{inv.sec.shortfallDays.length} day(s) below contract:</span>{" "}
            {inv.sec.shortfallDays.map((d) => (
              <Link key={d.date} to={`/dashboard?from=${d.date}&to=${d.date}#attendance`} className="mr-1 text-accent-600 hover:underline">{dmy(d.date)} ({d.onDuty}/{d.contracted})</Link>
            ))}
          </div>
          {inv.sec.unverifiedDays.length > 0 && (
            <div className="mt-2">
              <Warn>
                Unverified: {inv.sec.unverifiedDays.map((d) => dmy(d.date)).join(", ")}.{" "}
                <button className="font-medium underline" onClick={() => mutate((w) => w.db.attendance.forEach((a) => { if (a.date.startsWith(month) && !a.verified) a.verified = true; }))}>Verify as supervisor</button>
              </Warn>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card id="consumables" title={`Consumables · ${inr(inv.con.amount)} billable · ${inv.con.blocked.length} blocked (${inr(inv.con.blockedAmount)})`}>
          {inv.con.items.length === 0 ? <Empty title="No deliveries this month" /> : (
            <table className="w-full">
              <thead><tr><Th>Date</Th><Th>Item</Th><Th>Qty</Th><Th>Amount</Th><Th>Acknowledgement</Th></tr></thead>
              <tbody>
                {inv.con.items.map((c) => (
                  <tr key={c.id} className={cx(!c.acknowledgement && "bg-red-50")}>
                    <Td className="whitespace-nowrap">{dmy(c.delivery_date)}</Td>
                    <Td>{c.item}</Td>
                    <Td>{c.quantity} {c.unit}</Td>
                    <Td>{inr(c.quantity * c.rate)}</Td>
                    <Td>
                      {c.acknowledgement ? (
                        <Badge tone="green">{c.acknowledgement.type} · {c.acknowledgement.by}</Badge>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Badge tone="red">Cannot bill: proof missing</Badge>
                          <Button size="sm" variant="ghost" onClick={() => mutate(() => (c.acknowledgement = { type: "photo", by: "Ravi Kumar", ref: "captured-in-demo" }))}>Capture proof</Button>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card id="project" title={`Project work against quotations · ${inr(inv.pw.amount)} billable`}>
          {inv.pw.rows.length === 0 ? <Empty title="No project work this month" /> : (
            <table className="w-full">
              <thead><tr><Th>Quotation</Th><Th>Item</Th><Th>Quoted</Th><Th>Delivered</Th><Th>Variance</Th><Th>Billable</Th></tr></thead>
              <tbody>
                {inv.pw.rows.map((r, i) => (
                  <tr key={i}>
                    <Td><div className="font-medium">{r.quotation.number}</div><Badge tone={r.quotation.approval_status === "approved" ? "green" : "amber"}>{r.quotation.approval_status}</Badge></Td>
                    <Td className="text-xs">{r.line.description}<div className="text-slate-500">{r.note}</div></Td>
                    <Td>{r.line.quantity}</Td>
                    <Td>{r.delivered}</Td>
                    <Td className={cx(r.variance < 0 ? "text-amber-700" : r.variance > 0 ? "text-red-700" : "text-emerald-700", "font-medium")}>{r.variance > 0 ? `+${r.variance}` : r.variance}</Td>
                    <Td>{inr(r.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ k, v, good, bad }: { k: string; v: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div className="text-[11px] uppercase text-slate-500">{k}</div>
      <div className={cx("text-lg font-semibold", good && "text-emerald-700", bad && "text-red-700")}>{v}</div>
      <div className="text-[10px] text-slate-400">guard man-days</div>
    </div>
  );
}
