// Rhedr: check-lease Edge Function.
// Reads a lease proof with Claude, compares it to the listing and the building's known prices,
// and saves green / yellow / red with reasons for the admin page (rhedr.com/admin).
//
// Called by the Sublets page right after someone posts with a lease proof (or adds one later),
// and by the admin page's "Read with AI" button. Each proof is read by the AI once; only an admin can run it again.
//
// Secrets it needs (Supabase dashboard, Edge Functions, Secrets):
//   ANTHROPIC_API_KEY   from console.anthropic.com. Without it, nothing is read and every proof waits for you.
// Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY by itself.
import Anthropic from "npm:@anthropic-ai/sdk@1.12.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SITE = Deno.env.get("SITE_URL") ?? "https://rhedr.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// What Claude reads out of the document
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["doc_type", "readable", "tenant_names", "landlord_name", "address", "unit", "lease_start", "lease_end", "monthly_rent", "rent_is_per_person", "looks_edited", "notes"],
  properties: {
    doc_type: { type: "string", enum: ["lease", "utility_bill", "other_residence_proof", "not_residence_proof"] },
    readable: { type: "boolean", description: "false if the file is too blurry, cut off or blank to read" },
    tenant_names: { type: "array", items: { type: "string" }, description: "Full names of the tenants or account holders" },
    landlord_name: { anyOf: [{ type: "string" }, { type: "null" }], description: "Landlord or property manager" },
    address: { anyOf: [{ type: "string" }, { type: "null" }], description: "Street address of the rented place, without the unit" },
    unit: { anyOf: [{ type: "string" }, { type: "null" }] },
    lease_start: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    lease_end: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    monthly_rent: { anyOf: [{ type: "number" }, { type: "null" }], description: "Monthly rent in US dollars" },
    rent_is_per_person: { anyOf: [{ type: "boolean" }, { type: "null" }], description: "true if the rent is one tenant's share (individual lease), false if it is the whole unit" },
    looks_edited: { type: "boolean", description: "true if parts look pasted in, mismatched fonts, or otherwise altered" },
    notes: { type: "string", description: "One short sentence on anything odd, or empty" },
  },
} as const;
type Lease = {
  doc_type: string; readable: boolean; tenant_names: string[]; landlord_name: string | null; address: string | null; unit: string | null;
  lease_start: string | null; lease_end: string | null; monthly_rent: number | null; rent_is_per_person: boolean | null; looks_edited: boolean; notes: string;
};
type Building = { id: number; name: string; address: string; ppm?: number | null; price?: string; beds?: number[] };

const PROMPT = `This file was uploaded by a Penn State student as proof that they live at the place they are subletting in State College, PA.
Read it and fill in the fields. Use null for anything the document doesn't show; never guess.
Dates as YYYY-MM-DD. If the rent is shown both per person and per unit, give the per-person amount.
Only the first pages matter: the parties, the address, the term and the rent.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Sign in first" }, 401);
    const { data: isAdmin } = await asUser.rpc("is_admin");

    const body = await req.json().catch(() => ({}));
    const subletId = Number(body.sublet_id) || null, checkId = Number(body.check_id) || null;
    let q = admin.from("lease_checks").select("*").is("decision", null).order("created_at", { ascending: false }).limit(1);
    q = checkId ? q.eq("id", checkId) : q.eq("sublet_id", subletId ?? -1);
    const { data: rows, error: qe } = await q;
    if (qe) throw qe;
    const check = rows?.[0];
    if (!check) return json({ ok: true, skipped: "no open lease check" });
    if (check.user_id !== user.id && !isAdmin) return json({ error: "Not your listing" }, 403);
    // posters can trigger the AI read once; admins can re-run it
    if (check.ai_checked_at && !isAdmin) return json({ ok: true, skipped: "already read" });

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ ok: true, skipped: "ANTHROPIC_API_KEY not set; waiting for a manual check" });
    if (!check.file_path) return json({ ok: true, skipped: "file already deleted" });

    const [{ data: s }, { data: owner }, { data: settings }, buildings] = await Promise.all([
      admin.from("sublets").select("*").eq("id", check.sublet_id).single(),
      admin.auth.admin.getUserById(check.user_id),
      admin.from("site_settings").select("*").eq("id", 1).maybeSingle(),
      fetch(`${SITE}/data/listings.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []) as Promise<Building[]>,
    ]);
    if (!s) return json({ ok: true, skipped: "listing deleted" });

    const { data: file, error: fe } = await admin.storage.from("lease-proofs").download(check.file_path);
    if (fe || !file) throw fe ?? new Error("Couldn't download the lease proof");
    const lease = await readLease(key, file);

    const b = buildings.find((x) => x.id === s.building_id) ?? null;
    const { result, reasons } = compare(lease, s, b, owner?.user?.email ?? "");
    const extracted = {
      doc_type: lease.doc_type, tenant_names: lease.tenant_names, landlord_name: lease.landlord_name, address: lease.address, unit: lease.unit,
      lease_start: lease.lease_start, lease_end: lease.lease_end, monthly_rent: lease.monthly_rent, rent_is_per_person: lease.rent_is_per_person,
      looks_edited: lease.looks_edited, notes: lease.notes,
    };
    const { error: ue } = await admin.from("lease_checks")
      .update({ result, reasons, extracted, ai_checked_at: new Date().toISOString() }).eq("id", check.id);
    if (ue) throw ue;

    // everything matched and auto-approve is on: give the badge now and delete the file
    if (result === "green" && settings?.auto_approve_green) {
      const { data: path, error: de } = await admin.rpc("lease_decide", { p_check: check.id, p_approve: true, p_note: null });
      if (de) throw de;
      if (path) {
        await admin.storage.from("lease-proofs").remove([path]);
        await admin.rpc("lease_file_deleted", { p_check: check.id });
      }
    }
    await cleanup(admin);
    return json({ ok: true, result, reasons });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function readLease(apiKey: string, file: Blob): Promise<Lease> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  const type = file.type || "application/pdf";
  const doc = type === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: (["image/png", "image/webp"].includes(type) ? type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp", data } };

  const client = new Anthropic({ apiKey });
  const msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [doc, { type: "text", text: PROMPT }] }],
  });
  if (msg.stop_reason === "refusal") throw new Error("The AI declined to read this file; check it by hand");
  const text = msg.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  return JSON.parse(text) as Lease;
}

