// Messaging layer. Payloads mirror the WhatsApp Cloud API so that a real
// integration (a CloudApiAdapter calling graph.facebook.com and receiving the
// webhook) can replace the SimulatedAdapter without touching the bot logic.
import type { ChatMessage, DB } from "../types";
import { nid, staffById, type World } from "./core";

// ---- Outbound (Cloud API /messages request bodies) ----
export interface OutboundText {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { preview_url: false; body: string };
}
export interface OutboundImage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image";
  image: { link: string; caption?: string };
}
export interface OutboundInteractive {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "button";
    body: { text: string };
    action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] };
  };
}

// ---- Inbound (Cloud API webhook notification) ----
export type InboundMessage =
  | { from: string; id: string; timestamp: string; type: "text"; text: { body: string } }
  | { from: string; id: string; timestamp: string; type: "interactive"; interactive: { type: "button_reply"; button_reply: { id: string; title: string } } }
  | { from: string; id: string; timestamp: string; type: "image"; image: { id: string; mime_type: string; caption?: string; link?: string } };

export interface InboundWebhook {
  object: "whatsapp_business_account";
  entry: {
    id: string;
    changes: {
      field: "messages";
      value: {
        messaging_product: "whatsapp";
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts: { profile: { name: string }; wa_id: string }[];
        messages: InboundMessage[];
      };
    }[];
  }[];
}

export interface MessageContext {
  task_id?: string;
  ticket_id?: string;
}

export interface MessagingAdapter {
  sendMessage(to: string, body: string, ctx?: MessageContext, photo?: string): ChatMessage;
  sendInteractive(to: string, body: string, buttons: { id: string; title: string }[], ctx?: MessageContext): ChatMessage;
  onInboundMessage(handler: (webhook: InboundWebhook) => void | Promise<void>): void;
}

const BUSINESS_NUMBER = "+91 80 4000 0000 (sample)";
const waId = (db: DB, staffId: string) => (staffById(db, staffId)?.phone ?? staffId).replace(/\D/g, "");
const staffIdFromWa = (db: DB, wa: string) => db.staff.find((s) => s.phone.replace(/\D/g, "") === wa)?.id;

let inboundHandler: ((w: InboundWebhook) => void | Promise<void>) | null = null;

/** Simulator: "sending" means appending to the in-app chat log for that phone. */
export class SimulatedAdapter implements MessagingAdapter {
  constructor(private w: World) {}

  sendMessage(to: string, body: string, ctx: MessageContext = {}, photo?: string): ChatMessage {
    const { db, now } = this.w;
    const payload: OutboundText | OutboundImage = photo
      ? { messaging_product: "whatsapp", recipient_type: "individual", to: waId(db, to), type: "image", image: { link: photo, caption: body } }
      : { messaging_product: "whatsapp", recipient_type: "individual", to: waId(db, to), type: "text", text: { preview_url: false, body } };
    const msg: ChatMessage = { id: nid(db, "WAM", 6), phone_owner: to, from: "bot", at: now, text: body, photo, payload, ...ctx };
    db.chat.push(msg);
    return msg;
  }

  sendInteractive(to: string, body: string, buttons: { id: string; title: string }[], ctx: MessageContext = {}): ChatMessage {
    const { db, now } = this.w;
    const payload: OutboundInteractive = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: waId(db, to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    };
    const msg: ChatMessage = { id: nid(db, "WAM", 6), phone_owner: to, from: "bot", at: now, text: body, buttons, payload, ...ctx };
    db.chat.push(msg);
    return msg;
  }

  onInboundMessage(handler: (webhook: InboundWebhook) => void | Promise<void>) {
    inboundHandler = handler;
  }

  /** Build a Cloud-API-shaped webhook for something typed/tapped on the simulated phone and log it in the chat. */
  receive(from: string, input: { text?: string; buttonId?: string; buttonTitle?: string; photo?: string }): { webhook: InboundWebhook; chat: ChatMessage } {
    const { db, now } = this.w;
    const id = nid(db, "WAM", 6);
    const base = { from: waId(db, from), id: `wamid.${id}`, timestamp: String(Math.floor(now / 1000)) };
    let message: InboundMessage;
    if (input.photo) message = { ...base, type: "image", image: { id: `media-${id}`, mime_type: "image/png", caption: input.text, link: input.photo } };
    else if (input.buttonId) message = { ...base, type: "interactive", interactive: { type: "button_reply", button_reply: { id: input.buttonId, title: input.buttonTitle ?? input.buttonId } } };
    else message = { ...base, type: "text", text: { body: input.text ?? "" } };
    const webhook: InboundWebhook = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-SAMPLE",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: BUSINESS_NUMBER, phone_number_id: "PHONE-ID-SAMPLE" },
                contacts: [{ profile: { name: staffById(db, from)?.name ?? from }, wa_id: waId(db, from) }],
                messages: [message],
              },
            },
          ],
        },
      ],
    };
    const chat: ChatMessage = {
      id,
      phone_owner: from,
      from: "user",
      at: now,
      text: input.photo ? input.text ?? "" : input.buttonTitle ?? input.text ?? "",
      photo: input.photo,
      payload: webhook,
    };
    db.chat.push(chat);
    return { webhook, chat };
  }
}

/** Parse a webhook back into a simple inbound event for the bot. */
export function parseWebhook(db: DB, webhook: InboundWebhook) {
  const m = webhook.entry[0].changes[0].value.messages[0];
  const staffId = staffIdFromWa(db, m.from) ?? m.from;
  if (m.type === "text") return { staffId, kind: "text" as const, text: m.text.body, msgId: m.id };
  if (m.type === "interactive") return { staffId, kind: "button" as const, buttonId: m.interactive.button_reply.id, text: m.interactive.button_reply.title, msgId: m.id };
  return { staffId, kind: "image" as const, photo: m.image.link ?? "", text: m.image.caption ?? "", msgId: m.id };
}

export function getInboundHandler() {
  return inboundHandler;
}
