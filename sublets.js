/* Happy Valley Housing: student sublets and lease takeovers.
   Data lives in Supabase when supabaseUrl/supabaseKey are set in config.js; otherwise demo mode (this browser only). */
(function(){
"use strict";
const CFG=window.HVH_CONFIG||{};
const DEMO=!(CFG.supabaseUrl&&CFG.supabaseKey);
const SUPABASE_JS="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js";
const OM={lat:40.79647,lng:-77.86279}; // Old Main
const PSU_RE=/^[^@\s]+@psu\.edu$/i;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>"$"+Number(n).toLocaleString("en-US");
function miles(a,b){const R=3958.8,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r,h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const distTxt=mi=>mi<1.2?Math.max(2,Math.round(mi*20))+" min walk":mi.toFixed(1)+" mi · bus";
const D=s=>new Date(s+"T12:00:00");
const iso=d=>d.toISOString().slice(0,10);
const today=()=>iso(new Date());
const dTxt=s=>D(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:D(s).getFullYear()!==new Date().getFullYear()?"numeric":undefined});
const months=(a,b)=>Math.max(1,Math.round((D(b)-D(a))/2629800000));
const bedsTxt=b=>b===0?"Studio":b+" bd";
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("on");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("on"),4200)}

/* ---------- seasons for the tabs ---------- */
function season(name){const y=new Date().getFullYear();const S={spring:["01-08","05-10"],summer:["05-12","08-15"],fall:["08-18","12-20"]}[name];
  let a=`${y}-${S[0]}`,b=`${y}-${S[1]}`;if(iso(new Date(D(b)-30*864e5))<today()){a=`${y+1}-${S[0]}`;b=`${y+1}-${S[1]}`}return {a,b,y:+a.slice(0,4)}}
const overlaps=(s,w)=>s.start_date<=w.b&&s.end_date>=w.a&&(Math.min(D(s.end_date),D(w.b))-Math.max(D(s.start_date),D(w.a)))>20*864e5;
const TABS=[
 {k:"all",label:"All sublets",f:()=>true,ico:'<path d="M3 11l9-7 9 7v9H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"spring",label:"Spring",f:s=>overlaps(s,season("spring")),ico:'<path d="M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"summer",label:"Summer",f:s=>overlaps(s,season("summer")),ico:'<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"fall",label:"Fall",f:s=>overlaps(s,season("fall")),ico:'<path d="M12 21v-5M12 16c-5 0-8-4-8-9 3 0 5 1 6 3 0-3 1-5 2-7 1 2 2 4 2 7 1-2 3-3 6-3 0 5-3 9-8 9z" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"takeover",label:"Lease takeovers",f:s=>s.kind==="takeover",ico:'<path d="M4 7h13l-3-3M20 17H7l3 3" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"unit",label:"Whole places",f:s=>s.space==="unit",ico:'<rect x="6" y="2.5" width="12" height="18.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M11 21v-3h2v3" stroke="currentColor" stroke-width="1.6"/>'},
];

/* ---------- buildings from the main site (for picking a building, coords and price checks) ---------- */
let BLD=[],bById={};
const bldPhotos=b=>(b?.photos||[]).map(p=>p.url);

/* ---------- verification badges and ranking ---------- */
const CHECK='<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function badges(s){const b=[{k:"psu",t:"Penn State student",d:"Posted from a confirmed @psu.edu email."}];
  if(s.lease_verified)b.push({k:"lease",t:"Lease checked",d:"We checked a lease or proof of residence for this address."});
  if((s.photos||[]).length>=4)b.push({k:"photos",t:"Real photos",d:"The poster uploaded their own photos of the place."});
  const bb=bById[s.building_id];if(bb&&!(bb.ppm&&s.space==="room"&&s.price<bb.ppm*0.45))b.push({k:"bldg",t:"Known building",d:"Matches a building on Happy Valley Housing, and the price fits that building."});
  return b}
function score(s){const age=(Date.now()-new Date(s.created_at||Date.now()))/864e5;
  return (s.lease_verified?40:0)+(s.building_id?12:0)+Math.min((s.photos||[]).length,6)*3+(s.has_lease_doc?4:0)-Math.min(age,60)*0.3}

/* client-side scam checks, shown as you type; the database runs the same checks again */
const SCAM=[
 {k:"payment",re:/(western union|moneygram|wire (the|a|me)|wire transfer|gift ?card|bitcoin|crypto|usdt|cashier.?s check|money order)/i,msg:"Asking for wire transfers, gift cards, crypto or money orders is the most common sublet scam. Listings that mention them wait for a manual review."},
 {k:"offsite",re:/(whats ?app|telegram|signal app|text me at|\bkik\b)/i,msg:"Moving the chat to WhatsApp or Telegram is a common scam sign. Students can contact you through the site."},
 {k:"story",re:/(out of (the )?(country|state)|overseas|abroad|military deploy|missionary|god bless|can.?t show|no viewing|keys? (will be )?(mailed|shipped|sent))/i,msg:"\"I'm away, I'll mail the keys\" is a classic scam story. If you can't show the place, say who can."},
 {k:"deposit",re:/(deposit|pay|payment).{0,40}(before|to hold|first|today)/i,msg:"Asking for money before a viewing or a signed agreement makes students wary, and the listing waits for review."},
 {k:"contact",re:/(\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b|[^\s@]+@(?!psu\.edu)[^\s@]+\.[a-z]{2,})/i,warn:true,msg:"Tip: leave phone numbers and outside emails out. Students reach you through your psu.edu email, which keeps scammers away."},
];
function scamCheck(s){const txt=[s.title,s.description,s.roommates].join(" ");const out=SCAM.filter(c=>c.re.test(txt)).map(c=>({k:c.k,msg:c.msg,warn:!!c.warn}));
  const b=bById[s.building_id];
  if(b&&b.ppm&&s.price&&s.space==="room"&&s.price<b.ppm*0.45)out.push({k:"price",msg:`${fmt(s.price)} is far below ${b.name}'s lowest rent (${fmt(b.ppm)} per person). Very low prices draw scam reports. Double-check it.`,warn:true});
  if(s.orig_price&&s.price<s.orig_price*0.35)out.push({k:"price",msg:"The price is under a third of your lease rent. If that's right, say why in the description.",warn:true});
  return out}

