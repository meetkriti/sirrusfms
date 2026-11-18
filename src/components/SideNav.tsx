import { NavLink } from "react-router-dom";
import { Bell, BookOpen, Bot, ClipboardCheck, FileText, Gauge, HelpCircle, LayoutDashboard, Lightbulb, MessagesSquare, ReceiptIndianRupee, Settings, ShieldCheck, Ticket } from "lucide-react";
import { useDB, useStore } from "../store";
import { alertsForRole } from "../engine/alerts";
import { ACTIVE_TICKET } from "../engine/tickets";
import { cx } from "./ui";

export default function SideNav() {
  const db = useDB();
  const role = useStore((s) => s.role);
  const openAlerts = alertsForRole(db, role).filter((a) => a.status === "open").length;
  const openTickets = db.tickets.filter((t) => ACTIVE_TICKET.has(t.status)).length;
  const review = db.extracted.filter((e) => e.review_status === "needs_review").length;
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
    { to: "/tasks", label: "Tasks", icon: <ClipboardCheck size={16} /> },
    { to: "/alerts", label: "Alerts", icon: <Bell size={16} />, count: openAlerts, tone: "red" },
    { to: "/tickets", label: "Tickets", icon: <Ticket size={16} />, count: openTickets },
    { to: "/messages", label: "Messages", icon: <MessagesSquare size={16} />, count: review, tone: "amber" },
    { to: "/meters", label: "Meters", icon: <Gauge size={16} /> },
    { to: "/billing", label: "Billing", icon: <ReceiptIndianRupee size={16} /> },
    { to: "/insights", label: "Insights", icon: <Lightbulb size={16} /> },
    { to: "/ask", label: "Ask Paradigm", icon: <Bot size={16} /> },
    { to: "/report", label: "Client Report", icon: <FileText size={16} /> },
  ];
  const lower = [
    { to: "/settings", label: "Settings", icon: <Settings size={16} /> },
    { to: "/discovery", label: "Discovery: to confirm", icon: <HelpCircle size={16} /> },
    { to: "/audit", label: "AI audit", icon: <ShieldCheck size={16} /> },
  ];
  const link = (i: { to: string; label: string; icon: JSX.Element; count?: number; tone?: string }) => (
    <NavLink key={i.to} to={i.to} className={({ isActive }) => cx("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm", isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
      {i.icon}
      <span className="flex-1">{i.label}</span>
      {!!i.count && <span className={cx("rounded-full px-1.5 text-[11px] font-semibold", i.tone === "red" ? "bg-red-100 text-red-700" : i.tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700")}>{i.count}</span>}
    </NavLink>
  );
  return (
    <nav className="no-print scroll-thin flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-white p-2">
      {items.map(link)}
      <div className="my-2 border-t border-slate-100" />
      {lower.map(link)}
      <div className="mt-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-500">
        <BookOpen size={12} className="mb-0.5 inline" /> Prototype on synthetic data for one fictional project. WhatsApp and email are simulated.
      </div>
    </nav>
  );
}
