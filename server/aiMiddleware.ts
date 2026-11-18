// Live AI proxy, mounted inside the Vite dev/preview server at /api/ai/*.
// The browser never sees the API key. Without a key, /api/ai/status reports
// "not configured" and the app stays in Mock mode.
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;
const model = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";
const configured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Images are referenced by public path (e.g. /samples/meters/x.png) or sent as data URLs. */
function imageBlock(root: string, ref: string) {
  if (ref.startsWith("data:")) {
    const [, mime, data] = ref.match(/^data:(image\/\w+);base64,(.*)$/) ?? [];
    return { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png", data } };
  }
  const file = path.join(root, "public", path.normalize(ref).replace(/^(\.\.[/\\])+/, ""));
  const ext = path.extname(file).slice(1).toLowerCase();
  const media = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return { type: "image" as const, source: { type: "base64" as const, media_type: media as "image/png", data: fs.readFileSync(file).toString("base64") } };
}

function errorPayload(e: unknown) {
  if (e instanceof Anthropic.RateLimitError) return { status: 429, error: "Rate limited by the Claude API. Try again shortly or switch to Mock mode." };
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, error: "The API key was rejected." };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, error: `Bad request: ${e.message}` };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, error: "Could not reach the Claude API (network)." };
  if (e instanceof Anthropic.APIError) return { status: e.status ?? 500, error: e.message };
  return { status: 500, error: e instanceof Error ? e.message : String(e) };
}

async function handle(root: string, req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "";
  if (url.startsWith("/status")) return send(res, 200, { configured: configured(), model: model() });
  if (!configured()) return send(res, 503, { error: "ANTHROPIC_API_KEY is not set. Running in Mock mode." });
  const body = await readBody(req);
  const t0 = Date.now();
  try {
    if (url.startsWith("/structured")) {
      // Single call with a strict JSON schema (extraction, classification, meter reading, insight wording, intent).
      const content = [
        ...((body.images as string[] | undefined) ?? []).map((ref) => imageBlock(root, ref)),
        { type: "text" as const, text: String(body.user) },
      ];
      const msg = await getClient().beta.messages.create({
        model: model(),
        max_tokens: 16000,
        system: String(body.system),
        messages: [{ role: "user", content }],
        output_config: { effort: body.effort ?? "low", format: { type: "json_schema", schema: body.schema } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (msg.stop_reason === "refusal") return send(res, 200, { ok: false, error: "The model declined this request.", latency_ms: Date.now() - t0 });
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return send(res, 200, { ok: true, text, stop_reason: msg.stop_reason, usage: msg.usage, model: msg.model, latency_ms: Date.now() - t0 });
    }
    if (url.startsWith("/messages")) {
      // One turn of the "Ask Paradigm" tool-use loop. Tools execute in the browser over the local data.
      const msg = await getClient().beta.messages.create({
        model: model(),
        max_tokens: 16000,
        system: String(body.system),
        messages: body.messages,
        tools: body.tools,
        output_config: { effort: body.effort ?? "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      return send(res, 200, { ok: msg.stop_reason !== "refusal", content: msg.content, stop_reason: msg.stop_reason, usage: msg.usage, model: msg.model, latency_ms: Date.now() - t0 });
    }
    return send(res, 404, { error: "Unknown AI endpoint" });
  } catch (e) {
    const p = errorPayload(e);
    return send(res, p.status, { ok: false, error: p.error, latency_ms: Date.now() - t0 });
  }
}

export function aiMiddlewarePlugin(): Plugin {
  let root = process.cwd();
  // Note: must not return anything; Vite treats a returned function as a post-middleware hook.
  const mount = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown } }): void => {
    server.middlewares.use("/api/ai", (req, res) => {
      handle(root, req, res).catch((e) => send(res, 500, { ok: false, error: String(e) }));
    });
  };
  return {
    name: "paradigm-ai-proxy",
    configResolved(c) {
      root = c.root;
      const env = loadEnv(c.mode, c.root, "");
      for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_MODEL"]) if (env[k] && !process.env[k]) process.env[k] = env[k];
    },
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
  };
}
