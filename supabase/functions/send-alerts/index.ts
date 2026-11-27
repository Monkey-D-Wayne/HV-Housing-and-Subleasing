// Rhedr: send-alerts Edge Function.
// Emails students when new sublets match a search they saved on the Sublets page.
//
// The database calls this every 15 minutes (setup.sql, section 13). Each run it asks the database what is due
// (public.alerts_due), sends one email per student through Resend, and records what was sent so nobody gets
// the same sublet twice. Instant alerts go out on the next run; daily alerts once a day after 8 AM Penn State time.
// Lease-checked sublets come first in every email, and when two tie, the cheaper one comes first.
//
// It also handles the one-click unsubscribe that Gmail and Outlook show next to the sender
// (a POST to ...?unsubscribe=<token>), which turns off all of that student's alerts.
//
// Settings in the Supabase dashboard:
//   Secret RESEND_API_KEY   a Resend API key with Sending access (it starts with re_)
//   "Verify JWT" OFF        for this function, so the scheduled job and email apps can reach it.
//                           It checks its own key instead (the x-rhedr-job header, from table public.alert_job).
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY by itself.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SITE = Deno.env.get("SITE_URL") ?? "https://rhedr.com";
const FROM = Deno.env.get("ALERTS_FROM") ?? "Rhedr <noreply@send.rhedr.com>";
const REPLY_TO = Deno.env.get("ALERTS_REPLY_TO") ?? "support@rhedr.com";
const MAX_PER_EMAIL = 8;
const OM = { lat: 40.79647, lng: -77.86279 }; // Old Main

type Row = {
  search_id: number; user_id: string; email: string; token: string; label: string; frequency: string;
  sublet_id: number; title: string; kind: string; space: string; building_name: string | null; address: string;
  beds: number; baths: number | null; price: number; orig_price: number | null; start_date: string; end_date: string;
  furnished: boolean; utilities: boolean; lease_verified: boolean; photo: string | null; lat: number; lng: number;
};

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + Number(n).toLocaleString("en-US");
const day = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const bedsTxt = (b: number) => (b === 0 ? "Studio" : `${b} bd`);
function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTxt = (mi: number) => (mi < 1.2 ? Math.max(2, Math.round(mi * 20)) + " min walk to Old Main" : mi.toFixed(1) + " mi from Old Main");
const offUrl = (token: string, all = false) => `${SITE}/sublets?unsubscribe=${token}${all ? "&all=1" : ""}`;