/* ---------- data layer ---------- */
const API=DEMO?demoApi():liveApi();
function demoApi(){
  const KEY="hvh-demo-sublets",UKEY="hvh-demo-user";
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){return[]}};
  const write=a=>{try{localStorage.setItem(KEY,JSON.stringify(a))}catch(e){}};
  let user=null;try{user=JSON.parse(localStorage.getItem(UKEY)||"null")}catch(e){}
  const listeners=[];const emit=()=>listeners.forEach(f=>f(user));
  const fileUrl=f=>new Promise(ok=>{const r=new FileReader();r.onload=()=>ok(r.result);r.readAsDataURL(f)});
  return {
    demo:true,
    onAuth(f){listeners.push(f);f(user)},
    async sendCode(email){return {ok:true}},
    async verify(email,code){if(!/^\d{6,10}$/.test(code))throw new Error("Type the code from the email");user={id:"demo-"+email,email};try{localStorage.setItem(UKEY,JSON.stringify(user))}catch(e){}emit()},
    async signOut(){user=null;try{localStorage.removeItem(UKEY)}catch(e){}emit()},
    async list(){return [...examples(),...read().filter(s=>s.status==="live"&&s.end_date>=today())]},
    async mine(){return user?read().filter(s=>s.user_id===user.id):[]},
    async post(row,photos,lease){
      const all=read();if(all.filter(s=>s.user_id===user.id&&["live","review"].includes(s.status)).length>=3)throw new Error("You already have 3 active sublets. Mark one as taken first.");
      const urls=[];for(const f of photos)urls.push(await fileUrl(await shrink(f,900,.7)));
      const flags=scamCheck(row).filter(c=>!c.warn).map(c=>c.k);
      const s={...row,id:Date.now(),created_at:new Date().toISOString(),user_id:user.id,photos:urls,has_lease_doc:!!lease,lease_verified:false,flags,status:flags.length?"review":"live",_email:user.email};
      all.push(s);try{write(all)}catch(e){throw new Error("This browser ran out of room for demo photos. Try fewer photos.")}return s},
    async setStatus(id,status){const all=read();const s=all.find(x=>x.id===id&&x.user_id===user?.id);if(s){if(status==="live"&&s.flags?.length)return;s.status=status;write(all)}},
    async remove(id){write(read().filter(x=>!(x.id===id&&x.user_id===user?.id)))},
    async contact(id){if(!user)throw new Error("Sign in first");const s=read().find(x=>x.id===id);return {email:s?._email||"example.student@psu.edu",contact_name:s?.contact_name||"Example student",unit:s?.unit||"Shown after sign-in"}},
    async report(id,reason){return true}
  };
}
function liveApi(){
  let sb=null,user=null;const listeners=[];
  const ready=(async()=>{await loadScript(SUPABASE_JS);sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
    sb.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;listeners.forEach(f=>f(user))});
    const {data}=await sb.auth.getSession();user=data.session?.user||null;listeners.forEach(f=>f(user))})();
  const need=()=>{if(!user)throw new Error("Sign in with your Penn State email first")};
  const err=e=>{if(e)throw new Error(e.message||String(e))};
  async function upload(bucket,f,max,q){const blob=f.type==="application/pdf"?f:await shrink(f,max,q);const ext=blob.type==="application/pdf"?"pdf":"jpg";
    const path=`${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const {error}=await sb.storage.from(bucket).upload(path,blob,{contentType:blob.type||"image/jpeg",upsert:false});err(error);
    return bucket==="sublet-photos"?sb.storage.from(bucket).getPublicUrl(path).data.publicUrl:path}
  return {
    demo:false,
    onAuth(f){listeners.push(f);if(sb)f(user)},
    async sendCode(email){await ready;const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});err(error);return {ok:true}},
    async verify(email,code){await ready;const {error}=await sb.auth.verifyOtp({email,token:code,type:"email"});err(error)},
    async signOut(){await ready;await sb.auth.signOut()},
    async list(){await ready;const {data,error}=await sb.from("sublets_public").select("*").limit(500);err(error);return data||[]},
    async mine(){await ready;if(!user)return[];const {data,error}=await sb.from("sublets").select("*").eq("user_id",user.id).order("created_at",{ascending:false});err(error);return data||[]},
    async post(row,photos,lease){await ready;need();
      const urls=[];for(const f of photos)urls.push(await upload("sublet-photos",f,1600,.82));
      if(lease)await upload("lease-proofs",lease,2000,.85);
      const {data,error}=await sb.from("sublets").insert({...row,photos:urls,has_lease_doc:!!lease}).select().single();err(error);return data},
    async setStatus(id,status){await ready;need();const {error}=await sb.from("sublets").update({status}).eq("id",id);err(error)},
    async remove(id){await ready;need();const {error}=await sb.from("sublets").delete().eq("id",id);err(error)},
    async contact(id){await ready;need();const {data,error}=await sb.rpc("sublet_contact",{sid:id});err(error);if(!data?.length)throw new Error("This sublet is no longer listed");return data[0]},
    async report(id,reason){await ready;need();const {error}=await sb.from("sublet_reports").insert({sublet_id:id,reason});if(error&&!/duplicate/i.test(error.message))err(error);return true}
  };
}
/* shrink a photo before upload so it loads fast and fits the free storage */
async function shrink(file,max,q){if(!/^image\//.test(file.type))return file;
  const url=URL.createObjectURL(file);try{const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=url});
    const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);return await new Promise(ok=>c.toBlob(b=>ok(b||file),"image/jpeg",q))}
  catch(e){return file}finally{URL.revokeObjectURL(url)}}

/* example listings for demo mode (fictional people; photos are the buildings' own, credited on the main site) */
function examples(){const t=new Date(),add=(d)=>iso(new Date(t.getTime()+d*864e5));const sp=season("spring"),su=season("summer"),fa=season("fall");
  const ex=[
   {b:2,kind:"sublet",space:"room",title:"Private room in a 2-bed at South Allen",beds:2,baths:1,price:525,orig:610,a:su.a,e:su.b,furn:true,util:false,room:"One roommate, a quiet senior in engineering.",desc:"Subletting my room for the summer while I'm on an internship. Fully furnished, 5 minutes from campus. Landlord allows sublets with their sublease form, which we'd both sign.",lease:true},
   {b:19,kind:"takeover",space:"room",title:"Lease takeover at Haus, 2027–28",beds:3,baths:3,price:1290,orig:1439,a:fa.a,e:`${fa.y+1}-07-31`,furn:true,util:true,room:"Two roommates, both juniors.",desc:"Taking over my spot in a 3-bed at Haus for next year. I'm studying abroad and the building has a lease-transfer process, so you'd sign directly with them. Own bathroom, internet and utilities included.",lease:true},
   {b:29,kind:"sublet",space:"room",title:"Spring room at The Station, bus at the door",beds:4,baths:4,price:640,orig:858,a:sp.a,e:sp.b,furn:true,util:true,room:"Three roommates.",desc:"Graduating in December so my room is open for spring semester. Furnished, utilities included, the CATA bus stops right outside. Happy to do a video call or show it in person."},
   {b:26,kind:"sublet",space:"unit",title:"Whole 1-bed downtown at Collegiate Arms",beds:1,baths:1,price:950,orig:1100,a:su.a,e:su.b,furn:false,util:false,room:"",desc:"My whole 1-bedroom for the summer, right by College Ave. Unfurnished but I can leave the bed and desk. Great for a summer class or internship in town."},
   {b:50,kind:"sublet",space:"room",title:"Room at Rise, steps from campus",beds:4,baths:4,price:1050,orig:1189,a:add(10),e:su.a,furn:true,util:true,room:"Three roommates, all sophomores.",desc:"Room available right away through the end of spring. Furnished with private bath. The pool and gym are included. I'm transferring, so I'm flexible on move-in.",lease:true},
   {b:8,kind:"takeover",space:"room",title:"Take over my Villas lease, summer + next year",beds:3,baths:3,price:780,orig:820,a:su.a,e:`${su.y+1}-07-31`,furn:true,util:false,room:"Two roommates.",desc:"Moving home to finish online, so I'm transferring my Villas lease. Private bedroom and bath in a townhouse-style unit with a washer and dryer."}
  ];
  return ex.map((x,i)=>{const b=bById[x.b];if(!b)return null;const ph=bldPhotos(b);return {id:-(i+1),example:true,created_at:new Date(t.getTime()-i*36e5*20).toISOString(),kind:x.kind,space:x.space,title:x.title,building_id:x.b,building_name:b.name,address:b.address,lat:b.lat,lng:b.lng,beds:x.beds,baths:x.baths,price:x.price,orig_price:x.orig,start_date:x.a,end_date:x.e,furnished:x.furn,utilities:x.util,roommates:x.room,description:x.desc,photos:ph.slice(i%3,i%3+5),photoCredit:b.site||(b.photos||[])[0]?.page,contact_name:"Example student",has_lease_doc:!!x.lease,lease_verified:!!x.lease,status:"live"}}).filter(Boolean)}

/* ---------- state + list ---------- */
let ALL=[],byId={},rows=[],USER=null;
const state={tab:"all",q:"",maxp:2000,from:"",sort:"best"};
function filtered(){const q=state.q.trim().toLowerCase();const tab=TABS.find(t=>t.k===state.tab);
  return ALL.filter(s=>tab.f(s)&&(!q||[s.title,s.address,s.building_name].join(" ").toLowerCase().includes(q))&&(state.maxp>=2000||s.price<=state.maxp)&&(!state.from||s.start_date<=state.from))
   .sort((a,b)=>state.sort==="price"?a.price-b.price:state.sort==="start"?a.start_date.localeCompare(b.start_date):state.sort==="new"?String(b.created_at).localeCompare(String(a.created_at)):score(b)-score(a))}
function renderTabs(){$("#tabs").innerHTML=`<a class="tab" href="./"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 11h2M11 11h2M15 11h2M7 15h2M11 15h2M15 15h2M6 7V4h12v3" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>All housing<span class="n">${BLD.length||""}</span></a><span class="tabsep" aria-hidden="true"></span>`+
  TABS.map(t=>`<button class="tab" role="tab" aria-selected="${state.tab===t.k}" data-k="${t.k}"><svg viewBox="0 0 24 24" aria-hidden="true">${t.ico}</svg>${t.label}${t.k==="spring"||t.k==="summer"||t.k==="fall"?" "+season(t.k).y:""}<span class="n">${ALL.filter(t.f).length}</span></button>`).join("")}
