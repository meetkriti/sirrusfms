import { useDB, useStore } from "../store";
import { Badge, Card, Empty, PageHeader, Td, Th } from "../components/ui";

export default function Audit() {
  const db = useDB();
  const { aiMode, aiConfigured, aiModel } = useStore();
  const list = [...db.audit].reverse();
  return (
    <div>
      <PageHeader
        title="AI audit log"
        sub={`Every AI call (mock or live): input hash, output, confidence and latency. Current mode: ${aiMode}. Live AI ${aiConfigured ? `configured (${aiModel})` : "not configured (no ANTHROPIC_API_KEY on the server)"}. The AI never writes dashboard numbers; it reads, classifies, extracts and words.`}
      />
      <Card>
        {list.length === 0 ? (
          <Empty title="No AI calls yet">Send a WhatsApp reply, raise a complaint, import messages, upload meter photos or ask a question.</Empty>
        ) : (
          <div className="scroll-thin max-h-[75vh] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0">
                <tr><Th>Time</Th><Th>Feature</Th><Th>Mode</Th><Th>Input hash</Th><Th>Input</Th><Th>Output</Th><Th>Conf.</Th><Th>Latency</Th><Th>OK</Th></tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs">{new Date(a.at).toLocaleTimeString("en-IN")}</Td>
                    <Td>{a.feature}</Td>
                    <Td><Badge tone={a.mode === "live" ? "violet" : "slate"}>{a.mode}</Badge></Td>
                    <Td className="font-mono text-xs">{a.input_hash}</Td>
                    <Td className="max-w-[240px] truncate text-xs" >{a.input_preview}</Td>
                    <Td className="max-w-[320px] truncate font-mono text-[11px]">{a.output}</Td>
                    <Td>{a.confidence?.toFixed(2) ?? "–"}</Td>
                    <Td className="text-xs">{a.latency_ms} ms</Td>
                    <Td>{a.ok ? <Badge tone="green">ok{a.retried ? " (retry)" : ""}</Badge> : <Badge tone="red" className="max-w-[200px] truncate">{a.error}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