function buildEmail(rows: Row[]) {
  // one entry per sublet, keeping the first search it matched; rows arrive best first
  const seen = new Set<number>();
  const list = rows.filter((r) => (seen.has(r.sublet_id) ? false : (seen.add(r.sublet_id), true)));
  const searches = [...new Map(rows.map((r) => [r.search_id, r])).values()];
  const shown = list.slice(0, MAX_PER_EMAIL);
  const more = list.length - shown.length;
  const first = list[0];
  const subject = list.length === 1
    ? `New sublet: ${first.building_name || first.address}, ${money(first.price)}/mo`
    : `${list.length} new sublets match your Rhedr alert${searches.length > 1 ? "s" : ""}`;

  const item = (r: Row) => {
    const url = `${SITE}/sublets?s=${r.sublet_id}`;
    const facts = [
      `${day(r.start_date)} to ${day(r.end_date)}`,
      `${r.space === "unit" ? "Whole place" : "Private room"} · ${bedsTxt(r.beds)}`,
      distTxt(miles(OM, r)),
    ];
    const chips = [r.kind === "takeover" ? "Lease takeover" : "Sublet", r.furnished ? "Furnished" : "", r.utilities ? "Utilities included" : ""].filter(Boolean);
    return `<tr><td style="padding:0 0 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e2dc;border-radius:12px;border-collapse:separate">
<tr>${r.photo ? `<td width="120" style="padding:12px 0 12px 12px;vertical-align:top"><a href="${esc(url)}"><img src="${esc(r.photo)}" width="120" height="90" alt="" style="display:block;width:120px;height:90px;object-fit:cover;border-radius:8px;border:0"></a></td>` : ""}
<td style="padding:12px 14px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
${r.lease_verified ? `<div style="display:inline-block;font-size:12px;font-weight:bold;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 8px;margin-bottom:6px">&#10003; Lease checked</div>` : ""}
<div style="font-size:16px;font-weight:bold;line-height:1.3"><a href="${esc(url)}" style="color:#1c1917;text-decoration:none">${esc(r.title)}</a></div>
<div style="font-size:13px;color:#57534e;margin-top:2px">${esc(r.building_name ? `${r.building_name}, ${r.address}` : r.address)}</div>
<div style="font-size:18px;font-weight:bold;margin-top:6px">${money(r.price)} <span style="font-size:13px;font-weight:normal;color:#57534e">/ month${r.orig_price && r.orig_price > r.price ? ` · ${money(r.orig_price - r.price)} under lease` : ""}</span></div>
<div style="font-size:13px;color:#57534e;margin-top:4px">${facts.map(esc).join("<br>")}</div>
<div style="font-size:12px;color:#57534e;margin-top:4px">${chips.map(esc).join(" · ")}</div>
<div style="margin-top:10px"><a href="${esc(url)}" style="display:inline-block;background:#c2410c;color:#fff;font-weight:bold;font-size:14px;text-decoration:none;border-radius:8px;padding:8px 14px">See the sublet</a></div>
</td></tr></table></td></tr>`;
  };

  const searchLines = searches.map((s) =>
    `<div style="margin:4px 0">"${esc(s.label)}" (${s.frequency === "instant" ? "as they post" : "daily"}) · <a href="${esc(offUrl(s.token))}" style="color:#c2410c">Turn off this alert</a></div>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#faf8f5">
<div style="display:none;max-height:0;overflow:hidden">${esc(list.length === 1 ? `${first.title}, ${money(first.price)} a month` : `${list.length} sublets near Penn State that match what you saved`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:0">
<tr><td style="padding:22px 22px 8px;font-family:Arial,Helvetica,sans-serif">
<div style="font-size:24px;font-weight:800;color:#1c1917;letter-spacing:-0.5px">Rhedr</div>
<div style="font-size:18px;font-weight:bold;color:#1c1917;margin-top:14px">${list.length === 1 ? "A new sublet matches your alert" : `${list.length} new sublets match your alert${searches.length > 1 ? "s" : ""}`}</div>
<div style="font-size:14px;color:#57534e;margin-top:4px">Posted by Penn State students with a confirmed psu.edu email. Good sublets go fast.</div>
</td></tr>
<tr><td style="padding:12px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${shown.map(item).join("")}</table></td></tr>
${more > 0 ? `<tr><td style="padding:0 22px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px"><a href="${SITE}/sublets" style="color:#c2410c;font-weight:bold">See ${more} more on Rhedr</a></td></tr>` : ""}
<tr><td style="padding:4px 22px 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#57534e;line-height:1.5">
<p style="margin:0 0 8px"><b>Stay safe.</b> See the place in person or on a live video call before you pay. Never pay by wire, gift card or crypto.</p>
<p style="margin:0 0 8px">You're getting this because you saved a search on Rhedr:</p>${searchLines}
<p style="margin:10px 0 0"><a href="${SITE}/sublets?alerts=1" style="color:#c2410c">Change your alerts</a> · <a href="${esc(offUrl(searches[0].token, true))}" style="color:#c2410c">Turn off all Rhedr alerts</a></p>
<p style="margin:10px 0 0;font-size:12px">Rhedr · State College, PA · <a href="${SITE}/privacy" style="color:#57534e">Privacy</a>. Rhedr is independent and not affiliated with Penn State.</p>
</td></tr></table></td></tr></table></body></html>`;

  const plain = [
    list.length === 1 ? "A new sublet matches your Rhedr alert:" : `${list.length} new sublets match your Rhedr alert${searches.length > 1 ? "s" : ""}:`,
    "",
    ...shown.flatMap((r) => [
      `${r.lease_verified ? "[Lease checked] " : ""}${r.title}`,
      `${money(r.price)} / month · ${day(r.start_date)} to ${day(r.end_date)} · ${r.space === "unit" ? "Whole place" : "Private room"} · ${bedsTxt(r.beds)}`,
      `${r.building_name ? r.building_name + ", " : ""}${r.address} · ${distTxt(miles(OM, r))}`,
      `${SITE}/sublets?s=${r.sublet_id}`,
      "",
    ]),
    more > 0 ? `See ${more} more: ${SITE}/sublets\n` : "",
    "Stay safe: see the place before you pay. Never pay by wire, gift card or crypto.",
    "",
    "You're getting this because you saved a search on Rhedr:",
    ...searches.map((s) => `"${s.label}": turn it off at ${offUrl(s.token)}`),
    `Turn off all Rhedr alerts: ${offUrl(searches[0].token, true)}`,
  ].join("\n");

  return { subject, html, plain, list, searches };
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // One-click unsubscribe from the email app (RFC 8058), or someone opening that link
  const unsub = url.searchParams.get("unsubscribe");
  if (unsub) {
    if (!/^[0-9a-f-]{36}$/i.test(unsub)) return text("That link isn't valid.", 400);
    if (req.method === "GET") return Response.redirect(offUrl(unsub, true), 302);
    const { error } = await admin.rpc("alert_unsubscribe", { p_token: unsub, p_all: true });
    return error ? text("Something went wrong. Try the link in the email.", 500) : text("Your Rhedr alerts are turned off.");
  }

  if (req.method !== "POST") return text("POST only", 405);
  // Only the scheduled job (or you, with the same key) can make it send
  const { data: job } = await admin.from("alert_job").select("secret").eq("id", 1).maybeSingle();
  const given = req.headers.get("x-rhedr-job") ?? "";
  if (!job?.secret || given.length !== job.secret.length || given !== job.secret) return json({ error: "Not allowed" }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = !!body?.dry_run;
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key && !dryRun) return json({ error: "Add the RESEND_API_KEY secret in Supabase first" }, 500);

  let rows: Row[] = [];
  if (body?.test) {
    // {"test": true}: email the newest saved alert's owner a sample with up to 3 live sublets.
    // Nothing is recorded as sent, so their real alerts still go out.
    const { data: a } = await admin.from("saved_searches").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!a) return json({ error: "Save an alert on the Sublets page first" }, 400);
    const { data: u } = await admin.auth.admin.getUserById(a.user_id);
    const { data: subs } = await admin.from("sublets_public").select("*").order("lease_verified", { ascending: false }).order("price").limit(3);
    if (!u?.user?.email) return json({ error: "Couldn't find that alert's email" }, 400);
    // no live sublets yet: show one made-up example so the test still sends
    const sample = [{ id: 0, title: "Example: private room in a 2-bed near campus", kind: "sublet", space: "room", building_name: null,
      address: "100 W College Ave", beds: 2, baths: 1, price: 650, orig_price: 780, start_date: "2027-05-15", end_date: "2027-08-10",
      furnished: true, utilities: false, lease_verified: true, photos: [], lat: 40.7955, lng: -77.8611 }];
    rows = (subs?.length ? subs : sample).map((s) => ({ ...s, search_id: a.id, user_id: a.user_id, email: u.user!.email!, token: a.token, label: a.label,
      frequency: a.frequency, sublet_id: s.id, photo: s.photos?.[0] ?? null }) as Row);
  } else {
    const { data, error } = await admin.rpc("alerts_due");
    if (error) return json({ error: error.message }, 500);
    rows = (data ?? []) as Row[];
  }
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  const report = { students: byUser.size, sent: 0, failed: 0, sublets: 0, errors: [] as string[], preview: [] as unknown[] };
  for (const [userId, rows] of byUser) {
    const mail = buildEmail(rows);
    if (dryRun) { report.preview.push({ to: rows[0].email, subject: mail.subject, sublets: mail.list.map((r) => r.sublet_id) }); continue; }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // the same student and sublets never send twice, even if a run repeats
        "Idempotency-Key": await sha((body?.test ? "test:" + Date.now() + ":" : "") + userId + ":" + mail.list.map((r) => r.sublet_id).join(",")),
      },
      body: JSON.stringify({
        from: FROM,
        to: [rows[0].email],
        reply_to: REPLY_TO,
        subject: (body?.test ? "[Test] " : "") + mail.subject,
        html: mail.html,
        text: mail.plain,
        headers: {
          "List-Unsubscribe": `<${Deno.env.get("SUPABASE_URL")}/functions/v1/send-alerts?unsubscribe=${rows[0].token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "type", value: "sublet_alert" }],
      }),
    });
    if (!res.ok) { report.failed++; report.errors.push(`${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
    report.sent++;
    report.sublets += mail.list.length;
    if (body?.test) continue;
    // everything in the email counts as sent, including the ones behind "See more"
    await admin.from("alert_sends").upsert(
      mail.list.map((r) => ({ search_id: r.search_id, user_id: userId, sublet_id: r.sublet_id })),
      { onConflict: "user_id,sublet_id", ignoreDuplicates: true },
    );
    await admin.from("saved_searches").update({ last_sent_at: new Date().toISOString() }).in("id", mail.searches.map((s) => s.search_id));
  }
  return json(report);
});