function photoOf(s,i=0){const u=(s.photos||[])[i];return u?`<img src="${esc(u)}" alt="${esc(s.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'nophoto',textContent:'Photo unavailable'}))">`:`<div class="nophoto">No photos yet</div>`}
function vrow(s){return `<div class="vrow">${badges(s).map(b=>`<span class="v v-${b.k}" title="${esc(b.d)}">${CHECK}${esc(b.t)}</span>`).join("")}</div>`}
function save(s){return s.orig_price&&s.orig_price>s.price?`<span class="save">${fmt(s.orig_price-s.price)} under lease</span>`:""}
function renderList(){rows=filtered();
  const tab=TABS.find(t=>t.k===state.tab);$("#count").textContent=`${rows.length} ${state.tab==="all"?"sublets":tab.label.toLowerCase()+(["spring","summer","fall"].includes(state.tab)?" sublets":"")} near Penn State`;
  $("#grid").innerHTML=rows.length?rows.map(s=>`<button class="card" data-id="${s.id}" aria-label="${esc(s.title)}, ${fmt(s.price)} a month">
    <div class="photo">${photoOf(s)}<span class="badge">${s.kind==="takeover"?"Lease takeover":"Sublet"}${s.example?" · Example":""}</span>${(s.photos||[]).length>1?`<span class="count">1 / ${s.photos.length}</span>`:""}</div>
    <div class="meta"><div class="t"><b>${esc(s.building_name||s.address)}</b><em>${distTxt(s.mi)}</em></div>
    <div class="s">${esc(s.title)}</div>
    <div class="s">${dTxt(s.start_date)} – ${dTxt(s.end_date)} · ${s.space==="unit"?"Whole place":"Room"} · ${bedsTxt(s.beds)}</div>
    <div class="p"><strong>${fmt(s.price)}</strong> / mo ${save(s)}</div>${vrow(s)}</div></button>`).join("")
   :`<div class="empty">${ALL.length?"No sublets match those filters. Try another season or a higher price.":`No sublets yet. <button class="linkbtn" id="firstpost">Be the first to post one.</button>`}</div>`;
  $("#firstpost")?.addEventListener("click",openPost);
  MAP.setRows(rows)}

