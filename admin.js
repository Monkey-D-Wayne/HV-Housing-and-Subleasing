/* Rhedr admin: review lease proofs and set the lease switches. Only emails in the Supabase "admins" table get in;
   the database checks that on every action, so this page holds no secrets. */
(function(){
"use strict";
const CFG=window.RHEDR_CONFIG||{};
const SUPABASE_JS="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>n==null||n===""?"–":"$"+Number(n).toLocaleString("en-US");
const dt=s=>s?new Date(String(s).length===10?s+"T12:00:00":s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"–";
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("on"),4200)}
const REJECT=["The name doesn't match your account. Send a lease or bill with your name on it.","The address doesn't match the listing.","We couldn't read the file. Send a clearer photo or the PDF.","This isn't a lease or a bill. Send the first page of your lease or a recent bill with your name and this address.","The sublet dates fall outside your lease."];
let sb,view="open";
// a link from the flag email: rhedr.com/admin?report=12 opens that chat report
const LINKED=+(new URLSearchParams(location.search).get("report")||0);if(LINKED)view="chats";

function load(src){return new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=()=>no(new Error("Couldn't load "+src));document.head.appendChild(s)})}

async function start(){
  if(!CFG.supabaseUrl||!CFG.supabaseKey){$("#app").innerHTML=`<p class="err">The sublets database isn't connected yet (config.js).</p>`;return}
  await load(SUPABASE_JS);
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
  $("#out").onclick=async()=>{await sb.auth.signOut();location.reload()};
  const {data}=await sb.auth.getSession();
  if(!data.session)return signIn();
  $("#out").hidden=false;
  const {data:ok}=await sb.rpc("is_admin");
  if(!ok){$("#app").innerHTML=`<div class="box"><p>You're signed in as <b>${esc(data.session.user.email)}</b>, which isn't on the admin list.</p><p class="fine">Add this email to the <b>admins</b> table in Supabase (see SUBLETS-SETUP.md), then reload.</p></div>`;return}
  cleanup();
  render();
}

function signIn(){
  $("#app").innerHTML=`<div class="box"><form id="f1" class="stack"><label>Your admin email (boaz@rhedr.com)<input name="email" type="email" required autocomplete="email"></label><p class="err" id="e" hidden></p><button class="btn primary">Send my code</button></form>
  <form id="f2" class="stack" hidden><label>Code from the email<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button class="btn primary">Sign in</button></form></div>`;
  let email="";const e=$("#e");
  $("#f1").onsubmit=async ev=>{ev.preventDefault();email=ev.target.email.value.trim().toLowerCase();e.hidden=true;
    const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
    if(error){e.textContent=error.message;e.hidden=false;return}$("#f1").hidden=true;$("#f2").hidden=false;$("#f2").code.focus()};
  $("#f2").onsubmit=async ev=>{ev.preventDefault();const {error}=await sb.auth.verifyOtp({email,token:ev.target.code.value.trim(),type:"email"});
    if(error){toast(error.message);return}location.reload()};
}

async function render(){
  if(view==="chats")return renderChats();
  const [{data:set},{data:rows,error}]=await Promise.all([sb.from("site_settings").select("*").eq("id",1).maybeSingle(),sb.rpc("lease_queue",{p_done:view==="done"})]);
  if(error){$("#app").innerHTML=`<p class="err">${esc(error.message)}</p>`;return}
  const s=set||{lease_proof_required:false,auto_approve_green:false};
  $("#app").innerHTML=`<div class="box sets">
    <label class="set"><input type="checkbox" id="req" ${s.lease_proof_required?"checked":""}><div><b>Require lease proof to post</b><span>Off: proof is optional, and listings with a checked proof get the Lease checked badge and rank first. On: every new post needs a proof and stays hidden until you approve it.</span></div></label>
    <label class="set"><input type="checkbox" id="auto" ${s.auto_approve_green?"checked":""}><div><b>Approve green checks automatically</b><span>When the AI finds the name, address, dates and rent all match, give the badge right away and delete the file. Yellow and red still wait for you.</span></div></label>
  </div>
  ${tabs()}
  <div id="list">${rows?.length?rows.map(card).join(""):`<p class="empty">${view==="open"?"Nothing waiting. Nice.":"Nothing decided yet."}</p>`}</div>`;
  const save=async()=>{const {error}=await sb.rpc("set_lease_settings",{p_required:$("#req").checked,p_auto_green:$("#auto").checked});toast(error?error.message:"Saved")};
  $("#req").onchange=save;$("#auto").onchange=save;
  document.querySelectorAll(".tabsw button").forEach(b=>b.onclick=()=>{view=b.dataset.v;render()});
  $("#list").onclick=onAction;
}

