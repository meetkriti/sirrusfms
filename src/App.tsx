import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { useStore } from "./store";
import { config } from "./config";
import TopBar from "./components/TopBar";
import SideNav from "./components/SideNav";
import PhonePanel from "./components/PhonePanel";
import DemoGuide from "./components/DemoGuide";
import { Spinner } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Alerts from "./pages/Alerts";
import Tickets from "./pages/Tickets";
import TicketDetail from "./pages/TicketDetail";
import Messages from "./pages/Messages";
import Meters from "./pages/Meters";
import Billing from "./pages/Billing";
import Insights from "./pages/Insights";
import Ask from "./pages/Ask";
import ClientReport from "./pages/ClientReport";
import Settings from "./pages/Settings";
import Discovery from "./pages/Discovery";
import Audit from "./pages/Audit";

function Home() {
  const role = useStore((s) => s.role);
  return <Navigate to={config.hierarchy.roles.find((r) => r.id === role)?.defaultRoute ?? "/dashboard"} replace />;
}

export default function App() {
  const { db, error, load, playing, speed, advance, toast } = useStore();
  const loc = useLocation();

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => advance(speed), 1000);
    return () => clearInterval(id);
  }, [playing, speed, advance]);

  if (error)
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6 text-sm shadow">
          <h1 className="mb-2 text-lg font-semibold text-red-700">Could not load the prototype</h1>
          <p className="mb-3 text-slate-700">{error}</p>
          <pre className="rounded bg-slate-900 p-3 text-xs text-slate-100">npm install && npm run seed && npm run dev</pre>
        </div>
      </div>
    );
  if (!db)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading Lakeshore Greens sample data…" />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto px-5 py-4">
          <ErrorBoundary resetKey={loc.pathname + loc.search}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/meters" element={<Meters />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/report" element={<ClientReport />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/discovery" element={<Discovery />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </main>
        <PhonePanel />
      </div>
      <DemoGuide />
      {toast && Date.now() - toast.at < 6000 && (
        <div key={toast.at} className="no-print fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast.text}
        </div>
      )}
    </div>
  );
}