/* ---------- detail ---------- */
let gi=0;
function open(id){const s=byId[id];if(!s)return;gi=0;MAP.select(id);const ph=s.photos||[];const b=bById[s.building_id];
  const vs=badges(s);
  $("#dlgbody").innerHTML=`<div class="hero" id="hero">${photoOf(s,0)}${ph.length>1?`<button class="nav prev" aria-label="Previous photo">‹</button><button class="nav next" aria-label="Next photo">›</button><span class="count" id="gcount">1 / ${ph.length}</span><button class="allph" id="allph">See all ${ph.length} photos</button>`:""}<button class="close" aria-label="Close">×</button></div>
  <div class="body"><div><span class="kind">${s.kind==="takeover"?"Lease takeover":"Sublet"} · ${s.space==="unit"?"Whole place":"Private room"}${s.example?" · Example listing":""}</span><h2>${esc(s.title)}</h2>
   <div class="addr">${esc(s.building_name?s.building_name+", ":"")}${esc(s.address)}, State College, PA · ${s.mi.toFixed(1)} mi from Old Main (${distTxt(s.mi)})</div></div>
  <div class="facts"><div class="fact"><span>Rent</span><b>${fmt(s.price)} / mo</b>${s.orig_price?`<small class="was">Lease rent ${fmt(s.orig_price)}</small>`:""}</div><div class="fact"><span>Dates</span><b>${dTxt(s.start_date)} – ${dTxt(s.end_date)}</b><small class="was">About ${months(s.start_date,s.end_date)} month${months(s.start_date,s.end_date)>1?"s":""}</small></div><div class="fact"><span>Unit</span><b>${bedsTxt(s.beds)}${s.baths?" · "+s.baths+" ba":""}</b></div><div class="fact"><span>Includes</span><b style="font-size:14px">${[s.furnished?"Furnished":"Unfurnished",s.utilities?"Utilities":"Utilities extra"].join(" · ")}</b></div></div>
  <div class="verif"><h3>Verified</h3><ul>${vs.map(v=>`<li class="v-${v.k}"><span class="vi">${CHECK}</span><div><b>${esc(v.t)}</b><span>${esc(v.d)}</span></div></li>`).join("")}${s.has_lease_doc&&!s.lease_verified?`<li class="pending"><span class="vi">…</span><div><b>Lease being checked</b><span>The poster sent proof of residence and we're reviewing it.</span></div></li>`:""}</ul></div>
  <p class="desc">${esc(s.description)}</p>
  ${s.roommates?`<p><b>Roommates:</b> ${esc(s.roommates)}</p>`:""}
  <div class="contact" id="contact"><button class="btn primary" id="contactbtn">${USER?"Contact "+esc(s.contact_name||"the poster"):"Sign in with your psu.edu email to contact"}</button>${b?`<a class="btn" href="./#b=${b.id}">See ${esc(b.name)}</a>`:""}<button class="btn ghost" id="reportbtn">Report</button></div>
  <div class="safety"><b>Stay safe.</b> See the place in person or on a live video call before you pay. Never pay by wire, gift card or crypto. Ask the landlord about their sublease or lease-transfer form, and sign it before you move in.</div>
  <div class="src">${s.example?`<span>Example listing for the demo. Photos belong to the building's owner or manager${s.photoCredit?` (<a href="${esc(s.photoCredit)}" target="_blank" rel="noopener">source</a>)`:""}.</span>`:`<span>Posted ${new Date(s.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})} by a Penn State student. Photos are the poster's own.</span>`}</div></div>`;
  const d=$("#dlg");if(!d.open)d.showModal();
  d.querySelector(".close").onclick=()=>d.close();
  const show=k=>{gi=(k+ph.length)%ph.length;const h=$("#hero");h.querySelector("img,.nophoto")?.remove();h.insertAdjacentHTML("afterbegin",photoOf(s,gi));const c=$("#gcount");if(c)c.textContent=`${gi+1} / ${ph.length}`};
  d.querySelector(".prev")?.addEventListener("click",()=>show(gi-1));d.querySelector(".next")?.addEventListener("click",()=>show(gi+1));
  d.querySelector("#allph")?.addEventListener("click",()=>lbOpen(ph,gi,s.title));
  $("#hero").addEventListener("click",e=>{if(e.target.tagName==="IMG")lbOpen(ph,gi,s.title)});
  $("#contactbtn").onclick=async()=>{if(!USER){openAuth(()=>open(id));return}
    try{const c=await API.contact(s.id);const subj=encodeURIComponent(`Your sublet: ${s.title}`);const body=encodeURIComponent(`Hi ${c.contact_name||""},\n\nI saw your sublet on Happy Valley Housing (${s.building_name||s.address}, ${dTxt(s.start_date)} – ${dTxt(s.end_date)}). Is it still available? When could I see it?\n\nThanks!`);
      $("#contact").insertAdjacentHTML("afterend",`<div class="reveal"><div><span>Email</span><b>${esc(c.email)}</b></div>${c.unit?`<div><span>Unit</span><b>${esc(c.unit)}</b></div>`:""}<a class="btn primary" href="mailto:${esc(c.email)}?subject=${subj}&body=${body}">Write an email</a></div>`);$("#contactbtn").disabled=true}
    catch(e){toast(e.message)}};
  $("#reportbtn").onclick=()=>{if(!USER){openAuth(()=>open(id));return}if(d.querySelector(".reportbox"))return;
    $("#contact").insertAdjacentHTML("afterend",`<form class="reportbox"><label>What's wrong?<select name="r"><option>Looks like a scam</option><option>Already taken</option><option>Wrong photos or details</option><option>Not a Penn State student</option><option>Something else</option></select></label><input name="x" placeholder="Details (optional)" maxlength="300"><button class="btn">Send report</button></form>`);
    d.querySelector(".reportbox").onsubmit=async e=>{e.preventDefault();const f=e.target;try{await API.report(s.id,(f.r.value+" "+f.x.value).trim());f.outerHTML=`<div class="reveal"><b>Thanks. We'll look at it.</b> Three reports hide a listing until it's checked.</div>`}catch(er){toast(er.message)}}}
}