function card(r){
  const x=r.extracted||{};
  const lease=r.ai_checked_at?`<dl><dt>Type</dt><dd>${esc((x.doc_type||"").replace(/_/g," "))}</dd><dt>Names</dt><dd>${esc((x.tenant_names||[]).join(", ")||(r.decision?"(deleted)":"–"))}</dd><dt>Landlord</dt><dd>${esc(x.landlord_name||"–")}</dd><dt>Address</dt><dd>${esc([x.address,x.unit].filter(Boolean).join(", ")||"–")}</dd><dt>Term</dt><dd>${dt(x.lease_start)} – ${dt(x.lease_end)}</dd><dt>Rent</dt><dd>${fmt(x.monthly_rent)}${x.rent_is_per_person===false?" (whole unit)":x.monthly_rent?" per person":""}</dd></dl>`
    :`<p class="fine">Not read by the AI yet. Open the file and check it yourself, or press Read with AI.</p>`;
  return `<div class="chk" data-id="${r.check_id}"><div class="top"><div><h3>${esc(r.title)}</h3><div class="meta">${esc(r.email)} · sent ${dt(r.created_at)} · listing ${esc(r.status)}</div></div><span class="res res-${esc(r.result)}">${r.result==="waiting"?"Not read yet":esc(r.result)}</span></div>
   <div class="cols"><div><h4>The listing</h4><dl><dt>Building</dt><dd>${esc(r.building_name||"Not a listed building")}</dd><dt>Address</dt><dd>${esc([r.address,r.unit].filter(Boolean).join(", "))}</dd><dt>Dates</dt><dd>${dt(r.start_date)} – ${dt(r.end_date)}</dd><dt>Price</dt><dd>${fmt(r.price)} / mo${r.orig_price?` (says lease rent ${fmt(r.orig_price)})`:""}</dd><dt>Unit</dt><dd>${r.beds} bd · ${r.space==="unit"?"whole place":"room"}</dd><dt>First name</dt><dd>${esc(r.contact_name||"–")}</dd></dl></div>
   <div><h4>What the document says</h4>${lease}</div></div>
   ${r.reasons?.length?`<ul class="reasons">${r.reasons.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}
   ${r.decision?`<p class="meta" style="margin-top:12px"><b>${r.decision==="approved"?"Approved":"Rejected"}</b> ${dt(r.decided_at)}${r.note?` · "${esc(r.note)}"`:""}${r.file_path?"":" · file deleted"}</p>`
   :`<div class="acts">${r.file_path?`<button class="btn" data-a="file">Open file</button><button class="btn" data-a="ai">${r.ai_checked_at?"Read with AI again":"Read with AI"}</button>`:""}<button class="btn ok" data-a="yes">Approve</button>
     <select data-r aria-label="Reason to reject"><option value="">Reject because…</option>${REJECT.map(t=>`<option>${esc(t)}</option>`).join("")}<option value="_">Other (type it)</option></select><button class="btn" data-a="no">Reject</button></div>`}
  </div>`}

async function onAction(e){
  const b=e.target.closest("button[data-a]");if(!b)return;const c=b.closest(".chk"),id=+c.dataset.id;
  b.disabled=true;
  try{
    if(b.dataset.a==="file"){
      const {data:rows}=await sb.rpc("lease_queue",{p_done:false});const r=rows.find(x=>x.check_id===id);
      const {data,error}=await sb.storage.from("lease-proofs").createSignedUrl(r.file_path,300);if(error)throw error;window.open(data.signedUrl,"_blank","noopener")}
    if(b.dataset.a==="ai"){b.textContent="Reading…";
      const {data,error}=await sb.functions.invoke("check-lease",{body:{check_id:id}});
      if(error)throw new Error(/not found|404|Failed to send/i.test(error.message)?"The check-lease function isn't set up yet (see SUBLETS-SETUP.md).":error.message);
      if(data?.skipped)toast("Skipped: "+data.skipped);else toast("Result: "+data.result);await render()}
    if(b.dataset.a==="yes"||b.dataset.a==="no"){
      let note=null;
      if(b.dataset.a==="no"){const sel=c.querySelector("select[data-r]");note=sel.value==="_"?prompt("Reason shown to the poster:"):sel.value;if(!note){toast("Pick a reason first. The poster sees it.");return}}
      const {data:path,error}=await sb.rpc("lease_decide",{p_check:id,p_approve:b.dataset.a==="yes",p_note:note});if(error)throw error;
      if(path){const {error:de}=await sb.storage.from("lease-proofs").remove([path]);if(!de)await sb.rpc("lease_file_deleted",{p_check:id})}
      toast(b.dataset.a==="yes"?"Approved. The badge is on and the file is deleted.":"Rejected. The poster can send a new proof.");await render()}
  }catch(x){toast(x.message||String(x))}finally{b.disabled=false}
}

function tabs(){return `<div class="tabsw"><button data-v="open" aria-pressed="${view==="open"}">Waiting</button><button data-v="done" aria-pressed="${view==="done"}">Decided</button><button data-v="chats" aria-pressed="${view==="chats"}">Chat reports</button></div>`}

/* reported and flagged chats (supabase/messaging.sql). You only see a chat when a student reports it or Rhedr flags
   someone for trying to share contact info. "Limit" stops that student sending messages (they can still read). */
const CAUGHT={rule:"Hidden by a rule",split:"Sent in pieces",after_hidden:"Sent right after a hidden message",ai:"Caught by the AI check"};
let REPORTS=[];
async function renderChats(){
  const [{data:st},{data:rows,error}]=await Promise.all([sb.rpc("chat_stats"),sb.rpc("chat_report_queue",{p_done:false})]);
  if(error){$("#app").innerHTML=`${tabs()}<p class="err">${esc(/function|does not exist|column/i.test(error.message)?"Run supabase/messaging.sql again in the SQL Editor (see SUBLETS-SETUP.md), then reload.":error.message)}</p>`;wireTabs();return}
  REPORTS=rows||[];const x=st?.[0]||{};
  $("#app").innerHTML=`${tabs()}<p class="meta">${x.chats??0} chats so far · ${x.chats_7d??0} new and ${x.messages_7d??0} messages this week · ${x.agreed??0} agreed on Rhedr · ${x.masked_7d??0} messages had contact info hidden this week</p>
  <div id="list">${REPORTS.length?REPORTS.map(r=>`<div class="chk${r.report_id===LINKED?" linked":""}" data-rid="${r.report_id}" id="r${r.report_id}"><div class="top"><div><h3>${esc(r.sublet_title)}</h3><div class="meta">${r.auto?"Flagged":"Reported"} ${dt(r.created_at)} by ${esc(r.reporter)} · poster ${esc(r.poster)} · student ${esc(r.student)}${r.agreed_at?" · agreed":""}${r.closed_at?" · closed":""}</div></div></div>
    <div class="flagbar"><span>${r.auto?"Flagged":"Reported"}: <b>${esc(r.flagged_email||"unknown")}</b> · the ${esc(r.flagged_role)}${r.flagged_limited?` <span class="res res-red">Limited</span>`:""}</span>
      <span class="fb"><button class="btn ${r.flagged_limited?"":"danger"}" data-c="${r.flagged_limited?"unlimit":"limit"}">${r.flagged_limited?"Unlimit":"Limit"}</button><button class="btn" data-c="why">Why ${r.auto?"flagged":"reported"}?</button></span></div>
    <p><b>Reason:</b> ${esc(r.reason)}</p>
    <div class="chatlog">${(r.messages||[]).map(m=>`<div><b>${esc(m.from)}</b> <span class="meta">${dt(m.at)}${m.masked?" · contact hidden":""}</span><br>${esc(m.body)}</div>`).join("")}</div>
    <div class="acts"><button class="btn" data-c="ok">Done, nothing to do</button><button class="btn" data-c="close">Close the chat</button></div></div>`).join(""):`<p class="empty">No reported or flagged chats. Nice.</p>`}</div>`;
  wireTabs();
  $("#list").onclick=async e=>{const b=e.target.closest("button[data-c]");if(!b)return;const id=+b.closest("[data-rid]").dataset.rid;const r=REPORTS.find(x=>x.report_id===id);const c=b.dataset.c;
    if(c==="why")return showWhy(r);
    b.disabled=true;
    if(c==="limit"||c==="unlimit"){const {error}=await sb.rpc("chat_limit",{p_user:r.flagged_id,p_limit:c==="limit",p_reason:r.reason});
      toast(error?error.message:c==="limit"?`${r.flagged_email} can't send messages now. Tap Unlimit to undo.`:`${r.flagged_email} can send messages again.`);return renderChats()}
    const {error}=await sb.rpc("chat_report_resolve",{p_report:id,p_close:c==="close"});toast(error?error.message:c==="close"?"Chat closed":"Marked done");renderChats()};
  if(LINKED){const r=REPORTS.find(x=>x.report_id===LINKED);const el=$("#r"+LINKED);if(el)el.scrollIntoView({block:"center"});if(r&&!showWhy.done){showWhy.done=true;showWhy(r)}}
}
/* the pop-up: what the hidden messages really said (only admins can see this), when, and what caught them */
function showWhy(r){let d=$("#why");if(!d){d=document.createElement("dialog");d.id="why";document.body.appendChild(d)}
  const w=(r.why||[]).slice().sort((a,b)=>(b.flagged-a.flagged)||String(a.at).localeCompare(String(b.at)));
  const when=s=>new Date(s).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  d.innerHTML=`<button class="x" aria-label="Close">×</button><h2>Why ${esc(r.flagged_email||"this student")} was ${r.auto?"flagged":"reported"}</h2>
    <p class="meta">${esc(r.reason)}</p>
    ${w.length?`<p class="meta">What Rhedr hid in this chat, as they actually typed it (students never see this):</p><div class="whylist">${w.map(m=>`<div class="${m.flagged?"":"other"}"><span class="meta">${when(m.at)} · ${esc(m.from)} · ${esc(CAUGHT[m.caught_by]||m.caught_by)}</span><br><b>${esc(m.original)}</b></div>`).join("")}</div>`
      :`<p class="meta">No hidden messages saved for this chat (it was reported by a student, or the messages were hidden before Rhedr started keeping them). The chat itself is on the report.</p>`}
    <div class="acts"><button class="btn ${r.flagged_limited?"":"danger"}" data-l="${r.flagged_limited?0:1}">${r.flagged_limited?"Unlimit":"Limit"} ${esc(r.flagged_email||"")}</button><button class="btn" data-l="close">Close</button></div>`;
  d.querySelector(".x").onclick=()=>d.close();
  d.querySelector(".acts").onclick=async e=>{const b=e.target.closest("button[data-l]");if(!b)return;if(b.dataset.l==="close")return d.close();b.disabled=true;
    const lim=b.dataset.l==="1";const {error}=await sb.rpc("chat_limit",{p_user:r.flagged_id,p_limit:lim,p_reason:r.reason});
    toast(error?error.message:lim?`${r.flagged_email} can't send messages now.`:`${r.flagged_email} can send messages again.`);d.close();renderChats()};
  d.showModal()}
function wireTabs(){document.querySelectorAll(".tabsw button").forEach(b=>b.onclick=()=>{view=b.dataset.v;render()})}

/* delete files that are done with; proofs nobody checked within 30 days are rejected first */
async function cleanup(){try{const {data}=await sb.rpc("lease_files_to_delete");
  for(const r of data||[]){const {error}=await sb.storage.from("lease-proofs").remove([r.file_path]);if(!error)await sb.rpc("lease_file_deleted",{p_check:r.check_id})}}catch(e){console.error(e)}}

start().catch(e=>{$("#app").innerHTML=`<p class="err">${esc(e.message)}</p>`});
})();
