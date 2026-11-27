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
  $("#app").innerHTML=`<div class="box"><form id="f1" class="stack"><label>Your admin psu.edu email<input name="email" type="email" required autocomplete="email"></label><p class="err" id="e" hidden></p><button class="btn primary">Send my code</button></form>
  <form id="f2" class="stack" hidden><label>Code from the email<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button class="btn primary">Sign in</button></form></div>`;
  let email="";const e=$("#e");
  $("#f1").onsubmit=async ev=>{ev.preventDefault();email=ev.target.email.value.trim().toLowerCase();e.hidden=true;
    const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
    if(error){e.textContent=error.message;e.hidden=false;return}$("#f1").hidden=true;$("#f2").hidden=false;$("#f2").code.focus()};
  $("#f2").onsubmit=async ev=>{ev.preventDefault();const {error}=await sb.auth.verifyOtp({email,token:ev.target.code.value.trim(),type:"email"});
    if(error){toast(error.message);return}location.reload()};
}

async function render(){
  const [{data:set},{data:rows,error}]=await Promise.all([sb.from("site_settings").select("*").eq("id",1).maybeSingle(),sb.rpc("lease_queue",{p_done:view==="done"})]);
  if(error){$("#app").innerHTML=`<p class="err">${esc(error.message)}</p>`;return}
  const s=set||{lease_proof_required:false,auto_approve_green:false};
  $("#app").innerHTML=`<div class="box sets">
    <label class="set"><input type="checkbox" id="req" ${s.lease_proof_required?"checked":""}><div><b>Require lease proof to post</b><span>Off: proof is optional, and listings with a checked proof get the Lease checked badge and rank first. On: every new post needs a proof and stays hidden until you approve it.</span></div></label>
    <label class="set"><input type="checkbox" id="auto" ${s.auto_approve_green?"checked":""}><div><b>Approve green checks automatically</b><span>When the AI finds the name, address, dates and rent all match, give the badge right away and delete the file. Yellow and red still wait for you.</span></div></label>
  </div>
  <div class="tabsw"><button data-v="open" aria-pressed="${view==="open"}">Waiting</button><button data-v="done" aria-pressed="${view==="done"}">Decided</button></div>
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

/* delete files that are done with; proofs nobody checked within 30 days are rejected first */
async function cleanup(){try{const {data}=await sb.rpc("lease_files_to_delete");
  for(const r of data||[]){const {error}=await sb.storage.from("lease-proofs").remove([r.file_path]);if(!error)await sb.rpc("lease_file_deleted",{p_check:r.check_id})}}catch(e){console.error(e)}}

start().catch(e=>{$("#app").innerHTML=`<p class="err">${esc(e.message)}</p>`});
})();