/* ---------- sign in ---------- */
let afterAuth=null;
function openAuth(then){afterAuth=then||null;const d=$("#auth");
  $("#authbody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>Sign in with your Penn State email</h2>
  <p>Only students with a psu.edu email can post sublets or contact posters. That keeps scammers out. We send you a code, no password needed.</p>
  <form id="f1" class="stack"><label>Penn State email<input name="email" type="email" required autocomplete="email" placeholder="abc1234@psu.edu" inputmode="email"></label><p class="err" id="e1" hidden></p><button class="btn primary">Send my code</button></form>
  <form id="f2" class="stack" hidden><p id="sent"></p><label>Code from the email<input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}" placeholder="12345678"></label><p class="err" id="e2" hidden></p><button class="btn primary">Sign in</button><button type="button" class="linkbtn" id="back">Use a different email</button></form>
  ${API.demo?`<p class="fine">Demo mode: no email is sent. Use any @psu.edu address and type any 6 digits.</p>`:""}</div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  let email="";const f1=$("#f1"),f2=$("#f2");
  f1.onsubmit=async e=>{e.preventDefault();email=f1.email.value.trim().toLowerCase();const er=$("#e1");er.hidden=true;
    if(!PSU_RE.test(email)){er.textContent="Use your @psu.edu email, like abc1234@psu.edu.";er.hidden=false;return}
    const btn=f1.querySelector("button");btn.disabled=true;btn.textContent="Sending…";
    try{await API.sendCode(email);f1.hidden=true;f2.hidden=false;$("#sent").innerHTML=`We sent a code to <b>${esc(email)}</b>. Check your inbox and Junk. It can take a few minutes. You can also click the link in the email.`;f2.code.focus()}
    catch(x){er.textContent=/rate|limit|seconds/i.test(x.message)?"Too many codes asked for. Wait a minute, then try again.":x.message;er.hidden=false}finally{btn.disabled=false;btn.textContent="Send my code"}};
  f2.onsubmit=async e=>{e.preventDefault();const er=$("#e2");er.hidden=true;try{await API.verify(email,f2.code.value.trim());d.close();toast("Signed in as "+email);const t=afterAuth;afterAuth=null;t&&t()}catch(x){er.textContent=/expired|invalid/i.test(x.message)?"That code didn't work or has expired. Ask for a new one.":x.message;er.hidden=false}};
  $("#back").onclick=()=>{f2.hidden=true;f1.hidden=false}}

