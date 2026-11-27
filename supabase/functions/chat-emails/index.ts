// Rhedr: chat-emails Edge Function.
// Emails a student "You have a new message" when someone writes to them in a Rhedr chat and they haven't read it.
//
// The database calls this every 5 minutes (messaging.sql, section F). Each run it asks the database who has unread
// messages that are at least 2 minutes old (public.chat_emails_due), sends one email per student through Resend,
// and records the time so the same chat emails them at most once every 30 minutes.
// The email shows the latest message as it was saved, so phone numbers and emails stay hidden until both agreed.
//
// Settings in the Supabase dashboard:
//   Secret RESEND_API_KEY   the same one send-alerts uses (Edge Function secrets are shared by all functions)
//   "Verify JWT" OFF        for this function, so the scheduled job can reach it.
//                           It checks its own key instead (the x-rhedr-job header, from table public.alert_job).
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY by itself.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SITE = Deno.env.get("SITE_URL") ?? "https://rhedr.com";
const FROM = Deno.env.get("CHAT_FROM") ?? "Rhedr <noreply@send.rhedr.com>";
const REPLY_TO = Deno.env.get("ALERTS_REPLY_TO") ?? "support@rhedr.com";

type Row = {
  conversation_id: number; side: "poster" | "student"; email: string; to_name: string; from_name: string;
  sublet_title: string; unread: number; last_body: string; agreed: boolean;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const chatUrl = (id: number) => `${SITE}/sublets?chat=${id}`;

function buildEmail(rows: Row[]) {
  const first = rows[0];
  const total = rows.reduce((n, r) => n + r.unread, 0);
  const subject = rows.length === 1
    ? `${first.from_name} sent you a message about ${cut(first.sublet_title, 50)}`
    : `You have ${total} new messages on Rhedr`;

  const item = (r: Row) => `<tr><td style="padding:0 0 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e2dc;border-radius:12px;border-collapse:separate">
<tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<div style="font-size:13px;color:#57534e">${r.side === "poster" ? "About your sublet" : "About the sublet"} · ${esc(cut(r.sublet_title, 70))}</div>
<div style="font-size:16px;font-weight:bold;margin-top:4px">${esc(r.from_name)}${r.unread > 1 ? ` <span style="font-weight:normal;color:#57534e;font-size:14px">(${r.unread} new)</span>` : ""}</div>
<div style="font-size:15px;line-height:1.45;margin-top:8px;padding:10px 12px;background:#faf8f5;border-radius:10px;white-space:pre-line">${esc(cut(r.last_body, 300))}</div>
<div style="margin-top:12px"><a href="${esc(chatUrl(r.conversation_id))}" style="display:inline-block;background:#c2410c;color:#fff;font-weight:bold;font-size:14px;text-decoration:none;border-radius:8px;padding:9px 16px">Reply on Rhedr</a></div>
</td></tr></table></td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#faf8f5">
<div style="display:none;max-height:0;overflow:hidden">${esc(cut(first.last_body, 120))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px">
<tr><td style="padding:22px 22px 8px;font-family:Arial,Helvetica,sans-serif">
<div style="font-size:24px;font-weight:800;color:#1c1917;letter-spacing:-0.5px">Rhedr</div>
<div style="font-size:18px;font-weight:bold;color:#1c1917;margin-top:14px">Hi ${esc(first.to_name)}, ${rows.length === 1 ? "you have a new message" : `you have ${total} new messages`}</div>
</td></tr>
<tr><td style="padding:12px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(item).join("")}</table></td></tr>
<tr><td style="padding:4px 22px 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#57534e;line-height:1.5">
<p style="margin:0 0 8px">Replying to this email won't reach the other student. Answer in the chat on Rhedr.</p>
<p style="margin:0 0 8px"><b>Stay safe.</b> Keep the conversation on Rhedr, and see the place in person or on a live video call before you pay. Never pay by wire, gift card or crypto.</p>
<p style="margin:10px 0 0;font-size:12px">Rhedr · State College, PA · <a href="${SITE}/privacy" style="color:#57534e">Privacy</a>. Rhedr is independent and not affiliated with Penn State.</p>
</td></tr></table></td></tr></table></body></html>`;

  const plain = [
    `Hi ${first.to_name}, ${rows.length === 1 ? "you have a new message on Rhedr" : `you have ${total} new messages on Rhedr`}.`,
    "",
    ...rows.flatMap((r) => [
      `${r.from_name}, about ${r.side === "poster" ? "your sublet" : "the sublet"} "${r.sublet_title}"${r.unread > 1 ? ` (${r.unread} new)` : ""}:`,
      `"${cut(r.last_body, 300)}"`,
      `Reply on Rhedr: ${chatUrl(r.conversation_id)}`,
      "",
    ]),
    "Replying to this email won't reach the other student. Answer in the chat on Rhedr.",
    "Stay safe: see the place before you pay. Never pay by wire, gift card or crypto.",
  ].join("\n");

  return { subject, html, plain };
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Only the scheduled job (or you, with the same key) can make it send
  const { data: job } = await admin.from("alert_job").select("secret").eq("id", 1).maybeSingle();
  const given = req.headers.get("x-rhedr-job") ?? "";
  if (!job?.secret || given.length !== job.secret.length || given !== job.secret) return json({ error: "Not allowed" }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = !!body?.dry_run;
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key && !dryRun) return json({ error: "Add the RESEND_API_KEY secret in Supabase first" }, 500);

  const { data, error } = await admin.rpc("chat_emails_due");
  if (error) return json({ error: error.message }, 500);
  const byEmail = new Map<string, Row[]>();
  for (const r of (data ?? []) as Row[]) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);

  const report = { students: byEmail.size, sent: 0, failed: 0, errors: [] as string[], preview: [] as unknown[] };
  for (const [email, rows] of byEmail) {
    const mail = buildEmail(rows.slice(0, 10));
    if (dryRun) { report.preview.push({ to: email, subject: mail.subject, chats: rows.map((r) => r.conversation_id) }); continue; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // a repeated run within the same few minutes never sends the same email twice
        "Idempotency-Key": await sha(email + ":" + rows.map((r) => `${r.conversation_id}/${r.unread}`).join(",") + ":" + Math.floor(Date.now() / 600000)),
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        reply_to: REPLY_TO,
        subject: mail.subject,
        html: mail.html,
        text: mail.plain,
        tags: [{ name: "type", value: "chat_message" }],
      }),
    });
    if (!res.ok) { report.failed++; report.errors.push(`${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
    report.sent++;
    const now = new Date().toISOString();
    for (const side of ["poster", "student"] as const) {
      const ids = rows.filter((r) => r.side === side).map((r) => r.conversation_id);
      if (ids.length) await admin.from("conversations").update({ [`${side}_emailed_at`]: now }).in("id", ids);
    }
  }
  return json(report);
});
