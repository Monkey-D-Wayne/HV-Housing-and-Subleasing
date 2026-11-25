/* Happy Valley Housing: listings, filters, map and detail view. */
(function(){
"use strict";
const CFG=window.HVH_CONFIG||{};
const OCP="https://livingoffcampus.psu.edu/housing/campus-Penn+State+University";
const PSU="https://liveon.psu.edu/university-park/rates";
const OM={lat:40.79647,lng:-77.86279}; // Old Main
const TYPES=[
 {k:"all",label:"All places",ico:'<path d="M3 11l9-7 9 7v9H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 20v-6h6v6" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"complex",label:"Student complexes",ico:'<rect x="3" y="7" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 11h2M11 11h2M15 11h2M7 15h2M11 15h2M15 15h2M10 21v-3h4v3M6 7V4h12v3" stroke="currentColor" stroke-width="1.6" fill="none"/>'},
 {k:"apartment",label:"Apartments",ico:'<rect x="6" y="2.5" width="12" height="18.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M9 14h2M13 14h2M11 21v-3h2v3" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"townhouse",label:"Townhouses",ico:'<path d="M2 21V11l5-5 5 5v10M12 21V11l5-5 5 5v10M1 21h22" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"room",label:"Rooms",ico:'<path d="M3 19v-7h18v7M3 15h18M6 12V9h5v3" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"dorm",label:"Dorms",ico:'<path d="M2 21h20M4 21V9l8-5 8 5v12M8 21v-5h8v5M8 12h2M14 12h2" fill="none" stroke="currentColor" stroke-width="1.6"/>'}
];
const TLABEL={complex:"Student complex",apartment:"Apartment",townhouse:"Townhouse",room:"Room",dorm:"Penn State dorm"};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>"$"+Number(n).toLocaleString("en-US");
function miles(a,b){const R=3958.8,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r,h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const distTxt=l=>l.mi<1.2?Math.max(2,Math.round(l.mi*20))+" min walk":l.mi.toFixed(1)+" mi · bus";
function bedsTxt(l){const[a,b]=l.beds;const f=x=>x===0?"Studio":x+" bd";return a===b?f(a):f(a)+"–"+b+" bd"}
const priceTxt=l=>l.ppm==null?"Ask for pricing":(l.est?"~":"")+fmt(l.ppm);
const pinTxt=l=>l.ppm==null?"Ask":(l.est?"~":"")+fmt(l.ppm);
const gmaps=l=>"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(`${l.name}, ${l.address}, State College, PA`);
const street=l=>`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${l.lat},${l.lng}`;
function host(u){try{return new URL(u).hostname.replace(/^www\./,"")}catch(e){return""}}

/* illustration used when a building has no photo yet */
const SKY=[["#9ec5ff","#e8f1ff"],["#ffc9a8","#ffeede"],["#b7e0d2","#eefaf5"],["#c9c2ff","#f1efff"],["#ffd98a","#fff7e3"]];
const WALL={complex:["#d8dde6","#b9c2d0","#e9e2d4"],apartment:["#c97b5b","#a9a39a","#7f8ea3"],townhouse:["#e6d3b3","#c9d6c2","#d9c4c4"],room:["#e9e0cf","#cfd9e3","#d8cfe6"],dorm:["#b5644a","#a65a43","#c07257"]};
function art(l,w=400,h=380){
  const s=SKY[l.id%SKY.length],wc=WALL[l.type][l.id%3],g="g"+l.id+"_"+w;
  let b="";const win=(x,y,ww,hh,c)=>`<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="2" fill="${c}"/>`;
  const lit=i=>((i*7+l.id*3)%5===0)?"#ffe9a6":"#3e4b60";const gy=h*0.82;
  if(l.type==="apartment"){const tw=w*0.36,x=w*0.32,top=h*(0.12+(l.id%3)*0.05);b+=`<rect x="${x}" y="${top}" width="${tw}" height="${gy-top}" fill="${wc}"/>`;let i=0;for(let y=top+18;y<gy-30;y+=30)for(let c=0;c<4;c++)b+=win(x+12+c*(tw-24)/4,y,(tw-24)/4-8,18,lit(i++));}
  else if(l.type==="complex"){const top=h*0.36;b+=`<rect x="${w*0.06}" y="${top}" width="${w*0.88}" height="${gy-top}" fill="${wc}"/>`;let i=0;for(let y=top+16;y<gy-26;y+=28)for(let c=0;c<9;c++)b+=win(w*0.1+c*w*0.092,y,w*0.06,16,lit(i++));}
  else if(l.type==="townhouse"||l.type==="room"){const n=l.type==="room"?1:3,uw=w*0.8/n;for(let k=0;k<n;k++){const x=w*0.1+k*uw,top=h*0.42;b+=`<rect x="${x}" y="${top}" width="${uw-6}" height="${gy-top}" fill="${WALL.townhouse[(l.id+k)%3]}"/><path d="M${x-6} ${top} L${x+(uw-6)/2} ${top-h*0.16} L${x+uw} ${top} Z" fill="#5b4a43"/>`+win(x+uw*0.15,top+22,uw*0.25,26,lit(k))+win(x+uw*0.55,top+22,uw*0.25,26,lit(k+2));}}
  else{const top=h*0.34;b+=`<rect x="${w*0.1}" y="${top}" width="${w*0.8}" height="${gy-top}" fill="${wc}"/><path d="M${w*0.08} ${top} L${w*0.5} ${top-h*0.12} L${w*0.92} ${top} Z" fill="#4a4f5c"/>`;let i=0;for(let y=top+16;y<gy-26;y+=30)for(let c=0;c<7;c++)b+=win(w*0.15+c*w*0.1,y,w*0.06,20,i++%4===1?"#ffe9a6":"#f3efe6");}
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s[0]}"/><stop offset="1" stop-color="${s[1]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${g})"/>${b}<rect y="${gy}" width="${w}" height="${h-gy}" fill="#8fb38f"/></svg>`;
}
// swap in the illustration if a remote photo fails to load
window.hvImgFail=function(img){const l=byId[+img.dataset.id];if(!l)return;const box=img.parentNode;img.remove();box.insertAdjacentHTML("afterbegin",art(l));const t=box.querySelector(".ptag span");if(t)t.textContent="Illustration · photo unavailable";const c=box.querySelector(".count");if(c)c.remove()};
function pic(l,i=0){const p=(l.photos||[])[i];return p?`<img src="${esc(p.url)}" alt="${esc(l.name)}" loading="lazy" referrerpolicy="no-referrer" data-id="${l.id}" onerror="hvImgFail(this)">`:art(l)}
function ptag(l){const p=(l.photos||[])[0];return p?`<div class="ptag"><span>Photo: ${esc(host(p.page||p.url))}</span></div>`:`<div class="ptag"><span>Illustration · no photo yet</span></div>`}

/* state */
let ALL=[],byId={},rows=[];
const state={type:"all",q:"",maxp:2000,beds:0,sort:"dist",sel:null};
try{const t=localStorage.getItem("hvh-type");if(t&&TYPES.some(x=>x.k===t))state.type=t}catch(e){}
function filtered(){
  const q=state.q.trim().toLowerCase();
  return ALL.filter(l=>(state.type==="all"||l.type===state.type)
    &&(!q||(l.name+" "+l.address).toLowerCase().includes(q))
    &&(state.maxp>=2000||(l.ppm!=null&&l.ppm<=state.maxp))
    &&(state.beds===0||(state.beds===4?l.beds[1]>=4:(state.beds===1?l.beds[0]<=1:l.beds[0]<=state.beds&&l.beds[1]>=state.beds))))
   .sort((a,b)=>state.sort==="price"?(a.ppm??9e9)-(b.ppm??9e9):state.sort==="name"?a.name.localeCompare(b.name):a.mi-b.mi);
}
function renderTabs(){
  $("#tabs").innerHTML=TYPES.map(t=>{const n=t.k==="all"?ALL.length:ALL.filter(l=>l.type===t.k).length;return `<button class="tab" role="tab" aria-selected="${state.type===t.k}" data-k="${t.k}"><svg viewBox="0 0 24 24" aria-hidden="true">${t.ico}</svg>${t.label}<span class="n">${n}</span></button>`}).join("");
}
function renderList(){
  rows=filtered();
  const tl=state.type==="all"?"places":TYPES.find(t=>t.k===state.type).label.toLowerCase();
  $("#count").textContent=`${rows.length} ${tl} near Penn State`;
  $("#grid").innerHTML=rows.length?rows.map(l=>`<button class="card" data-id="${l.id}" aria-label="${esc(l.name)}, ${esc(l.price)}">
    <div class="photo">${pic(l)}<span class="badge">${TLABEL[l.type]}</span>${ptag(l)}${(l.photos||[]).length>1?`<span class="count">1 / ${l.photos.length}</span>`:""}</div>
    <div class="meta"><div class="t"><b>${esc(l.name)}</b><em>${distTxt(l)}</em></div>
    <div class="s">${esc(l.address)} · ${bedsTxt(l)}</div>
    <div class="p"><strong>${priceTxt(l)}</strong>${l.ppm==null?"":" per person / mo"+(l.semester?" equiv.":"")}</div>${(l.plans||[]).length?`<div class="fp">${l.plans.length} floor plan${l.plans.length>1?"s":""}</div>`:""}</div></button>`).join("")
   :`<div class="empty">Nothing matches those filters. Try a higher price, another bedroom count or a different search.</div>`;
  MAP.setRows(rows);
}

/* detail view */
const bdTxt=b=>b===0||b==="0"||/studio/i.test(b??"")?"Studio":b!=null&&b!==""?b+" bd":"";
function planImgs(p){return [p.img,...(p.photos||[])].filter(Boolean)}
function plansHtml(l){
  const ps=l.plans||[];if(!ps.length)return "";
  const beds=[...new Set(ps.map(p=>bdTxt(p.beds)).filter(Boolean))];
  const chips=ps.length>3&&beds.length>1?`<div class="pchips" role="group" aria-label="Filter floor plans">${["All",...beds].map((b,i)=>`<button class="chip" aria-pressed="${i===0}" data-b="${esc(b)}">${esc(b)}</button>`).join("")}</div>`:"";
  const card=(p,k)=>{const im=planImgs(p);const spec=[bdTxt(p.beds),p.baths!=null&&p.baths!==""?p.baths+" ba":"",p.sqft?p.sqft+" sq ft":""].filter(Boolean).join(" · ");
    const rates=(p.rates||[]).map(r=>`<li><span>${r.n===1?"1 person":r.n+" people"}</span><b>${fmt(r.pp)}${r.n>1?"<small> each</small>":""}</b>${r.was&&r.was>r.pp?`<s>${fmt(r.was)}</s>`:""}</li>`).join("");
    return `<article class="plan${p.status?" out":""}" data-b="${esc(bdTxt(p.beds))}">
    <button class="pimg" data-k="${k}" ${im.length?"":"disabled"} aria-label="See ${esc(p.name)} photos">${im.length?`<img src="${esc(im[0])}" alt="${esc(p.name)} floor plan" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg');this.remove()">`:""}${im.length>1?`<span class="pcount">${im.length} photos</span>`:""}${p.status?`<span class="pstat">${esc(p.status)}</span>`:""}</button>
    <div class="pbody"><h4>${esc(p.name)}</h4><div class="pspec">${esc(spec)}</div>
    ${rates?`<ul class="rates">${rates}</ul>`:`<div class="pprice">${esc(p.price||"Ask for pricing")}</div>`}
    ${p.lease?`<div class="plea">${esc(p.lease)} lease</div>`:""}${p.page?`<a href="${esc(p.page)}" target="_blank" rel="noopener">See this plan on ${esc(host(p.page))}</a>`:""}</div></article>`};
  return `<div class="plans"><h3>Floor plans <span>${ps.length}</span></h3>${chips}<div class="pgrid">${ps.map(card).join("")}</div><p class="fine">Prices are per person per month, by how many people share the unit, as listed on the building's website on Nov 25, 2026. Confirm with the building before signing.</p></div>`;
}
/* full-screen photo viewer */
let LB={list:[],i:0,title:""};
function lbShow(){const d=$("#lb");d.querySelectorAll(".lbprev,.lbnext").forEach(b=>b.style.visibility=LB.list.length>1?"":"hidden");const u=LB.list[LB.i];d.querySelector(".lbimg").innerHTML=`<img src="${esc(u)}" alt="${esc(LB.title)} photo ${LB.i+1}" referrerpolicy="no-referrer">`;d.querySelector(".lbcap").textContent=`${LB.title} · ${LB.i+1} / ${LB.list.length}`;d.querySelector(".lbthumbs").innerHTML=LB.list.length>1?LB.list.map((x,k)=>`<button data-k="${k}" aria-current="${k===LB.i}"><img src="${esc(x)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join(""):"";d.querySelector('.lbthumbs [aria-current="true"]')?.scrollIntoView({block:"nearest",inline:"center"})}
function lbOpen(list,i,title){if(!list.length)return;LB={list,i,title};const d=$("#lb");lbShow();if(!d.open)d.showModal()}
function lbStep(k){LB.i=(LB.i+k+LB.list.length)%LB.list.length;lbShow()}
let gi=0;
function open(id){
  const l=byId[id];if(!l)return;state.sel=id;gi=0;MAP.select(id);
  const per=l.ppm==null?"Ask":l.semester?`${fmt(l.ppm)} / mo equivalent`:`${l.est?"~":""}${fmt(l.ppm)} / mo`;
  const ph=l.photos||[];
  const credit=ph.length?`Photos: ${ph.map(p=>`<a href="${esc(p.page||p.url)}" target="_blank" rel="noopener">${esc(host(p.page||p.url))}</a>`).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}. Photos belong to the building's owner or manager.`:"No photo of this building yet. The picture is an illustration.";
  const priceSrc=l.source==="psu"?`Penn State Housing 2026–27 rates (<a href="${PSU}" target="_blank" rel="noopener">liveon.psu.edu</a>)`:l.source==="ocp"?`Penn State Off-Campus Housing (<a href="${OCP}" target="_blank" rel="noopener">livingoffcampus.psu.edu</a>)`:l.source==="site"&&l.site?`the building's website (<a href="${esc(l.site)}" target="_blank" rel="noopener">${esc(host(l.site))}</a>)`:"public listing sites";
  $("#dlgbody").innerHTML=`<div class="hero" id="hero">${pic(l,0)}${ph.length>1?`<button class="nav prev" aria-label="Previous photo">‹</button><button class="nav next" aria-label="Next photo">›</button><span class="count" id="gcount">1 / ${ph.length}</span><button class="allph" id="allph">See all ${ph.length} photos</button>`:""}<button class="close" aria-label="Close">×</button></div>
  <div class="body"><div><span class="kind">${TLABEL[l.type]}</span><h2>${esc(l.name)}</h2><div class="addr">${esc(l.address)}, State College, PA · ${l.mi.toFixed(1)} mi from Old Main (${distTxt(l)})</div></div>
  <div class="facts"><div class="fact"><span>Listed price</span><b style="font-size:14px">${esc(l.price)}</b></div><div class="fact"><span>Per person, from</span><b>${per}</b></div><div class="fact"><span>Bedrooms</span><b>${bedsTxt(l)}</b></div><div class="fact"><span>Lease</span><b>${l.source==="psu"?"Academic year":(/(\d+)-month/.exec(l.price)?.[0]||"Ask")}</b></div></div>
  <p>${l.source==="psu"?"Penn State campus housing. Rates are per person and include utilities. Most residence halls require the Campus Meal Plan; Nittany and White Course Apartments do not.":(l.ppm==null?"Pricing isn't posted publicly. Contact the building for current rates.":l.est?"Price is listed for the whole unit. The per-person figure assumes the unit is fully shared.":l.source==="site"&&(l.plans||[]).some(p=>p.rates)?"Prices are per person and depend on how many people share the unit. Each floor plan below shows its price for every group size.":"Price is listed per bedroom.")}</p>
  ${plansHtml(l)}
  <div class="cta">${l.site?`<a class="btn primary" href="${esc(l.site)}" target="_blank" rel="noopener">Visit ${esc(host(l.site))}</a>`:l.source==="psu"?`<a class="btn primary" href="${PSU}" target="_blank" rel="noopener">See Penn State rates</a>`:`<a class="btn primary" href="${OCP}" target="_blank" rel="noopener">Find it on Penn State Off-Campus</a>`}
  <a class="btn" href="${gmaps(l)}" target="_blank" rel="noopener">Open in Google Maps</a><a class="btn" href="${street(l)}" target="_blank" rel="noopener">Street View</a></div>
  <div class="src"><span>Price source: ${priceSrc}, checked Nov 25, 2026.</span><span>${credit}</span></div></div>`;
  const d=$("#dlg");if(!d.open)d.showModal();
  d.querySelector(".close").onclick=()=>d.close();
  const show=k=>{gi=(k+ph.length)%ph.length;const h=$("#hero");h.querySelector("img,svg")?.remove();h.insertAdjacentHTML("afterbegin",pic(l,gi));const c=$("#gcount");if(c)c.textContent=`${gi+1} / ${ph.length}`};
  d.querySelector(".prev")?.addEventListener("click",()=>show(gi-1));d.querySelector(".next")?.addEventListener("click",()=>show(gi+1));
  const urls=ph.map(p=>p.url);
  d.querySelector("#allph")?.addEventListener("click",()=>lbOpen(urls,gi,l.name));
  $("#hero").addEventListener("click",e=>{if(e.target.tagName==="IMG")lbOpen(urls,gi,l.name)});
  d.querySelectorAll(".plan .pimg").forEach(b=>b.addEventListener("click",()=>{const p=l.plans[+b.dataset.k];lbOpen(planImgs(p),0,`${l.name}: ${p.name}`)}));
  d.querySelectorAll(".pchips .chip").forEach(c=>c.addEventListener("click",()=>{d.querySelectorAll(".pchips .chip").forEach(x=>x.setAttribute("aria-pressed",x===c));d.querySelectorAll(".plan").forEach(pl=>pl.hidden=c.dataset.b!=="All"&&pl.dataset.b!==c.dataset.b)}));
}

/* map: Google Maps when a key is set, otherwise OpenStreetMap via Leaflet */
function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=no;document.head.appendChild(s)})}
function pinEl(l){const d=document.createElement("div");d.className="pin"+(l.type==="dorm"?" dorm":"");d.dataset.id=l.id;d.textContent=pinTxt(l);return d}
function clusterHtml(ls){const p=ls.map(l=>l.ppm).filter(x=>x!=null);return `${ls.length} places${p.length?`<small>from ${fmt(Math.min(...p))}</small>`:""}`}
const MAP={ready:false,pending:null,setRows(r){this.pending=r;if(this.ready)this.impl.setRows(r)},select(id){if(this.ready)this.impl.select(id)},hot(id){if(this.ready)this.impl.hot(id)},focus(l){if(this.ready)this.impl.focus(l)},fit(){if(this.ready)this.impl.fit()},resize(){if(this.ready)this.impl.resize?.()}};
function markReady(impl){MAP.impl=impl;MAP.ready=true;if(MAP.pending)impl.setRows(MAP.pending)}

// Google calls this when the key is rejected; swap to the OpenStreetMap map instead of showing an error box
window.gm_authFailure=function(){console.warn("Google Maps key rejected; using OpenStreetMap");MAP.ready=false;const m=$("#map");m.innerHTML="";m.removeAttribute("style");m.className="";initLeaflet().catch(e=>console.error(e))};
async function initGoogle(){
  window.__hvGoogleReady=()=>{};
  await loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.googleMapsApiKey)}&v=weekly&libraries=marker&loading=async&callback=__hvGoogleReady`);
  await new Promise(r=>{const t=setInterval(()=>{if(window.google?.maps?.Map&&google.maps.marker){clearInterval(t);r()}},50)});
  await loadScript("https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js");
  const map=new google.maps.Map($("#map"),{center:OM,zoom:14,mapId:CFG.googleMapId||"DEMO_MAP_ID",clickableIcons:false,streetViewControl:true,mapTypeControl:false,fullscreenControl:false});
  let markers=new Map(),clusterer=null;
  const renderer={render:({count,markers:ms,position})=>{const ls=ms.map(m=>byId[m.hvId]);const d=document.createElement("div");d.className="cl";d.innerHTML=clusterHtml(ls);return new google.maps.marker.AdvancedMarkerElement({position,content:d,zIndex:1000+count})}};
  markReady({
    setRows(r){clusterer?.clearMarkers();markers.clear();const ms=r.map(l=>{const m=new google.maps.marker.AdvancedMarkerElement({position:{lat:l.lat,lng:l.lng},content:pinEl(l),title:l.name});m.hvId=l.id;m.addListener("click",()=>open(l.id));markers.set(l.id,m);return m});
      clusterer=new markerClusterer.MarkerClusterer({map,markers:ms,renderer,algorithmOptions:{radius:110,maxZoom:17}});this.fit(r)},
    fit(r=rows){if(!r.length)return;const b=new google.maps.LatLngBounds();r.forEach(l=>b.extend({lat:l.lat,lng:l.lng}));map.fitBounds(b,48)},
    select(id){document.querySelectorAll(".pin.sel").forEach(e=>e.classList.remove("sel"));markers.get(id)?.content.classList.add("sel")},
    hot(id){document.querySelectorAll(".pin.hot").forEach(e=>e.classList.remove("hot"));if(id)markers.get(+id)?.content.classList.add("hot")},
    focus(l){map.setCenter({lat:l.lat,lng:l.lng});map.setZoom(18)}
  });
}
async function initLeaflet(){
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js");
  const map=L.map("map",{zoomControl:true}).setView([OM.lat,OM.lng],14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  const icon=l=>L.divIcon({className:"hv",html:`<div class="hv-wrap"><div class="pin${l.type==="dorm"?" dorm":""}" data-id="${l.id}">${pinTxt(l)}</div></div>`,iconSize:[0,0]});
  let group=null,markers=new Map();
  markReady({
    setRows(r){if(group)map.removeLayer(group);markers.clear();
      group=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:55,disableClusteringAtZoom:18,spiderfyOnMaxZoom:true,
        iconCreateFunction:c=>L.divIcon({className:"hv",html:`<div class="hv-wrap"><div class="cl">${clusterHtml(c.getAllChildMarkers().map(m=>byId[m.hvId]))}</div></div>`,iconSize:[0,0]})});
      r.forEach(l=>{const m=L.marker([l.lat,l.lng],{icon:icon(l),title:l.name,riseOnHover:true});m.hvId=l.id;m.on("click",()=>open(l.id));markers.set(l.id,m);group.addLayer(m)});
      map.addLayer(group);this.fit(r)},
    fit(r=rows){if(!r.length)return;map.fitBounds(L.latLngBounds(r.map(l=>[l.lat,l.lng])),{padding:[40,40],maxZoom:16})},
    select(id){document.querySelectorAll(".pin.sel").forEach(e=>e.classList.remove("sel"));document.querySelector(`.pin[data-id="${id}"]`)?.classList.add("sel")},
    hot(id){document.querySelectorAll(".pin.hot").forEach(e=>e.classList.remove("hot"));if(id)document.querySelector(`.pin[data-id="${id}"]`)?.classList.add("hot")},
    focus(l){const m=markers.get(l.id);if(m&&group)group.zoomToShowLayer(m,()=>map.setView([l.lat,l.lng],18));else map.setView([l.lat,l.lng],18)},
    resize(){map.invalidateSize()}
  });
}

/* wiring */
function headH(){document.documentElement.style.setProperty("--head",$("#head").offsetHeight+"px")}
function setToggle(){$("#maptoggle span").textContent=document.body.classList.contains("showmap")?"Show list":"Show map"}
function wire(){
  $("#tabs").addEventListener("click",e=>{const b=e.target.closest(".tab");if(!b)return;state.type=b.dataset.k;try{localStorage.setItem("hvh-type",state.type)}catch(_){}renderTabs();renderList()});
  let qt;$("#q").addEventListener("input",e=>{clearTimeout(qt);qt=setTimeout(()=>{state.q=e.target.value;renderList()},150)});
  $("#maxp").addEventListener("input",e=>{state.maxp=+e.target.value;$("#maxpv").textContent=state.maxp>=2000?"Any":fmt(state.maxp);renderList()});
  $("#beds").addEventListener("change",e=>{state.beds=+e.target.value;renderList()});
  $("#sort").addEventListener("change",e=>{state.sort=e.target.value;renderList()});
  $("#grid").addEventListener("click",e=>{const c=e.target.closest(".card");if(c)open(+c.dataset.id)});
  $("#grid").addEventListener("mouseover",e=>{const c=e.target.closest(".card");MAP.hot(c?.dataset.id)});
  $("#grid").addEventListener("mouseleave",()=>MAP.hot(null));
  $("#map").addEventListener("mouseover",e=>{const p=e.target.closest(".pin");document.querySelectorAll(".card.hot").forEach(c=>c.classList.remove("hot"));if(p)document.querySelector(`.card[data-id="${p.dataset.id}"]`)?.classList.add("hot")});
  $("#maptoggle").onclick=()=>{headH();document.body.classList.toggle("showmap");setToggle();if(document.body.classList.contains("showmap"))setTimeout(()=>{MAP.resize();MAP.fit()},30);else window.scrollTo(0,0)};
  $("#dlg").addEventListener("click",e=>{if(e.target===$("#dlg"))$("#dlg").close()});
  $("#dlg").addEventListener("click",e=>{if(e.target.closest(".showmap-btn")){}});
  window.addEventListener("resize",()=>{headH();MAP.resize()});
  headH();document.fonts?.ready.then(headH);
}

function lbInit(){const d=$("#lb");if(!d)return;d.querySelector(".lbclose").onclick=()=>d.close();d.querySelector(".lbprev").onclick=()=>lbStep(-1);d.querySelector(".lbnext").onclick=()=>lbStep(1);
  d.querySelector(".lbthumbs").addEventListener("click",e=>{const b=e.target.closest("button");if(b){LB.i=+b.dataset.k;lbShow()}});
  d.addEventListener("keydown",e=>{if(e.key==="ArrowLeft")lbStep(-1);if(e.key==="ArrowRight")lbStep(1)});
  d.addEventListener("click",e=>{if(e.target===d)d.close()});
  let x0=null;d.addEventListener("touchstart",e=>{x0=e.touches[0].clientX},{passive:true});d.addEventListener("touchend",e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)lbStep(dx<0?1:-1);x0=null})}
async function start(){
  wire();lbInit();
  const res=await fetch("data/listings.json");ALL=await res.json();
  ALL.forEach(l=>{l.mi=miles(OM,l);byId[l.id]=l});
  renderTabs();renderList();
  try{if(CFG.googleMapsApiKey)await initGoogle();else await initLeaflet()}
  catch(e){console.error("Map failed, using OpenStreetMap",e);try{if(!MAP.ready)await initLeaflet()}catch(_){}}
}
start();
})();