/* ---------- post a sublet ---------- */
let PICS=[];
function openPost(){if(!USER){openAuth(openPost);return}PICS=[];const d=$("#post");const t=today();
  $("#postbody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>Post a sublet</h2><p class="lead">Posting as <b>${esc(USER.email)}</b>. Listings with more checks show up higher.</p>
  <form id="pf" class="stack" novalidate>
   <fieldset class="seg"><legend>What are you offering?</legend><label><input type="radio" name="kind" value="sublet" checked><span><b>Sublet</b><small>Someone stays for part of your lease</small></span></label><label><input type="radio" name="kind" value="takeover"><span><b>Lease takeover</b><small>Someone takes over your lease</small></span></label></fieldset>
   <fieldset class="seg"><legend>Space</legend><label><input type="radio" name="space" value="room" checked><span><b>Private room</b><small>In a shared unit</small></span></label><label><input type="radio" name="space" value="unit"><span><b>Whole place</b><small>The whole unit</small></span></label></fieldset>
   <label>Building<input name="bname" list="bl" placeholder="Start typing, like The Rise or South Allen" autocomplete="off"><datalist id="bl">${BLD.map(b=>`<option value="${esc(b.name)}">`).join("")}</datalist><small class="hint" id="bhint">Pick your building from the list for the Known building check. Not listed? Type the street address below.</small></label>
   <div class="two"><label>Street address<input name="address" required maxlength="120" placeholder="123 W Beaver Ave"></label><label><span>Unit or apt # <small>(private)</small></span><input name="unit" maxlength="20" placeholder="Shown only to signed-in students"></label></div>
   <div class="three"><label>Bedrooms in unit<select name="beds">${[0,1,2,3,4,5,6].map(n=>`<option value="${n}"${n===2?" selected":""}>${n===0?"Studio":n}</option>`).join("")}</select></label><label>Bathrooms<select name="baths">${[1,1.5,2,2.5,3,4,5].map(n=>`<option>${n}</option>`).join("")}</select></label><label>Roommates<input name="roommates" maxlength="120" placeholder="2 roommates, both juniors"></label></div>
   <div class="two"><label>Your price per month<span class="money"><input name="price" type="number" min="50" max="6000" required inputmode="numeric" placeholder="650"></span></label><label><span>Your lease rent per month <small>(optional)</small></span><span class="money"><input name="orig_price" type="number" min="50" max="6000" inputmode="numeric" placeholder="800"></span></label></div>
   <div class="two"><label>Available from<input name="start_date" type="date" required min="${t}"></label><label>Until<input name="end_date" type="date" required min="${t}"></label></div>
   <div class="checks"><label><input type="checkbox" name="furnished" checked> Furnished</label><label><input type="checkbox" name="utilities"> Utilities included</label></div>
   <label>Title<input name="title" required minlength="4" maxlength="80" placeholder="Summer room at South Allen, 5 min to campus"></label>
   <label>Description<textarea name="description" required minlength="20" maxlength="2000" rows="5" placeholder="What's the place like, why are you subletting, does your landlord allow it, how can people see it?"></textarea></label>
   <label><span>Your first name <small>(shown on the listing)</small></span><input name="contact_name" maxlength="40" autocomplete="given-name"></label>
   <div class="upl"><div class="uplh"><b>Photos</b><small>Take them yourself. 4 or more earns the Real photos check. Up to 10.</small></div><div class="thumbs" id="thumbs"></div><label class="btn"><input type="file" id="pics" accept="image/*" multiple hidden>Add photos</label></div>
   <div class="upl"><div class="uplh"><b>Proof you live there</b> <small>(optional, private)</small><small>A photo or PDF of your lease's first page or a recent bill with your name and this address. Only we see it. Once checked, your listing gets the Lease checked badge and moves to the top.</small></div><label class="btn"><input type="file" id="lease" accept="image/*,application/pdf" hidden>Add lease proof</label><span id="leasename" class="fine"></span></div>
   <div id="warn" class="warn" hidden></div>
   <div class="earn" id="earn"></div>
   <p class="err" id="perr" hidden></p>
   <button class="btn primary big" id="pbtn">Post sublet</button>
   <p class="fine">By posting you confirm you live there or hold the lease, and that your landlord allows a sublet or transfer, or you'll get their approval first.</p>
  </form></div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  const f=$("#pf");let lease=null;
  const row=()=>{const b=BLD.find(x=>x.name.toLowerCase()===f.bname.value.trim().toLowerCase());return {kind:f.kind.value,space:f.space.value,building_id:b?.id||null,building_name:b?.name||null,address:f.address.value.trim(),unit:f.unit.value.trim()||null,beds:+f.beds.value,baths:+f.baths.value,price:+f.price.value||0,orig_price:+f.orig_price.value||null,start_date:f.start_date.value,end_date:f.end_date.value,furnished:f.furnished.checked,utilities:f.utilities.checked,roommates:f.roommates.value.trim()||null,title:f.title.value.trim(),description:f.description.value.trim(),contact_name:f.contact_name.value.trim()||null}};
  const refresh=()=>{const r=row();const w=scamCheck(r);$("#warn").hidden=!w.length;$("#warn").innerHTML=w.map(x=>`<p class="${x.warn?"tip":"stop"}">${esc(x.msg)}</p>`).join("");
    const got=[["Penn State student",true],["Known building",!!r.building_id],["Real photos",PICS.length>=4],["Lease checked",!!lease,"after we check your proof"]];
    $("#earn").innerHTML=`<b>Your listing's checks</b><ul>${got.map(([t,ok,note])=>`<li class="${ok?"ok":""}">${ok?CHECK:'<span class="dot"></span>'}${t}${ok&&note?` <small>${note}</small>`:""}</li>`).join("")}</ul>`};
  f.bname.addEventListener("change",()=>{const b=BLD.find(x=>x.name.toLowerCase()===f.bname.value.trim().toLowerCase());if(b){f.address.value=b.address;const[a,z]=b.beds;if(+f.beds.value<a||+f.beds.value>z)f.beds.value=String(Math.min(6,Math.max(a,2)));$("#bhint").textContent=`${b.name}: ${b.address}${b.ppm?`, from ${fmt(b.ppm)} per person`:""}.`}refresh()});
  f.start_date.addEventListener("change",()=>{f.end_date.min=f.start_date.value});
  f.addEventListener("input",refresh);
  $("#pics").onchange=e=>{for(const x of e.target.files){if(PICS.length>=10)break;if(/^image\//.test(x.type))PICS.push(x)}e.target.value="";drawThumbs();refresh()};
  function drawThumbs(){$("#thumbs").innerHTML=PICS.map((x,i)=>`<div class="th"><img src="${URL.createObjectURL(x)}" alt="Photo ${i+1}"><button type="button" data-i="${i}" aria-label="Remove photo ${i+1}">×</button></div>`).join("");}
  $("#thumbs").onclick=e=>{const b=e.target.closest("button[data-i]");if(b){PICS.splice(+b.dataset.i,1);drawThumbs();refresh()}};
  $("#lease").onchange=e=>{lease=e.target.files[0]||null;$("#leasename").textContent=lease?lease.name:"";refresh()};
  refresh();
  f.onsubmit=async e=>{e.preventDefault();const er=$("#perr");er.hidden=true;const r=row();
    const miss=[!r.address&&"street address",!r.price&&"price",!r.start_date&&"start date",!r.end_date&&"end date",r.title.length<4&&"title",r.description.length<20&&"description (20+ characters)"].filter(Boolean);
    if(miss.length){er.textContent="Please add: "+miss.join(", ")+".";er.hidden=false;return}
    if(r.end_date<=r.start_date){er.textContent="The end date has to be after the start date.";er.hidden=false;return}
    if(r.price<50||r.price>6000){er.textContent="Enter a monthly price between $50 and $6,000.";er.hidden=false;return}
    const btn=$("#pbtn");btn.disabled=true;btn.textContent=PICS.length?"Uploading photos…":"Posting…";
    try{const b=bById[r.building_id];let pos=b?{lat:b.lat,lng:b.lng}:await geocode(r.address);
      const s=await API.post({...r,lat:pos.lat,lng:pos.lng},PICS,lease);d.close();
      await load();toast(s.status==="review"?"Posted. A few words in your listing need a quick review before it shows.":"Your sublet is live.");if(s.status==="live"&&byId[s.id])open(s.id)}
    catch(x){er.textContent=x.message;er.hidden=false}finally{btn.disabled=false;btn.textContent="Post sublet"}}}
async function geocode(addr){try{const u=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&viewbox=-77.98,40.86,-77.75,40.73&bounded=1&q=${encodeURIComponent(addr+", State College, PA")}`;
  const r=await fetch(u,{headers:{"Accept":"application/json"}});const j=await r.json();if(j[0])return {lat:+j[0].lat,lng:+j[0].lon}}catch(e){}
  return {lat:OM.lat+(Math.random()-.5)*.004,lng:OM.lng+(Math.random()-.5)*.004}}

/* ---------- my sublets ---------- */
async function openMine(){const d=$("#mine");$("#minebody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>My sublets</h2><p class="lead">Signed in as <b>${esc(USER.email)}</b></p><div id="mylist" class="mylist">Loading…</div><div class="cta"><button class="btn primary" id="mpost">Post a sublet</button><button class="btn" id="mout">Sign out</button></div></div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  $("#mpost").onclick=()=>{d.close();openPost()};$("#mout").onclick=async()=>{await API.signOut();d.close();toast("Signed out")};
  const draw=async()=>{let my=[];try{my=await API.mine()}catch(e){$("#mylist").textContent=e.message;return}
    const ST={live:["Live","ok"],review:["Waiting for review","wait"],taken:["Taken","off"],removed:["Removed","off"]};
    $("#mylist").innerHTML=my.length?my.map(s=>{const st=s.end_date<today()?["Ended","off"]:ST[s.status]||[s.status,""];return `<div class="myrow"><div class="myimg">${photoOf(s)}</div><div class="myt"><b>${esc(s.title)}</b><span>${fmt(s.price)} / mo · ${dTxt(s.start_date)} – ${dTxt(s.end_date)}</span><span class="st st-${st[1]}">${st[0]}${s.lease_verified?" · Lease checked":s.has_lease_doc?" · Lease being checked":""}</span></div><div class="mya">${s.status==="live"?`<button class="btn" data-a="taken" data-id="${s.id}">Mark taken</button>`:s.status==="taken"?`<button class="btn" data-a="live" data-id="${s.id}">Relist</button>`:""}<button class="btn ghost" data-a="del" data-id="${s.id}">Delete</button></div></div>`}).join(""):`<p>You haven't posted a sublet yet.</p>`};
  $("#mylist").onclick=async e=>{const b=e.target.closest("button[data-a]");if(!b)return;const id=+b.dataset.id;
    if(b.dataset.a==="del"){if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to delete";return}await API.remove(id).catch(x=>toast(x.message))}
    else await API.setStatus(id,b.dataset.a).catch(x=>toast(x.message));await draw();load()};
  draw()}

/* ---------- photo viewer ---------- */
let LB={list:[],i:0,title:""};
function lbShow(){const d=$("#lb");d.querySelectorAll(".lbprev,.lbnext").forEach(b=>b.style.visibility=LB.list.length>1?"":"hidden");const u=LB.list[LB.i];d.querySelector(".lbimg").innerHTML=`<img src="${esc(u)}" alt="${esc(LB.title)} photo ${LB.i+1}" referrerpolicy="no-referrer">`;d.querySelector(".lbcap").textContent=`${LB.title} · ${LB.i+1} / ${LB.list.length}`;d.querySelector(".lbthumbs").innerHTML=LB.list.length>1?LB.list.map((x,k)=>`<button data-k="${k}" aria-current="${k===LB.i}"><img src="${esc(x)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join(""):""}
function lbOpen(list,i,title){if(!list.length)return;LB={list,i,title};const d=$("#lb");lbShow();if(!d.open)d.showModal()}
function lbStep(k){LB.i=(LB.i+k+LB.list.length)%LB.list.length;lbShow()}
function lbInit(){const d=$("#lb");d.querySelector(".lbclose").onclick=()=>d.close();d.querySelector(".lbprev").onclick=()=>lbStep(-1);d.querySelector(".lbnext").onclick=()=>lbStep(1);
  d.querySelector(".lbthumbs").addEventListener("click",e=>{const b=e.target.closest("button");if(b){LB.i=+b.dataset.k;lbShow()}});
  d.addEventListener("keydown",e=>{if(e.key==="ArrowLeft")lbStep(-1);if(e.key==="ArrowRight")lbStep(1)});d.addEventListener("click",e=>{if(e.target===d)d.close()})}

/* ---------- map: Google Maps when a key is set, otherwise OpenStreetMap ---------- */
function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=()=>no(new Error("Couldn't load "+src));document.head.appendChild(s)})}
function pinEl(s){const d=document.createElement("div");d.className="pin subpin"+(s.lease_verified?" ver":"");d.dataset.id=s.id;d.textContent=fmt(s.price);return d}
const clusterHtml=ls=>`${ls.length} sublets<small>from ${fmt(Math.min(...ls.map(s=>s.price)))}</small>`;
const MAP={ready:false,pending:null,setRows(r){this.pending=r;if(this.ready)this.impl.setRows(r)},select(id){if(this.ready)this.impl.select(id)},hot(id){if(this.ready)this.impl.hot(id)},fit(){if(this.ready)this.impl.fit()},resize(){if(this.ready)this.impl.resize?.()}};
function markReady(impl){MAP.impl=impl;MAP.ready=true;if(MAP.pending)impl.setRows(MAP.pending)}
const selPin=id=>{document.querySelectorAll(".pin.sel").forEach(e=>e.classList.remove("sel"));document.querySelector(`.pin[data-id="${id}"]`)?.classList.add("sel")};
const hotPin=id=>{document.querySelectorAll(".pin.hot").forEach(e=>e.classList.remove("hot"));if(id)document.querySelector(`.pin[data-id="${id}"]`)?.classList.add("hot")};
window.gm_authFailure=function(){MAP.ready=false;const m=$("#map");m.innerHTML="";m.removeAttribute("style");m.className="";initLeaflet().catch(e=>console.error(e))};
async function initGoogle(){window.__hvGoogleReady=()=>{};
  await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.googleMapsApiKey)}&v=weekly&libraries=marker&loading=async&callback=__hvGoogleReady`);
  await new Promise(r=>{const t=setInterval(()=>{if(window.google?.maps?.Map&&google.maps.marker){clearInterval(t);r()}},50)});
  await loadScript("https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js");
  const map=new google.maps.Map($("#map"),{center:OM,zoom:14,mapId:CFG.googleMapId||"DEMO_MAP_ID",clickableIcons:false,streetViewControl:true,mapTypeControl:false,fullscreenControl:false});
  let clusterer=null;const renderer={render:({count,markers:ms,position})=>{const d=document.createElement("div");d.className="cl";d.innerHTML=clusterHtml(ms.map(m=>byId[m.hvId]));return new google.maps.marker.AdvancedMarkerElement({position,content:d,zIndex:1000+count})}};
  markReady({setRows(r){clusterer?.clearMarkers();const ms=r.map(s=>{const m=new google.maps.marker.AdvancedMarkerElement({position:{lat:s.lat,lng:s.lng},content:pinEl(s),title:s.title});m.hvId=s.id;m.addListener("click",()=>open(s.id));return m});
      clusterer=new markerClusterer.MarkerClusterer({map,markers:ms,renderer,algorithmOptions:{radius:90,maxZoom:17}});this.fit(r)},
    fit(r=rows){if(!r.length){map.setCenter(OM);map.setZoom(14);return}const b=new google.maps.LatLngBounds();r.forEach(s=>b.extend({lat:s.lat,lng:s.lng}));map.fitBounds(b,48);if(r.length===1)google.maps.event.addListenerOnce(map,"idle",()=>map.setZoom(16))},
    select:selPin,hot:hotPin})}
async function initLeaflet(){await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js");
  const map=L.map("map").setView([OM.lat,OM.lng],14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  const icon=s=>L.divIcon({className:"hv",html:`<div class="hv-wrap">${pinEl(s).outerHTML}</div>`,iconSize:[0,0]});let group=null;
  markReady({setRows(r){if(group)map.removeLayer(group);group=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:50,disableClusteringAtZoom:18,spiderfyOnMaxZoom:true,iconCreateFunction:c=>L.divIcon({className:"hv",html:`<div class="hv-wrap"><div class="cl">${clusterHtml(c.getAllChildMarkers().map(m=>byId[m.hvId]))}</div></div>`,iconSize:[0,0]})});
      r.forEach(s=>{const m=L.marker([s.lat,s.lng],{icon:icon(s),title:s.title,riseOnHover:true});m.hvId=s.id;m.on("click",()=>open(s.id));group.addLayer(m)});map.addLayer(group);this.fit(r)},
    fit(r=rows){if(!r.length){map.setView([OM.lat,OM.lng],14);return}map.fitBounds(L.latLngBounds(r.map(s=>[s.lat,s.lng])),{padding:[40,40],maxZoom:16})},
    select:selPin,hot:hotPin,resize(){map.invalidateSize()}})}

/* ---------- wiring ---------- */
function headH(){document.documentElement.style.setProperty("--head",$("#head").offsetHeight+"px")}
function setAcct(){const b=$("#acctbtn");b.textContent=USER?"My sublets":"Sign in";b.title=USER?USER.email:""}
function wire(){
  $("#tabs").addEventListener("click",e=>{const b=e.target.closest("button.tab");if(!b)return;state.tab=b.dataset.k;renderTabs();renderList()});
  let qt;$("#q").addEventListener("input",e=>{clearTimeout(qt);qt=setTimeout(()=>{state.q=e.target.value;renderList()},150)});
  $("#maxp").addEventListener("input",e=>{state.maxp=+e.target.value;$("#maxpv").textContent=state.maxp>=2000?"Any":fmt(state.maxp);renderList()});
  $("#from").addEventListener("change",e=>{state.from=e.target.value;renderList()});
  $("#sort").addEventListener("change",e=>{state.sort=e.target.value;renderList()});
  $("#grid").addEventListener("click",e=>{const c=e.target.closest(".card");if(c)open(+c.dataset.id)});
  $("#grid").addEventListener("mouseover",e=>{const c=e.target.closest(".card");MAP.hot(c?.dataset.id)});
  $("#grid").addEventListener("mouseleave",()=>MAP.hot(null));
  $("#postbtn").onclick=openPost;
  $("#acctbtn").onclick=()=>USER?openMine():openAuth();
  $("#maptoggle").onclick=()=>{headH();document.body.classList.toggle("showmap");$("#maptoggle span").textContent=document.body.classList.contains("showmap")?"Show list":"Show map";if(document.body.classList.contains("showmap"))setTimeout(()=>{MAP.resize();MAP.fit()},30);else window.scrollTo(0,0)};
  ["#dlg","#auth","#post","#mine"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).close()}));
  window.addEventListener("resize",()=>{headH();MAP.resize()});headH();document.fonts?.ready.then(headH);
}
async function load(){try{ALL=await API.list()}catch(e){console.error(e);toast("Couldn't load sublets: "+e.message);ALL=[]}
  byId={};ALL.forEach(s=>{s.mi=miles(OM,s);byId[s.id]=s});renderTabs();renderList()}
async function start(){wire();lbInit();$("#demonote").hidden=!API.demo;
  try{BLD=await (await fetch("data/listings.json")).json();BLD.forEach(b=>bById[b.id]=b)}catch(e){console.error(e)}
  API.onAuth(u=>{const was=USER;USER=u;setAcct();if(!!was!==!!u&&ALL.length)renderList()});
  await load();
  try{if(CFG.googleMapsApiKey)await initGoogle();else await initLeaflet()}catch(e){console.error("Map failed, using OpenStreetMap",e);try{if(!MAP.ready)await initLeaflet()}catch(_){}}
  if(/[?&]post=1/.test(location.search))openPost();
}
start();
})();