/* ---------- compare what the lease says with the listing ---------- */
const ABBR: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", road: "rd", drive: "dr", lane: "ln", boulevard: "blvd", court: "ct", place: "pl", circle: "cir",
  terrace: "ter", parkway: "pkwy", south: "s", north: "n", east: "e", west: "w",
};
function addrKey(a: string | null | undefined) {
  const w = String(a ?? "").toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean).map((x) => ABBR[x] ?? x);
  const num = w.find((x) => /^\d+[a-z]?$/.test(x)) ?? "";
  const street = w.filter((x) => !/^\d/.test(x) && !["s", "n", "e", "w", "st", "ave", "rd", "dr", "ln", "blvd", "ct", "pl", "apt", "unit", "state", "college", "pa"].includes(x));
  return { num, street: street[0] ?? "" };
}
function sameAddr(a: string | null, b: string | null | undefined) {
  const x = addrKey(a), y = addrKey(b);
  return !!x.num && x.num === y.num && !!x.street && x.street === y.street;
}
const words = (n: string) => n.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 1);
function nameMatches(tenants: string[], contactName: string | null, email: string) {
  const first = (contactName ?? "").trim().toLowerCase().split(/\s+/)[0];
  // Penn State emails start with the student's initials, like abc1234 for Ann B. Cole
  const ini = (email.split("@")[0].match(/^[a-z]+/i)?.[0] ?? "").toLowerCase();
  return tenants.some((t) => {
    const w = words(t);
    if (!w.length) return false;
    if (first && first.length > 1 && w.includes(first)) return true;
    return ini.length >= 2 && w[0][0] === ini[0] && w[w.length - 1][0] === ini[ini.length - 1];
  });
}
const maxPrice = (p?: string) => Math.max(0, ...[...String(p ?? "").matchAll(/\$([\d,]+)/g)].map((m) => +m[1].replace(/,/g, "")));
const day = (d: string) => new Date(d + "T12:00:00Z").getTime();

// deno-lint-ignore no-explicit-any
function compare(l: Lease, s: any, b: Building | null, email: string) {
  const red: string[] = [], yellow: string[] = [];
  if (!l.readable) yellow.push("The file is hard to read");
  if (l.doc_type === "not_residence_proof") red.push("This isn't a lease or a bill");
  if (l.looks_edited) red.push("Parts of the document look edited");
  if (l.doc_type !== "not_residence_proof") {
    if (!l.address) yellow.push("No address found on the document");
    else if (!sameAddr(l.address, s.address) && !(b && sameAddr(l.address, b.address))) yellow.push(`Address on the document (${l.address}) doesn't match the listing (${s.address})`);
    if (!l.tenant_names.length) yellow.push("No tenant name found");
    else if (!nameMatches(l.tenant_names, s.contact_name, email)) yellow.push(`Name on the document doesn't match the poster (${email})`);
    if (l.doc_type === "lease") {
      if (l.lease_start && l.lease_end && (day(s.start_date) < day(l.lease_start) - 14 * 864e5 || day(s.end_date) > day(l.lease_end) + 14 * 864e5))
        yellow.push(`Sublet dates fall outside the lease (${l.lease_start} to ${l.lease_end})`);
      if (!l.lease_start || !l.lease_end) yellow.push("Lease dates not found");
      if (l.monthly_rent) {
        const per = l.rent_is_per_person === false && s.beds > 0 ? l.monthly_rent / s.beds : l.monthly_rent;
        const lo = b?.ppm ?? 0, hi = maxPrice(b?.price);
        if (s.space === "room" && lo && per < lo * 0.75) yellow.push(`Rent on the lease ($${Math.round(per)}/person) is well under ${b!.name}'s lowest price ($${lo})`);
        if (s.space === "room" && hi && per > hi * 1.3) yellow.push(`Rent on the lease ($${Math.round(per)}/person) is well over ${b!.name}'s highest price ($${hi})`);
        if (s.orig_price && Math.abs(per - s.orig_price) > Math.max(50, s.orig_price * 0.15)) yellow.push(`Poster says lease rent is $${s.orig_price}, the lease shows about $${Math.round(per)}`);
      } else yellow.push("Rent not found on the lease");
    }
  }
  const result = red.length ? "red" : yellow.length ? "yellow" : "green";
  // the AI's own remark is shown to you but doesn't change the color
  return { result, reasons: [...red, ...yellow, ...(l.notes ? [`AI note: ${l.notes}`] : [])] };
}

// Delete files that are done with (and expire proofs nobody checked within 30 days)
// deno-lint-ignore no-explicit-any
async function cleanup(admin: any) {
  const { data } = await admin.rpc("lease_files_to_delete");
  for (const r of data ?? []) {
    const { error } = await admin.storage.from("lease-proofs").remove([r.file_path]);
    if (!error) await admin.rpc("lease_file_deleted", { p_check: r.check_id });
  }
}
