/* Rhedr: student sublets and lease takeovers.
   Data lives in Supabase when supabaseUrl/supabaseKey are set in config.js; otherwise demo mode (this browser only). */
(function(){
"use strict";
const CFG=window.RHEDR_CONFIG||window.HVH_CONFIG||{};
const DEMO=!(CFG.supabaseUrl&&CFG.supabaseKey);
const SUPABASE_JS="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js";
const OM={lat:40.79647,lng:-77.86279}; // Old Main
const PSU_RE=/^[^@\s]+@psu\.edu$/i;
// Rhedr admins (the "admins" table in Supabase) can sign in too, for testing. The database checks this again.
const ADMIN_EMAILS=["boaz@rhedr.com"];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>"$"+Number(n).toLocaleString("en-US");
function miles(a,b){const R=3958.8,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r,h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const distTxt=mi=>mi<1.2?Math.max(2,Math.round(mi*20))+" min walk":mi.toFixed(1)+" mi · bus";
const D=s=>new Date(s+"T12:00:00");
const iso=d=>d.toISOString().slice(0,10);
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"}); // Penn State's date, YYYY-MM-DD
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
 {k:"lease",label:"Lease checked",f:s=>!!s.lease_verified,ico:'<path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 14l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/>'},
 {k:"unit",label:"Whole places",f:s=>s.space==="unit",ico:'<rect x="6" y="2.5" width="12" height="18.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M11 21v-3h2v3" stroke="currentColor" stroke-width="1.6"/>'},
];

/* ---------- buildings from the main site (for picking a building, coords and price checks) ---------- */
let BLD=[],bById={};
const bldPhotos=b=>(b?.photos||[]).map(p=>p.url);

/* ---------- verification badges and ranking ---------- */
const CHECK='<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function badges(s){const b=[{k:"psu",t:"Penn State student",d:"Posted from a confirmed @psu.edu email."}];
  if(s.lease_verified)b.push({k:"lease",t:"Lease checked",d:"The poster showed us a lease or bill with their name and this address. It's a document check, not a guarantee about the person or the deal."});
  if((s.photos||[]).length>=4)b.push({k:"photos",t:"Real photos",d:"The poster uploaded their own photos of the place."});
  const bb=bById[s.building_id];if(bb&&!(bb.ppm&&s.space==="room"&&s.price<bb.ppm*0.45))b.push({k:"bldg",t:"Known building",d:"Matches a building on Rhedr, and the price fits that building."});
  return b}
/* "Most verified" sort: verification points first; when two listings tie, the cheaper one wins, then the newer one */
function score(s){return (s.lease_verified?40:0)+(s.building_id?12:0)+Math.min((s.photos||[]).length,6)*3+(s.has_lease_doc?4:0)}
function byVerified(a,b){return score(b)-score(a)||(+a.price||0)-(+b.price||0)||String(b.created_at).localeCompare(String(a.created_at))}

/* client-side scam checks, shown as you type; the database runs the same checks again */
const SCAM=[
 {k:"payment",re:/(western union|moneygram|wire (the|a|me)|wire transfer|gift ?card|bitcoin|crypto|usdt|cashier.?s check|money order)/i,msg:"Asking for wire transfers, gift cards, crypto or money orders is the most common sublet scam. Listings that mention them wait for a manual review."},
 {k:"offsite",re:/(whats ?app|telegram|signal app|text me at|\bkik\b)/i,msg:"Moving the chat to WhatsApp or Telegram is a common scam sign. Students can contact you through the site."},
 {k:"story",re:/(out of (the )?(country|state)|overseas|abroad|military deploy|missionary|god bless|can.?t show|no viewing|keys? (will be )?(mailed|shipped|sent))/i,msg:"\"I'm away, I'll mail the keys\" is a classic scam story. If you can't show the place, say who can."},
 {k:"deposit",re:/(deposit|pay|payment).{0,40}(before|to hold|first|today)/i,msg:"Asking for money before a viewing or a signed agreement makes students wary, and the listing waits for review."},
 {k:"contact",re:/(\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b|[^\s@]+@(?!psu\.edu)[^\s@]+\.[a-z]{2,})/i,warn:true,msg:"Phone numbers and outside emails are hidden on Rhedr. Students message you in the Rhedr chat, and you see each other's email once you both agree on Rhedr."},
];
function scamCheck(s){const txt=[s.title,s.description,s.roommates].join(" ");const out=SCAM.filter(c=>c.re.test(txt)).map(c=>({k:c.k,msg:c.msg,warn:!!c.warn}));
  const b=bById[s.building_id];
  if(b&&b.ppm&&s.price&&s.space==="room"&&s.price<b.ppm*0.45)out.push({k:"price",msg:`${fmt(s.price)} is far below ${b.name}'s lowest rent (${fmt(b.ppm)} per person). Very low prices draw scam reports. Double-check it.`,warn:true});
  if(s.orig_price&&s.price<s.orig_price*0.35)out.push({k:"price",msg:"The price is under a third of your lease rent. If that's right, say why in the description.",warn:true});
  return out}

/* contact-info masking for chats: a copy of contact_norm, mask_contact, contact_digits, contact_deob, contact_found,
   mask_message and mask_text in supabase/messaging.sql (the MC rules are generated from it). The database is what
   really hides it; this copy shows a heads-up while you type and runs demo mode. tests/contact-filter.test.js
   checks the two give the same answers. */
const HID="[contact info hidden]";
const RX=(s,f)=>{try{return new RegExp(s,f)}catch(e){return null}};   // a browser without lookbehind skips that rule
const RP=(t,re,w)=>re?t.replace(re,w):t;
const PGTRIM=t=>t.replace(/^ +| +$/g,"");
const TRM=(()=>{const a=Array.from("аеорсхуікмтнвѕјԁӏɡАЕОРСХУІКМТНВЅЈαοιρνκτυχεΑΒΕΖΗΙΚΜΝΟΡΤΥΧıȷɑøØ🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩🅰🅱🅲🅳🅴🅵🅶🅷🅸🅹🅺🅻🅼🅽🅾🅿🆀🆁🆂🆃🆄🆅🆆🆇🆈🆉🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰🇱🇲🇳🇴🇵🇶🇷🇸🇹🇺🇻🇼🇽🇾🇿❶❷❸❹❺❻❼❽❾➀➁➂➃➄➅➆➇➈➊➋➌➍➎➏➐➑➒⓵⓶⓷⓸⓹⓺⓻⓼⓽⓿·•∙⋅。｡"),b=Array.from("aeopcxyikmthbsjdlgAEOPCXYIKMTHBSJaoipvktuxeABEZHIKMNOPTYXijaooABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567891234567891234567891234567890......");return new Map(a.map((c,i)=>[c,b[i]]))})();
const INVIS=RX("[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\u20E3\\u0300-\\u036F]","g");
function contactNorm(t){if(t==null)return t;t=RP(String(t).normalize("NFKD"),INVIS,"").normalize("NFKC");return Array.from(t,c=>TRM.get(c)??c).join("")}
const MC=[
 [RX("([A-Za-z0-9_%+-]+\\s*(\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b|\\s\\.\\s)\\s*)*[A-Za-z0-9._%+-]+\\s*(@|\\(at\\)|\\[at\\]|\\{at\\}|<at>|\\s+at\\s+)\\s*[A-Za-z0-9-]+(\\s*(\\.|\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\s+dot\\s+)\\s*[A-Za-z0-9-]+)*\\s*(\\.|\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\s+dot\\s+)\\s*(com|edu|net|org|io|me|co|us|info)\\b","gi"),HID],
 [RX("(([A-Za-z0-9_%+-]+\\s*(\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b|\\s\\.\\s|\\.)\\s*)*[A-Za-z0-9._%+-]{2,})\\s*(@|\\(at\\)|\\[at\\]|\\{at\\}|<at>|\\bat\\s+(sign|symbol)\\b|\\bat\\b)?\\s*psu\\s*(\\.|\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b)?\\s*edu\\b","gi"),HID],
 [RX("[A-Za-z0-9._%+-]{2,}\\s*(@|\\(at\\)|\\[at\\]|\\{at\\}|<at>)\\s*psu\\b","gi"),HID],
 [RX("(([A-Za-z0-9_%+-]+\\s*(\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b|\\s\\.\\s|\\.)\\s*)*[A-Za-z0-9._%+-]{2,})\\s*(@|\\(at\\)|\\[at\\]|\\{at\\}|<at>|\\bat\\s+(sign|symbol)\\b|\\bat\\b)?\\s*(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|protonmail|proton\\.me)\\b(\\s*(\\.|\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b)?\\s*(com|net)\\b)?","gi"),HID],
 [RX("\\b(?!rhedr\\b)[A-Za-z0-9-]{2,}(\\s*(\\(dot\\)|\\[dot\\]|\\{dot\\}|<dot>|\\bdot\\b)\\s*|\\s+\\.\\s*|\\.\\s+)(com|net|org|edu)\\b","gi"),HID],
 [RX("https?://(?!(www\\.)?rhedr\\.com)[^\\s]+","gi"),HID],
 [RX("\\bwww\\.(?!rhedr\\.com)[^\\s]+","gi"),HID],
 [RX("\\b(?!rhedr\\.)[A-Za-z0-9-]{2,}\\.(com|net|org|me|io|ly|gg|app|link|co|us|info|xyz|page|bio|tv|ee|ai|gl|cc)(/[^\\s]*)?\\b","gi"),HID],
 [RX("(\\+?1[\\s.-]*)?\\(?\\d{3}\\)?[\\s.-]*\\d{3}[\\s.-]*\\d{4}","g"),HID],
 [RX("\\b(?!\\d\\d[05]-\\d\\d[05]0\\b)\\d{3}[\\s.-]\\d{4}\\b","g"),HID],
 [RX("\\b(?!(mp3|mp4|ps2|ps3|ps4|ps5)\\b)[A-Za-z]{2,3}\\d{1,4}\\b","gi"),HID],
 [RX("(\\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d)\\b[\\s,.-]+){6,}\\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d)\\b","gi"),HID],
 [RX("\\b(venmo|cash\\s?app|zelle|paypal|pay\\s?pal|apple\\s?pay|insta(\\s?gram)?|the\\s+gram|gram|snap\\s?chat|whats\\s?app|telegram|discord|kik|group\\s?me|imessage|face\\s?book|fb|messenger|tik\\s?tok|twitter|threads|linked\\s?in|signal\\s+app|wechat|reddit|bereal|ig|sc)\\b[\\s:=-]*((is|me|at|on|to|name|user\\s?name|handle|id|account|@)\\b[\\s:=-]*)*(?!(or|and|on|at|to|ok|okay|works?|fine|good|great|too|for|if|but|then|please|pls|only|instead|so|the|a|an|it|its|that|this|these|you|u|we|i|me|my|your|ur|account|app|request|payment|pay|here|there|rhedr|later|now|with|is|are|not|no|yes|either|both|also|right|thing|stuff|etc|maybe|work|accepted|is|was|will|would|could|can|do|does|did|have|has|in|of|or|not|anyone|everyone|someone|him|her|them|us|still|already|just|more|active|never|rarely|also)\\b)(@|\\$)?[A-Za-z0-9._#-]*[A-Za-z0-9_]","gi"),HID],
 [RX("(?<![A-Za-z0-9._@$-])(?!(or|and|on|at|to|ok|okay|works?|fine|good|great|too|for|if|but|then|please|pls|only|instead|so|the|a|an|it|its|that|this|these|you|u|we|i|me|my|your|ur|account|app|request|payment|pay|here|there|rhedr|later|now|with|is|are|not|no|yes|either|both|also|right|thing|stuff|etc|maybe|work|accepted|is|was|will|would|could|can|do|does|did|have|has|in|of|or|not|anyone|everyone|someone|him|her|them|us|still|already|just|more|active|never|rarely|also)\\b)[@$]?[A-Za-z0-9._-]*[A-Za-z0-9_]{3,}\\s+(on|at|via)\\s+(venmo|cash\\s?app|zelle|paypal|insta(\\s?gram)?|the\\s+gram|gram|ig|snap(\\s?chat)?|sc|whats\\s?app|telegram|discord|group\\s?me|face\\s?book|fb|tik\\s?tok|twitter|linked\\s?in)\\b","gi"),HID],
 [RX("\\bsnap\\s*(:|@|\\bis\\b|\\bname\\b|\\buser\\s?name\\b|\\bhandle\\b)[\\s:@]*((is|name)\\b[\\s:@]*)*(?!(or|and|on|at|to|ok|okay|works?|fine|good|great|too|for|if|but|then|please|pls|only|instead|so|the|a|an|it|its|that|this|these|you|u|we|i|me|my|your|ur|account|app|request|payment|pay|here|there|rhedr|later|now|with|is|are|not|no|yes|either|both|also|right|thing|stuff|etc|maybe|work|accepted|is|was|will|would|could|can|do|does|did|have|has|in|of|or|not|anyone|everyone|someone|him|her|them|us|still|already|just|more|active|never|rarely|also)\\b)[A-Za-z0-9._-]*[A-Za-z0-9_]","gi"),HID],
 [RX("\\b(user\\s?name|handle|screen\\s?name|gamertag)\\b[\\s:=-]*((is|on|at|it'?s)\\b[\\s:=-]*)*(?!(or|and|on|at|to|ok|okay|works?|fine|good|great|too|for|if|but|then|please|pls|only|instead|so|the|a|an|it|its|that|this|these|you|u|we|i|me|my|your|ur|account|app|request|payment|pay|here|there|rhedr|later|now|with|is|are|not|no|yes|either|both|also|right|thing|stuff|etc|maybe|work|accepted|is|was|will|would|could|can|do|does|did|have|has|in|of|or|not|anyone|everyone|someone|him|her|them|us|still|already|just|more|active|never|rarely|also)\\b)@?[A-Za-z0-9._-]*[A-Za-z0-9_]","gi"),HID],
 [RX("\\$[A-Za-z][A-Za-z0-9_]{2,}","g"),HID],
 [RX("(^|[^A-Za-z0-9._%+-])@[A-Za-z0-9._]{3,}","g"),"$1"+HID],
 [RX("(\\[contact info hidden\\][\\s,;:/-]*){2,}","g"),HID+" "],
];
function maskContact(t){if(t==null)return t;let x=String(t);for(const [re,w] of MC)x=RP(x,re,w);return PGTRIM(x)}
const NUMW=["zero", "0", "oh", "0", "o", "0", "one", "1", "won", "1", "two", "2", "three", "3", "four", "4", "five", "5", "six", "6", "seven", "7", "eight", "8", "nine", "9", "niner", "9", "ten", "10", "eleven", "11", "twelve", "12", "thirteen", "13", "fourteen", "14", "fifteen", "15", "sixteen", "16", "seventeen", "17", "eighteen", "18", "nineteen", "19", "twenty", "20", "thirty", "30", "forty", "40", "fourty", "40", "fifty", "50", "sixty", "60", "seventy", "70", "eighty", "80", "ninety", "90", "hundred", "00"].reduce((a,x,i,l)=>(i%2?a:[...a,[RX("(?<![a-z])"+x+"(?![a-z])","g"),l[i+1]]]),[]);
function contactDigits(t,strict=false){let v=String(t??"").toLowerCase().replace(/(\d),(\d{3})(?!\d)/g,"$1$2");
  for(const [re,d] of NUMW)v=RP(v,re,d);
  if(!/\d/.test(v))return false;
  v=RP(v,RX("(?<![a-z])(double|dbl)[\\s-]*(\\d)","g"),"$2$2");v=RP(v,RX("(?<![a-z])triple[\\s-]*(\\d)","g"),"$1$1$1");
  for(let i=0;i<3;i++){if(!/\d[oli|!]|[oli|!]\d/.test(v))break;v=RP(v,RX("(?<=\\d)o|o(?=\\d)","g"),"0");v=RP(v,RX("(?<=\\d)[li|!]|[li|!](?=\\d)","g"),"1")}
  for(const m of v.matchAll(/\d(?:[\s.,_*~|()+#=-]*\d)*/g)){const r=m[0];
    if(/^(\d{1,2}[.-]\d{1,2}[.-](\d{2}|\d{4})|\d{4}[.-]\d{1,2}[.-]\d{1,2})$/.test(r))continue;
    const dg=r.replace(/\D/g,""),nd=dg.length,ng=r.match(/\d+/g).length;
    if(strict){if(nd===10||(nd===11&&dg[0]==="1"))return true}else if(nd>=10||(nd>=7&&ng!==2))return true}
  return false}
const KW=["googlemail", "protonmail", "snapchat", "instagram", "whatsapp", "telegram", "cashapp", "facebook", "linkedin", "imessage", "hotmail", "outlook", "discord", "groupme", "twitter", "paypal", "icloud", "tiktok", "gmail", "yahoo", "venmo", "zelle", "insta", "snap", "psu", "edu", "com"].map(k=>[RX("(?<![a-z])"+k.split("").join("[\\s._*~|,/-]*")+"(?![a-z])","g"),k]);
const DEOB=[
 [RX("(?<![a-z])(g|gee|jee|ge)[\\s._*~-]*mail(?![a-z])","g"),"gmail"],
 [RX("(?<![a-z])(pee|p)[\\s.,_*~-]*(ess|s)[\\s.,_*~-]*(you|u)(?![a-z])","g"),"psu"],
 [RX("(?<![a-z])(ee|e)[\\s.,_*~-]*(dee|d)[\\s.,_*~-]*(you|u)(?![a-z])","g"),"edu"],
 [RX("(?<![a-z])(see|c)[\\s.,_*~-]*(oh|o)[\\s.,_*~-]*(em|m)(?![a-z])","g"),"com"],
 [RX("\\s*([(\\[{<]\\s*(at|a)\\s*[)\\]}>]|(?<![a-z])at\\s+(sign|symbol)(?![a-z])|@\\s*(sign|symbol)(?![a-z]))\\s*","g"),"@"],
 [RX("(?<=[a-z0-9])\\s*@\\s*(?=[a-z])","g"),"@"],
 [RX("\\s*([(\\[{<]\\s*(dot|d0t|\\.)\\s*[)\\]}>]|(?<![a-z])(dot|dawt|dott|period|punto)(?=\\s*(com|edu|net|org|io|me|co|us)(?![a-z])))\\s*","g"),"."],
 [RX("\\s*\\.\\s*(?=(com|edu|net|org|io|me|co|us)(?![a-z]))","g"),"."],
];
const G1=RX("(?<![a-z])(g|gee|jee|ge|pee|p|ee|e|see|c)[\\s.,_*~-]"),G2=RX("[(\\[{<@]|(?<![a-z])at\\s+(sign|symbol)|(dot|dawt|dott|period|punto|\\.)\\s*(com|edu|net|org|io|me|co|us)(?![a-z])");
const GLUE=RX("(?<![a-z0-9])[a-z0-9@.](?![a-z0-9])(?:[\\s_*~|,/+-]+[a-z0-9@.](?![a-z0-9])){3,}","g"),GSEP=RX("[\\s_*~|,/+-]+","g");
function contactDeob(t,oneIsL=false){let v=String(t??"").toLowerCase();
  for(const m of [...v.matchAll(/[a-z0-9@!|$]{4,}/g)].map(x=>x[0])){if(!/[a-z].*[a-z]/.test(m)||!/[013457@!|$]/.test(m))continue;
    let w=m;for(let i=0;i<2;i++){let nw="";for(let j=0;j<w.length;j++){let c=w[j];const k="013457@!|$".indexOf(c);
      if(k>=0&&(/[a-z]/.test(w[j-1]||"")||/[a-z]/.test(w[j+1]||"")))c=(oneIsL?"oleastails":"oieastails")[k];nw+=c}w=nw}
    v=v.split(m).join(w)}
  if(G1&&G1.test(v))DEOB.slice(0,4).forEach(([re,w])=>{v=RP(v,re,w)});
  const sq=v.replace(/[\s._*~|,/-]/g,"");
  for(const [re,k] of KW)if(sq.includes(k))v=RP(v,re,k);
  if(G2&&G2.test(v))DEOB.slice(4).forEach(([re,w])=>{v=RP(v,re,w)});
  if(GLUE)for(const m of [...v.matchAll(GLUE)].map(x=>x[0]))v=v.split(m).join(m.replace(GSEP,""));
  return v}
function contactFound(t,strict=false){if(t==null||t==="")return false;if(contactDigits(t,strict))return true;
  const lt=t.toLowerCase();let d=contactDeob(t);if(d!==lt&&maskContact(d)!==PGTRIM(d))return true;
  if(!t.includes("1"))return false;d=contactDeob(t,true);return d!==lt&&maskContact(d)!==PGTRIM(d)}
function maskText(t){if(t==null)return t;const n=contactNorm(t),m=maskContact(n);return m!==PGTRIM(n)?m:t}
function maskMessage(t){if(t==null)return t;const n=contactNorm(t),m=maskContact(n);if(m!==PGTRIM(n))return m||HID;return contactFound(n)?HID:t}

/* ---------- data layer ---------- */
const API=DEMO?demoApi():liveApi();
function demoApi(){
  const KEY="rhedr-demo-sublets",UKEY="rhedr-demo-user";
  const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){return[]}};
  const write=a=>{try{localStorage.setItem(KEY,JSON.stringify(a))}catch(e){}};
  let user=null;try{user=JSON.parse(localStorage.getItem(UKEY)||"null")}catch(e){}
  const listeners=[];const emit=()=>listeners.forEach(f=>f(user));
  const AKEY="rhedr-demo-alerts";
  const readA=()=>{try{return JSON.parse(localStorage.getItem(AKEY)||"[]")}catch(e){return[]}};
  const writeA=a=>{try{localStorage.setItem(AKEY,JSON.stringify(a))}catch(e){}};
  const fileUrl=f=>new Promise(ok=>{const r=new FileReader();r.onload=()=>ok(r.result);r.readAsDataURL(f)});
  return {
    demo:true,
    onAuth(f){listeners.push(f);f(user)},
    async sendCode(email){return {ok:true}},
    async verify(email,code){if(!/^\d{6,10}$/.test(code))throw new Error("Type the code from the email");user={id:"demo-"+email,email};try{localStorage.setItem(UKEY,JSON.stringify(user))}catch(e){}emit()},
    async signOut(){user=null;try{localStorage.removeItem(UKEY)}catch(e){}emit()},
    async chatRulesOk(){try{localStorage.setItem("rhedr-chat-rules-"+user?.id,"1")}catch(e){}},
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
    async report(id,reason){return true},
    // chats: in demo mode they stay in this browser, and "the poster" answers by itself so you can try every step
    ...demoChat(()=>user),
    async settings(){return {lease_proof_required:!!CFG.demoLeaseRequired}},
    async attachLease(id,file){const all=read();const s=all.find(x=>x.id===id&&x.user_id===user?.id);if(s){s.has_lease_doc=true;write(all)}},
    async myChecks(){return []},
    checkLease(){},
    // saved searches (sublet alerts): in demo mode they stay in this browser and no email is sent
    async searches(){return user?readA().filter(a=>a.user_id===user.id).sort((a,b)=>b.id-a.id):[]},
    async saveSearch(row){const all=readA();if(row.active!==false&&all.filter(a=>a.user_id===user.id&&a.active).length>=5)throw new Error("You can have 5 alerts on at once. Turn one off first.");
      const a={...row,id:Date.now(),user_id:user.id,active:true,created_at:new Date().toISOString(),token:"demo-"+Date.now()};all.push(a);writeA(all);return a},
    async updateSearch(id,patch){const all=readA();const a=all.find(x=>x.id===id&&x.user_id===user?.id);if(!a)return;
      if(patch.active&&!a.active&&all.filter(x=>x.user_id===user.id&&x.active).length>=5)throw new Error("You can have 5 alerts on at once. Turn one off first.");Object.assign(a,patch);writeA(all)},
    async deleteSearch(id){writeA(readA().filter(x=>!(x.id===id&&x.user_id===user?.id)))},
    async unsubscribe(token,all){const list=readA();const a=list.find(x=>x.token===token);if(!a)return 0;let n=0;list.forEach(x=>{if(x.active&&(x.token===token||(all&&x.user_id===a.user_id))){x.active=false;n++}});writeA(list);return n}
  };
}
function demoChat(who){
  const CK="rhedr-demo-chats",OTHER="demo-poster";
  const rd=()=>{try{return JSON.parse(localStorage.getItem(CK)||"null")||{n:0,c:[],m:[]}}catch(e){return {n:0,c:[],m:[]}}};
  const wr=x=>{try{localStorage.setItem(CK,JSON.stringify(x))}catch(e){}};
  const L=[];const fire=ev=>setTimeout(()=>L.forEach(f=>f(ev)),0);
  const add=(db,cid,sender,body)=>{const c=db.c.find(x=>x.id===cid);const t=String(body).trim();const mk=!!sender&&!c.agreed_at?maskMessage(t):t;
    const m={id:++db.n,created_at:new Date().toISOString(),conversation_id:cid,sender_id:sender,body:mk||HID,masked:mk!==t};db.m.push(m);c.last_at=m.created_at;if(sender===who()?.id)c.read=m.created_at;return m};
  const later=(f,ms=1400)=>setTimeout(()=>{const db=rd();const ev=f(db);wr(db);if(ev)fire(ev)},ms);
  const shape=c=>{const db=rd(),ms=db.m.filter(m=>m.conversation_id===c.id),last=ms[ms.length-1]||{};const s=byId[c.sublet_id];
    return {id:c.id,sublet_id:c.sublet_id,sublet_title:c.title,photo:s?.photos?.[0]||null,price:s?.price,building_name:s?.building_name,address:s?.address,i_am:"student",other_name:c.poster_name,
      last_body:last.body||"",last_from_me:last.sender_id===who()?.id,last_at:c.last_at,unread:ms.filter(m=>m.sender_id!==who()?.id&&m.created_at>(c.read||"")).length,
      i_agreed:!!c.me_ok,they_agreed:!!c.them_ok,agreed_at:c.agreed_at||null,closed_at:c.closed_at||null,listed:!!s}};
  const mine=c=>c.student===who()?.id;
  return {
    async chats(){const u=who();if(!u)return [];return rd().c.filter(mine).map(shape).sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)))},
    async messages(cid){return rd().m.filter(m=>m.conversation_id===cid)},
    async startChat(sid,body,name){const u=who();if(!u)throw new Error("Sign in first");const s=byId[sid];if(!s)throw new Error("This sublet is no longer listed");
      const db=rd();let c=db.c.find(x=>x.sublet_id===sid&&x.student===u.id);
      if(!c){c={id:++db.n,sublet_id:sid,title:s.title,student:u.id,name,poster_name:s.contact_name||"The poster",last_at:new Date().toISOString()};db.c.push(c)}
      const first=!db.m.some(m=>m.conversation_id===c.id);add(db,c.id,u.id,body);wr(db);
      if(first)later(db=>({type:"message",row:add(db,c.id,OTHER,`Hi${name?" "+name:""}! Yes, it's still available. Want to come see it this week? I'm free most afternoons.`)}),1800);
      return c.id},
    async send(cid,body){const u=who();const db=rd();const c=db.c.find(x=>x.id===cid&&mine(x));if(!c)throw new Error("That chat no longer exists");if(c.closed_at)throw new Error("This chat is closed");
      const m=add(db,cid,u.id,body);wr(db);return m},
    async agree(cid,yes){const db=rd();const c=db.c.find(x=>x.id===cid&&mine(x));if(!c||c.agreed_at)return;c.me_ok=!!yes;
      add(db,cid,null,yes?`${c.name||"You"} tapped "We agreed on Rhedr". Once you tap it too, you'll both see each other's email.`:`${c.name||"You"} took back "We agreed on Rhedr".`);c.read=new Date().toISOString();wr(db);
      if(yes)later(db=>{const x=db.c.find(y=>y.id===cid);if(!x||!x.me_ok||x.agreed_at)return null;x.them_ok=true;x.agreed_at=new Date().toISOString();
        add(db,cid,null,"You both agreed on Rhedr. Your psu.edu emails are now shown at the top of this chat. Next: ask the landlord for their sublease form, and see the place before you pay.");return {type:"chat",row:{id:cid}}})},
    async chatContact(cid){const c=rd().c.find(x=>x.id===cid&&mine(x));if(!c?.agreed_at)throw new Error("Contact details are shared once you both agree on Rhedr");const s=byId[c.sublet_id];
      return {name:c.poster_name,email:"example.poster@psu.edu",unit:s?.unit||"",address:s?.address||""}},
    async readChat(cid){const db=rd();const c=db.c.find(x=>x.id===cid&&mine(x));if(c){c.read=new Date().toISOString();wr(db)}},
    async closeChat(cid){const db=rd();const c=db.c.find(x=>x.id===cid&&mine(x));if(!c||c.closed_at)return;c.closed_at=new Date().toISOString();add(db,cid,null,"This chat was closed. Neither of you can send more messages here.");c.read=new Date().toISOString();wr(db)},
    async reportChat(cid,reason){return true},
    onChat(f){L.push(f);return ()=>{const i=L.indexOf(f);if(i>=0)L.splice(i,1)}}
  };
}
function liveApi(){
  let sb=null,user=null;const listeners=[];
  const ready=(async()=>{await loadScript(SUPABASE_JS);sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
    sb.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;listeners.forEach(f=>f(user))});
    const {data}=await sb.auth.getSession();user=data.session?.user||null;listeners.forEach(f=>f(user))})();
  const need=()=>{if(!user)throw new Error("Sign in with your Penn State email first")};
  const err=e=>{if(e)throw new Error(/Could not find the function public\.(start_chat|my_chats|agree_deal|chat_)/i.test(e.message||"")?"Messages aren't switched on yet. Try again soon.":e.message||String(e))};
  async function upload(bucket,f,max,q){const blob=f.type==="application/pdf"?f:await shrink(f,max,q);const ext=blob.type==="application/pdf"?"pdf":"jpg";
    const path=`${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const {error}=await sb.storage.from(bucket).upload(path,blob,{contentType:blob.type||"image/jpeg",upsert:false});
    if(error&&/row-level security|policy|unauthorized/i.test(error.message))throw new Error(bucket==="sublet-photos"?"You've reached the photo limit for your account. Delete an old sublet to free up space.":"You've reached the limit for lease proof uploads.");err(error);
    return bucket==="sublet-photos"?sb.storage.from(bucket).getPublicUrl(path).data.publicUrl:path}
  return {
    demo:false,
    onAuth(f){listeners.push(f);if(sb)f(user)},
    async sendCode(email){await ready;const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});err(error);return {ok:true}},
    async verify(email,code){await ready;const {error}=await sb.auth.verifyOtp({email,token:code,type:"email"});err(error)},
    async signOut(){await ready;await sb.auth.signOut()},
    async chatRulesOk(){await ready;try{localStorage.setItem("rhedr-chat-rules-"+user?.id,"1")}catch(e){}
      const {data}=await sb.auth.updateUser({data:{chat_rules_ok:new Date().toISOString()}});if(data?.user)user=data.user},
    async list(){await ready;const {data,error}=await sb.from("sublets_public").select("*").limit(500);err(error);return data||[]},
    async mine(){await ready;if(!user)return[];const {data,error}=await sb.from("sublets").select("*").eq("user_id",user.id).order("created_at",{ascending:false});err(error);return data||[]},
    async post(row,photos,lease){await ready;need();
      const urls=[];for(const f of photos)urls.push(await upload("sublet-photos",f,1600,.82));
      const lease_path=lease?await upload("lease-proofs",lease,2000,.85):null;
      const {data,error}=await sb.from("sublets").insert({...row,photos:urls,lease_path}).select().single();
      if(error){const own=urls.map(u=>u.split("/sublet-photos/")[1]).filter(Boolean);if(own.length)await sb.storage.from("sublet-photos").remove(own);if(lease_path)await sb.storage.from("lease-proofs").remove([lease_path])}
      err(error);if(data?.has_lease_doc)this.checkLease(data.id);return data},
    async setStatus(id,status){await ready;need();const {error}=await sb.from("sublets").update({status}).eq("id",id);err(error)},
    async remove(id){await ready;need();const {data:row}=await sb.from("sublets").select("photos,lease_path").eq("id",id).maybeSingle();
      const {error}=await sb.from("sublets").delete().eq("id",id);err(error);
      // free up the poster's upload space
      const own=(row?.photos||[]).map(u=>u.split("/sublet-photos/")[1]).filter(Boolean);
      if(own.length)await sb.storage.from("sublet-photos").remove(own);if(row?.lease_path)await sb.storage.from("lease-proofs").remove([row.lease_path])},
    async contact(id){await ready;need();const {data,error}=await sb.rpc("sublet_contact",{sid:id});err(error);if(!data?.length)throw new Error("This sublet is no longer listed");return data[0]},
    async report(id,reason){await ready;need();const {error}=await sb.from("sublet_reports").insert({sublet_id:id,reason});if(error&&!/duplicate/i.test(error.message))err(error);return true},
    async settings(){await ready;const {data}=await sb.from("site_settings").select("lease_proof_required").eq("id",1).maybeSingle();return data||{lease_proof_required:false}},
    // add a lease proof to a listing that has none (or whose proof was rejected)
    async attachLease(id,file){await ready;need();const lease_path=await upload("lease-proofs",file,2000,.85);
      const {data,error}=await sb.from("sublets").update({lease_path}).eq("id",id).select("has_lease_doc").single();
      if(error||!data?.has_lease_doc){await sb.storage.from("lease-proofs").remove([lease_path]);err(error||{message:"That listing already has a lease proof"})}
      this.checkLease(id)},
    async myChecks(){await ready;if(!user)return [];const {data}=await sb.rpc("my_lease_checks");return data||[]},
    // ask the AI to read the proof now; if the function isn't set up, the proof just waits for a manual check
    checkLease(id){ready.then(()=>sb.functions.invoke("check-lease",{body:{sublet_id:id}})).catch(()=>{})},
    // saved searches (sublet alerts); the send-alerts Edge Function emails new matches
    async searches(){await ready;if(!user)return [];const {data,error}=await sb.from("saved_searches").select("*").eq("user_id",user.id).order("created_at",{ascending:false});err(error);return data||[]},
    async saveSearch(row){await ready;need();const {data,error}=await sb.from("saved_searches").insert(row).select().single();err(error);return data},
    async updateSearch(id,patch){await ready;need();const {error}=await sb.from("saved_searches").update(patch).eq("id",id);err(error)},
    async deleteSearch(id){await ready;need();const {error}=await sb.from("saved_searches").delete().eq("id",id);err(error)},
    async unsubscribe(token,all){await ready;const {data,error}=await sb.rpc("alert_unsubscribe",{p_token:token,p_all:!!all});err(error);return data||0},
    // chats between students (supabase/messaging.sql). Row level security means you only ever get your own.
    async chats(){await ready;if(!user)return [];const {data,error}=await sb.rpc("my_chats");err(error);return data||[]},
    async messages(cid){await ready;need();const {data,error}=await sb.from("messages").select("id,created_at,conversation_id,sender_id,body,masked").eq("conversation_id",cid).order("id",{ascending:true}).limit(1000);err(error);return data||[]},
    async startChat(sid,body,name){await ready;need();const {data,error}=await sb.rpc("start_chat",{p_sublet:sid,p_body:body,p_name:name||null});err(error);return data},
    async send(cid,body){await ready;need();const {data,error}=await sb.from("messages").insert({conversation_id:cid,body}).select("id,created_at,conversation_id,sender_id,body,masked").single();err(error);return data},
    async agree(cid,yes){await ready;need();const {error}=await sb.rpc("agree_deal",{p_conv:cid,p_agree:!!yes});err(error)},
    async chatContact(cid){await ready;need();const {data,error}=await sb.rpc("chat_contact",{p_conv:cid});err(error);return data?.[0]||null},
    async readChat(cid){await ready;if(user)await sb.rpc("chat_read",{p_conv:cid})},
    async closeChat(cid){await ready;need();const {error}=await sb.rpc("chat_close",{p_conv:cid});err(error)},
    async reportChat(cid,reason){await ready;need();const {error}=await sb.rpc("chat_report",{p_conv:cid,p_reason:reason});err(error);return true},
    // live updates (Supabase Realtime); the page also checks every few seconds in case they're off
    onChat(f){let ch=null,off=false;ready.then(()=>{if(off)return;ch=sb.channel("rhedr-chat-"+Math.random().toString(36).slice(2))
        .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},p=>f({type:"message",row:p.new}))
        .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},p=>f({type:"message_hidden",row:p.new}))
        .on("postgres_changes",{event:"UPDATE",schema:"public",table:"conversations"},p=>f({type:"chat",row:p.new})).subscribe()});
      return ()=>{off=true;if(ch)sb.removeChannel(ch)}}
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
   .sort((a,b)=>state.sort==="price"?a.price-b.price:state.sort==="start"?a.start_date.localeCompare(b.start_date):state.sort==="new"?String(b.created_at).localeCompare(String(a.created_at)):byVerified(a,b))}
function renderTabs(){$("#tabs").innerHTML=`<a class="tab" href="penn-state"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 11h2M11 11h2M15 11h2M7 15h2M11 15h2M15 15h2M6 7V4h12v3" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>All housing<span class="n">${BLD.length||""}</span></a><span class="tabsep" aria-hidden="true"></span>`+
  TABS.map(t=>`<button class="tab" role="tab" aria-selected="${state.tab===t.k}" data-k="${t.k}"><svg viewBox="0 0 24 24" aria-hidden="true">${t.ico}</svg>${t.label}${t.k==="spring"||t.k==="summer"||t.k==="fall"?" "+season(t.k).y:""}<span class="n">${ALL.filter(t.f).length}</span></button>`).join("")}
function photoOf(s,i=0){const u=(s.photos||[])[i];return u?`<img src="${esc(u)}" alt="${esc(s.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'nophoto',textContent:'Photo unavailable'}))">`:`<div class="nophoto">No photos yet</div>`}
function vrow(s){return `<div class="vrow">${badges(s).map(b=>`<span class="v v-${b.k}" title="${esc(b.d)}">${CHECK}${esc(b.t)}</span>`).join("")}</div>`}
function save(s){return s.orig_price&&s.orig_price>s.price?`<span class="save">${fmt(s.orig_price-s.price)} under lease</span>`:""}
function renderList(){rows=filtered();
  const tab=TABS.find(t=>t.k===state.tab);$("#count").textContent=`${rows.length} ${state.tab==="all"?"sublets":tab.label.toLowerCase()+(["spring","summer","fall","lease"].includes(state.tab)?" sublets":"")} near Penn State`;
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
const CHAT_SVG='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
function msgLabel(s){if(!USER)return "Sign in with your psu.edu email to message";
  if(MYIDS.has(s.id)){const n=CHATS.filter(c=>c.sublet_id===s.id).length;return n?`Your sublet · ${n} chat${n>1?"s":""}`:"Your sublet · no messages yet"}
  return CHATS.some(c=>c.sublet_id===s.id&&c.i_am==="student")?"Open your chat":"Message "+(s.contact_name||"the poster")}
function open(id){const s=byId[id];if(!s)return;gi=0;MAP.select(id);const ph=s.photos||[];const b=bById[s.building_id];
  const vs=badges(s);
  $("#dlgbody").innerHTML=`<div class="hero" id="hero">${photoOf(s,0)}${ph.length>1?`<button class="nav prev" aria-label="Previous photo">‹</button><button class="nav next" aria-label="Next photo">›</button><span class="count" id="gcount">1 / ${ph.length}</span><button class="allph" id="allph">See all ${ph.length} photos</button>`:""}<button class="close" aria-label="Close">×</button></div>
  <div class="body"><div><span class="kind">${s.kind==="takeover"?"Lease takeover":"Sublet"} · ${s.space==="unit"?"Whole place":"Private room"}${s.example?" · Example listing":""}</span><h2>${esc(s.title)}</h2>
   <div class="addr">${esc(s.building_name?s.building_name+", ":"")}${esc(s.address)}, State College, PA · ${s.mi.toFixed(1)} mi from Old Main (${distTxt(s.mi)})</div></div>
  <div class="facts"><div class="fact"><span>Rent</span><b>${fmt(s.price)} / mo</b>${s.orig_price?`<small class="was">Lease rent ${fmt(s.orig_price)}</small>`:""}</div><div class="fact"><span>Dates</span><b>${dTxt(s.start_date)} – ${dTxt(s.end_date)}</b><small class="was">About ${months(s.start_date,s.end_date)} month${months(s.start_date,s.end_date)>1?"s":""}</small></div><div class="fact"><span>Unit</span><b>${bedsTxt(s.beds)}${s.baths?" · "+s.baths+" ba":""}</b></div><div class="fact"><span>Includes</span><b style="font-size:14px">${[s.furnished?"Furnished":"Unfurnished",s.utilities?"Utilities":"Utilities extra"].join(" · ")}</b></div></div>
  <div class="verif"><h3>Verified</h3><ul>${vs.map(v=>`<li class="v-${v.k}"><span class="vi">${CHECK}</span><div><b>${esc(v.t)}</b><span>${esc(v.d)}</span></div></li>`).join("")}${s.has_lease_doc&&!s.lease_verified?`<li class="pending"><span class="vi">…</span><div><b>Lease being checked</b><span>The poster sent proof of residence and we're reviewing it.</span></div></li>`:""}</ul></div>
  <p class="desc">${esc(s.description)}</p>
  ${s.roommates?`<p><b>Roommates:</b> ${esc(s.roommates)}</p>`:""}
  <div class="contact" id="contact"><button class="btn primary" id="contactbtn">${CHAT_SVG}${esc(msgLabel(s))}</button>${b?`<a class="btn" href="./#b=${b.id}">See ${esc(b.name)}</a>`:""}<button class="btn ghost" id="reportbtn">Report</button></div>
  <div class="safety"><b>Stay safe.</b> See the place in person or on a live video call before you pay. Never pay by wire, gift card or crypto. Ask the landlord about their sublease or lease-transfer form, and sign it before you move in.</div>
  <div class="src">${s.example?`<span>Example listing for the demo. Photos belong to the building's owner or manager${s.photoCredit?` (<a href="${esc(s.photoCredit)}" target="_blank" rel="noopener">source</a>)`:""}.</span>`:`<span>Posted ${new Date(s.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})} by a Penn State student. Photos are the poster's own.</span>`}</div></div>`;
  const d=$("#dlg");if(!d.open)d.showModal();
  d.querySelector(".close").onclick=()=>d.close();
  const show=k=>{gi=(k+ph.length)%ph.length;const h=$("#hero");h.querySelector("img,.nophoto")?.remove();h.insertAdjacentHTML("afterbegin",photoOf(s,gi));const c=$("#gcount");if(c)c.textContent=`${gi+1} / ${ph.length}`};
  d.querySelector(".prev")?.addEventListener("click",()=>show(gi-1));d.querySelector(".next")?.addEventListener("click",()=>show(gi+1));
  d.querySelector("#allph")?.addEventListener("click",()=>lbOpen(ph,gi,s.title));
  $("#hero").addEventListener("click",e=>{if(e.target.tagName==="IMG")lbOpen(ph,gi,s.title)});
  $("#contactbtn").onclick=()=>{if(!USER){openAuth(()=>open(id));return}
    const mineChats=CHATS.filter(c=>c.sublet_id===s.id&&c.i_am==="poster"),ex=CHATS.find(c=>c.sublet_id===s.id&&c.i_am==="student");d.close();
    if(MYIDS.has(s.id)||mineChats.length)openChats();else if(ex)openChat(ex.id);else newChat(s)};
  $("#reportbtn").onclick=()=>{if(!USER){openAuth(()=>open(id));return}if(d.querySelector(".reportbox"))return;
    $("#contact").insertAdjacentHTML("afterend",`<form class="reportbox"><label>What's wrong?<select name="r"><option>Looks like a scam</option><option>Already taken</option><option>Wrong photos or details</option><option>Not a Penn State student</option><option>Something else</option></select></label><input name="x" placeholder="Details (optional)" maxlength="300"><button class="btn">Send report</button></form>`);
    d.querySelector(".reportbox").onsubmit=async e=>{e.preventDefault();const f=e.target;try{await API.report(s.id,(f.r.value+" "+f.x.value).trim());f.outerHTML=`<div class="reveal"><b>Thanks. We'll look at it.</b> Three reports hide a listing until it's checked.</div>`}catch(er){toast(er.message)}}}
}

/* ---------- sign in ---------- */
let afterAuth=null;
function openAuth(then){afterAuth=then||null;const d=$("#auth");
  $("#authbody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>Sign in with your Penn State email</h2>
  <p>Only students with a psu.edu email can post sublets or message posters. That keeps scammers out. We send you a code, no password needed.</p>
  <form id="f1" class="stack"><label>Penn State email<input name="email" type="email" required autocomplete="email" placeholder="abc1234@psu.edu" inputmode="email"></label><p class="err" id="e1" hidden></p><button class="btn primary">Send my code</button><p class="fine">By signing in, you agree to Rhedr's <a href="terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p></form>
  <form id="f2" class="stack" hidden><p id="sent"></p><label>Code from the email<input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6,10}" placeholder="12345678"></label><p class="err" id="e2" hidden></p><button class="btn primary">Sign in</button><button type="button" class="linkbtn" id="back">Use a different email</button></form>
  ${API.demo?`<p class="fine">Demo mode: no email is sent. Use any @psu.edu address and type any 6 digits.</p>`:""}</div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  let email="";const f1=$("#f1"),f2=$("#f2");
  f1.onsubmit=async e=>{e.preventDefault();email=f1.email.value.trim().toLowerCase();const er=$("#e1");er.hidden=true;
    if(!PSU_RE.test(email)&&!ADMIN_EMAILS.includes(email)){er.textContent="Use your @psu.edu email, like abc1234@psu.edu.";er.hidden=false;return}
    const btn=f1.querySelector("button");btn.disabled=true;btn.textContent="Sending…";
    try{await API.sendCode(email);f1.hidden=true;f2.hidden=false;$("#sent").innerHTML=`We sent a code to <b>${esc(email)}</b>. Check your inbox and Junk. It can take a few minutes.`;f2.code.focus()}
    catch(x){er.textContent=/rate|limit|seconds/i.test(x.message)?"Too many codes asked for. Wait a minute, then try again.":x.message;er.hidden=false}finally{btn.disabled=false;btn.textContent="Send my code"}};
  f2.onsubmit=async e=>{e.preventDefault();const er=$("#e2");er.hidden=true;try{await API.verify(email,f2.code.value.trim());d.close();toast("Signed in as "+email);const t=afterAuth;afterAuth=null;t&&t()}catch(x){er.textContent=/expired|invalid/i.test(x.message)?"That code didn't work or has expired. Ask for a new one.":x.message;er.hidden=false}};
  $("#back").onclick=()=>{f2.hidden=true;f1.hidden=false}}

/* ---------- post a sublet ---------- */
let PICS=[],LEASE_REQ=false;
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
   <div class="upl"><div class="uplh"><b>Proof you live there</b> <small>${LEASE_REQ?"(required, private)":"(optional, private)"}</small><small>A photo or PDF of your lease's first pages or a recent bill with your name and this address. Only Rhedr sees it. An AI reads it to compare it with your listing, then we delete the file once it's checked. ${LEASE_REQ?"Your listing shows once your proof is checked, and it gets the Lease checked badge.":"Once checked, your listing gets the Lease checked badge and moves to the top."}</small></div><label class="btn"><input type="file" id="lease" accept="image/*,application/pdf" hidden>Add lease proof</label><span id="leasename" class="fine"></span></div>
   <div id="warn" class="warn" hidden></div>
   <div class="earn" id="earn"></div>
   <p class="err" id="perr" hidden></p>
   <button class="btn primary big" id="pbtn">Post sublet</button>
   <p class="fine">By posting you confirm you live there or hold the lease, and that your landlord allows a sublet or transfer, or you'll get their approval first. Listings must follow the <a href="terms" target="_blank" rel="noopener">Terms of Use</a>.</p>
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
    if(LEASE_REQ&&!lease){er.textContent="Add proof that you live there: your lease's first page or a recent bill.";er.hidden=false;return}
    const btn=$("#pbtn");btn.disabled=true;btn.textContent=PICS.length?"Uploading photos…":"Posting…";
    try{const b=bById[r.building_id];let pos=b?{lat:b.lat,lng:b.lng}:await geocode(r.address);
      if(!pos)throw new Error("We couldn't find that street address in State College. Check the spelling, or pick your building from the list.");
      const s=await API.post({...r,lat:pos.lat,lng:pos.lng},PICS,lease);d.close();
      await load();toast(s.status==="review"?(LEASE_REQ&&!(s.flags||[]).length?"Posted. It will show once we've checked your lease proof.":"Posted. A few words in your listing need a quick review before it shows."):"Your sublet is live.");if(s.status==="live"&&byId[s.id])open(s.id)}
    catch(x){er.textContent=x.message;er.hidden=false}finally{btn.disabled=false;btn.textContent="Post sublet"}}}
async function geocode(addr){try{const u=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&viewbox=-77.98,40.86,-77.75,40.73&bounded=1&q=${encodeURIComponent(addr+", State College, PA")}`;
  const r=await fetch(u,{headers:{"Accept":"application/json"}});const j=await r.json();if(j[0])return {lat:+j[0].lat,lng:+j[0].lon}}catch(e){}
  return null}

/* ---------- my sublets ---------- */
async function openMine(){const d=$("#mine");$("#minebody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>My sublets</h2><p class="lead">Signed in as <b>${esc(USER.email)}</b></p><div id="mylist" class="mylist">Loading…</div><div class="cta"><button class="btn primary" id="mpost">Post a sublet</button><button class="btn" id="mmsg">Messages</button><button class="btn" id="malerts">My alerts</button><button class="btn" id="mout">Sign out</button></div></div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  $("#mpost").onclick=()=>{d.close();openPost()};$("#malerts").onclick=()=>{d.close();openAlerts()};$("#mmsg").onclick=()=>{d.close();openChats()};$("#mout").onclick=async()=>{await API.signOut();d.close();toast("Signed out")};
  const draw=async()=>{let my=[],ck={};try{const [m,c]=await Promise.all([API.mine(),API.myChecks().catch(()=>[])]);my=m;c.forEach(x=>ck[x.sublet_id]=x)}catch(e){$("#mylist").textContent=e.message;return}
    const leaseTxt=s=>s.lease_verified?" · Lease checked":s.has_lease_doc?" · Lease being checked":ck[s.id]?.decision==="rejected"?" · Lease proof not accepted":"";
    const ST={live:["Live","ok"],review:["Waiting for review","wait"],taken:["Taken","off"],removed:["Removed","off"]};
    $("#mylist").innerHTML=my.length?my.map(s=>{const st=s.end_date<today()?["Ended","off"]:ST[s.status]||[s.status,""];return `<div class="myrow"><div class="myimg">${photoOf(s)}</div><div class="myt"><b>${esc(s.title)}</b><span>${fmt(s.price)} / mo · ${dTxt(s.start_date)} – ${dTxt(s.end_date)}</span><span class="st st-${st[1]}">${st[0]}${leaseTxt(s)}</span>${!s.has_lease_doc&&ck[s.id]?.decision==="rejected"&&ck[s.id].note?`<span class="leasenote">${esc(ck[s.id].note)}</span>`:""}</div><div class="mya">${!s.has_lease_doc&&s.end_date>=today()&&s.status!=="removed"?`<label class="btn" title="Earn the Lease checked badge"><input type="file" accept="image/*,application/pdf" hidden data-lease="${s.id}">Add lease proof</label>`:""}${s.status==="live"?`<button class="btn" data-a="taken" data-id="${s.id}">Mark taken</button>`:s.status==="taken"?`<button class="btn" data-a="live" data-id="${s.id}">Relist</button>`:""}<button class="btn ghost" data-a="del" data-id="${s.id}">Delete</button></div></div>`}).join(""):`<p>You haven't posted a sublet yet.</p>`};
  $("#mylist").onchange=async e=>{const inp=e.target.closest("input[data-lease]");if(!inp||!inp.files[0])return;const lb=inp.parentElement;lb.classList.add("busy");lb.lastChild.nodeValue="Uploading…";
    try{await API.attachLease(+inp.dataset.lease,inp.files[0]);toast("Thanks. We'll check your proof and add the badge.")}catch(x){toast(x.message)}await draw()};
  $("#mylist").onclick=async e=>{const b=e.target.closest("button[data-a]");if(!b)return;const id=+b.dataset.id;
    if(b.dataset.a==="del"){if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to delete";return}await API.remove(id).catch(x=>toast(x.message))}
    else await API.setStatus(id,b.dataset.a).catch(x=>toast(x.message));await draw();load()};
  draw()}

/* ---------- messages between students ---------- */
// Emails and phone numbers stay hidden (the database masks them) until both students tap "We agreed on Rhedr".
let CHATS=[],CHAT=null,MSGS=[],MYIDS=new Set(),chatT=null,threadPoll=null,chatOff=null;
const ago=t=>{const d=(Date.now()-new Date(t))/1000;return d<60?"now":d<3600?Math.floor(d/60)+" min":d<86400?Math.floor(d/3600)+" h":new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric"})};
const clock=t=>new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const chatKey=c=>c?[c.agreed_at,c.i_agreed,c.they_agreed,c.closed_at].join("|"):"";
function setUnread(){const b=$("#msgbtn");b.hidden=!USER;const n=CHATS.reduce((a,c)=>a+(c.unread||0),0);const el=$("#msgn");el.textContent=n>9?"9+":String(n);el.hidden=!n;b.setAttribute("aria-label",n?`Messages, ${n} unread`:"Messages")}
async function refreshChats(){if(!USER){CHATS=[];setUnread();return}
  try{CHATS=await API.chats()}catch(e){console.error(e);return}setUnread();
  if(!$("#chat").open)return;
  if(!CHAT)drawInbox();
  else{const c=CHATS.find(x=>x.id===CHAT.id);if(c){const changed=chatKey(c)!==chatKey(CHAT);CHAT=c;if(changed){drawDeal();drawComposer();loadMsgs()}}}}
const refreshSoon=()=>{clearTimeout(chatT);chatT=setTimeout(refreshChats,500)};
function onChatEvent(ev){
  // a message Rhedr hid after it was sent (the AI check, or the next piece of a split number): swap the text in place
  if(ev.type==="message_hidden"&&CHAT&&ev.row.conversation_id===CHAT.id){const m=MSGS.find(x=>x.id===ev.row.id);if(m&&m.body!==ev.row.body){m.body=ev.row.body;m.masked=ev.row.masked;drawMsgs()}}
  if(ev.type==="message"&&CHAT&&ev.row.conversation_id===CHAT.id&&$("#chat").open){if(!MSGS.some(m=>m.id===ev.row.id)){MSGS.push(ev.row);drawMsgs();if(document.visibilityState==="visible")API.readChat(CHAT.id).then(refreshSoon)}}
  refreshSoon()}
function stopPoll(){clearInterval(threadPoll);threadPoll=null}
function chatShell(html){stopPoll();$("#chatbody").innerHTML=html;const d=$("#chat");if(!d.open)d.showModal();d.querySelectorAll(".close").forEach(b=>b.onclick=()=>d.close())}

/* the first time someone opens a chat: a short, friendly note on how contact info works (remembered per account) */
function chatRulesSeen(){if(!USER)return true;if(USER.user_metadata?.chat_rules_ok)return true;try{return localStorage.getItem("rhedr-chat-rules-"+USER.id)==="1"}catch(e){return false}}
function chatRules(next){if(chatRulesSeen())return false;
  chatShell(`<button class="close" aria-label="Close">×</button><div class="body chatrules"><h2>Before you chat</h2>
    <p class="lead">Rhedr chats keep both students safe until you've agreed on a deal.</p>
    <ul><li><b>Contact info stays hidden for now.</b> Phone numbers, emails, social and payment handles, and links are hidden automatically, even when they're spelled out or sent in pieces.</li>
    <li><b>Agree first, then connect.</b> When you both tap <b>We agreed on Rhedr</b>, you'll see each other's psu.edu email.</li>
    <li><b>Please don't try to get around it.</b> It's against our <a href="terms#chat-rules" target="_blank" rel="noopener">Terms of Use</a>, and accounts that keep trying can be limited.</li></ul>
    <button class="btn primary" id="rulesok">I understand</button></div>`);
  $("#rulesok").onclick=async e=>{e.target.disabled=true;try{await API.chatRulesOk()}catch(x){console.error(x)}
    try{localStorage.setItem("rhedr-chat-rules-"+USER.id,"1")}catch(x){}next()};
  return true}

async function openChats(){if(!USER){openAuth(openChats);return}if(chatRules(openChats))return;CHAT=null;
  chatShell(`<button class="close" aria-label="Close">×</button><div class="body"><h2>Messages</h2><p class="lead">Your chats with other Penn State students. Emails and phone numbers stay hidden until you both agree on Rhedr.</p><div id="inbox" class="inbox"><p class="fine">Loading…</p></div></div>`);
  await refreshChats();drawInbox()}
function drawInbox(){const el=$("#inbox");if(!el)return;
  el.innerHTML=CHATS.length?CHATS.map(c=>`<button class="crow${c.unread?" new":""}" data-c="${c.id}"><span class="myimg">${c.photo?`<img src="${esc(c.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span class="nophoto"></span>`}</span>
    <span class="ct"><span class="ct1"><b>${esc(c.other_name)}</b><small>${ago(c.last_at)}</small></span><span class="ct2">${c.i_am==="poster"?"Your sublet: ":""}${esc(c.sublet_title)}</span><span class="ct3">${c.last_from_me?"You: ":""}${esc(c.last_body||"")}</span></span>
    ${c.unread?`<span class="un" aria-label="${c.unread} unread">${c.unread}</span>`:c.agreed_at?`<span class="cchip ok">Agreed</span>`:c.closed_at?`<span class="cchip">Closed</span>`:""}</button>`).join("")
   :`<p class="empty">No messages yet. Open a sublet and tap <b>Message</b> to ask the poster about it.</p>`;
  el.onclick=e=>{const b=e.target.closest("[data-c]");if(b)openChat(+b.dataset.c)}}

async function openChat(id){if(!USER){openAuth(()=>openChat(id));return}if(chatRules(()=>openChat(id)))return;
  let c=CHATS.find(x=>x.id===id);if(!c){await refreshChats();c=CHATS.find(x=>x.id===id)}
  if(!c){toast("That chat isn't in your messages. Sign in with the email it was sent to.");return openChats()}
  CHAT=c;MSGS=[];
  const sub=c.listed&&c.sublet_id&&byId[c.sublet_id]?`<button class="linkbtn" data-open="${c.sublet_id}">${esc(c.sublet_title)}</button>`:esc(c.sublet_title);
  chatShell(`<div class="chat"><div class="chead"><button class="back" aria-label="Back to messages">‹</button><div class="chw"><b>${esc(c.other_name)}</b><span>${c.i_am==="poster"?"Your sublet · ":""}${sub}</span></div><button class="close" aria-label="Close">×</button></div>
    <div class="deal" id="deal" hidden></div><div class="msgs" id="msgs"><p class="fine">Loading…</p></div><div id="comp"></div></div>`);
  $("#chatbody .back").onclick=openChats;
  $("#chatbody .chw").onclick=e=>{const b=e.target.closest("[data-open]");if(b){$("#chat").close();open(+b.dataset.open)}};
  drawDeal();drawComposer();await loadMsgs();
  threadPoll=setInterval(()=>{if(document.visibilityState==="visible"&&$("#chat").open&&CHAT){loadMsgs(true);refreshChats()}},12000)}
async function loadMsgs(quiet){if(!CHAT)return;const id=CHAT.id;let list;try{list=await API.messages(id)}catch(e){if(!quiet)$("#msgs").innerHTML=`<p class="err">${esc(e.message)}</p>`;return}
  if(!CHAT||CHAT.id!==id)return;const grew=list.length!==MSGS.length,edited=!grew&&list.some((m,i)=>MSGS[i]?.body!==m.body);MSGS=list;if(grew||edited||!quiet)drawMsgs();
  if(grew||!quiet)API.readChat(id).then(refreshSoon).catch(()=>{})}
function msgHtml(m){if(!m.sender_id)return `<div class="m sys">${esc(m.body)}</div>`;const me=m.sender_id===USER?.id;
  return `<div class="m ${me?"me":"them"}"><div class="bub">${esc(m.body)}</div><span class="mt">${clock(m.created_at)}${m.masked?" · some of it is hidden until you both agree":""}</span></div>`}
function drawMsgs(){const el=$("#msgs");if(!el)return;
  el.innerHTML=(CHAT?.agreed_at?"":`<div class="m sys">Chats stay on Rhedr. Emails, phone numbers and payment handles are hidden until you both tap "We agreed on Rhedr". Scammers often ask to move to text or Venmo, and deals made off Rhedr aren't covered.</div>`)+MSGS.map(msgHtml).join("");
  el.scrollTop=el.scrollHeight}
async function drawDeal(){const c=CHAT,el=$("#deal");if(!c||!el)return;let h="";
  if(c.agreed_at){let k=null;try{k=await API.chatContact(c.id)}catch(e){console.error(e)}
    if(CHAT!==c)return;
    h=`<div class="dealok"><b>${CHECK} You both agreed on Rhedr</b>${k?`<div class="kgrid"><div><span>${esc(k.name)}'s email</span><a href="mailto:${esc(k.email)}">${esc(k.email)}</a></div>${k.unit?`<div><span>Unit</span><b>${esc(k.unit)}</b></div>`:""}</div>`:""}<small>Next: ask the landlord for their sublease form, and see the place before you pay. Signing the sublease on Rhedr is coming soon.</small></div>`}
  else if(c.closed_at)h="";
  else if(c.i_agreed)h=`<div class="dealq"><div><b>You tapped "We agreed on Rhedr"</b><span>Waiting for ${esc(c.other_name)}. Once they tap it too, you'll both see each other's psu.edu email.</span></div><button class="btn ghost" data-deal="0">Take it back</button></div>`;
  else if(c.they_agreed)h=`<div class="dealq hot"><div><b>${esc(c.other_name)} says you agreed</b><span>Tap to confirm. Then you'll both see each other's psu.edu email.</span></div><button class="btn primary" data-deal="1">We agreed on Rhedr</button></div>`;
  else h=`<div class="dealq"><div><b>Agreed on the place, dates and price?</b><span>When you both tap this, Rhedr shows you each other's psu.edu email.</span></div><button class="btn" data-deal="1">We agreed on Rhedr</button></div>`;
  el.innerHTML=h;el.hidden=!h;
  el.onclick=async e=>{const b=e.target.closest("[data-deal]");if(!b)return;b.disabled=true;try{await API.agree(c.id,b.dataset.deal==="1");await refreshChats();await loadMsgs()}catch(x){toast(x.message)}finally{b.disabled=false}}}
function drawComposer(){const c=CHAT,el=$("#comp");if(!c||!el)return;
  if(c.closed_at){el.innerHTML=`<p class="cclosed">This chat is closed.</p>`;return}
  el.innerHTML=`<form class="composer" id="cf"><p class="mtip" id="mtip" hidden></p><div class="cin"><textarea name="m" rows="1" maxlength="2000" placeholder="Write a message" aria-label="Message" required></textarea><button class="btn primary">Send</button></div>
    <div class="cfoot"><span>${c.agreed_at?"You both agreed, so nothing is hidden now.":"Contact info is hidden until you both agree."}</span><span><button type="button" class="linkbtn" data-x="report">Report</button> · <button type="button" class="linkbtn" data-x="close">Close chat</button></span></div></form>`;
  const f=$("#cf"),ta=f.m,btn=f.querySelector(".cin .btn");
  const grow=()=>{ta.style.height="auto";ta.style.height=Math.min(ta.scrollHeight,140)+"px"};
  ta.oninput=()=>{grow();tipFor(ta.value,!c.agreed_at)};
  ta.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&matchMedia("(pointer:fine)").matches){e.preventDefault();f.requestSubmit()}};
  f.onsubmit=async e=>{e.preventDefault();const t=ta.value.trim();if(!t)return;btn.disabled=true;
    try{const m=await API.send(c.id,t);ta.value="";grow();tipFor("");if(m&&!MSGS.some(x=>x.id===m.id))MSGS.push(m);drawMsgs();refreshSoon()}catch(x){toast(x.message)}finally{btn.disabled=false;ta.focus()}};
  f.querySelector(".cfoot").onclick=async e=>{const b=e.target.closest("[data-x]");if(!b)return;
    if(b.dataset.x==="close"){if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to close it for both of you";return}
      try{await API.closeChat(c.id);await refreshChats();toast("Chat closed")}catch(x){toast(x.message)}}
    if(b.dataset.x==="report"){if(el.querySelector(".reportbox"))return;
      el.insertAdjacentHTML("afterbegin",`<form class="reportbox"><label>What's wrong?<select name="r"><option>Looks like a scam</option><option>Asking to pay outside Rhedr</option><option>Harassment or rude</option><option>Not a real student</option><option>Something else</option></select></label><input name="x" placeholder="Details (optional)" maxlength="300"><button class="btn">Send report</button></form>`);
      el.querySelector(".reportbox").onsubmit=async ev=>{ev.preventDefault();const r=ev.target;try{await API.reportChat(c.id,(r.r.value+" "+r.x.value).trim());r.outerHTML=`<p class="cclosed">Thanks. Rhedr will read this chat and follow up. You can also close it.</p>`}catch(x){toast(x.message)}}}}}
function tipFor(v,on=true){const t=$("#mtip");if(!t)return;const hit=on&&v.trim()&&maskMessage(v.trim())!==v.trim();t.hidden=!hit;
  if(hit)t.textContent="Heads up: phone numbers, emails, links and payment handles will be hidden until you both agree on Rhedr."}

function newChat(s){if(!USER){openAuth(()=>newChat(s));return}if(chatRules(()=>newChat(s)))return;CHAT=null;MSGS=[];
  const name=s.contact_name||"the poster";let me="";try{me=localStorage.getItem("rhedr-first-name")||""}catch(e){}
  const draft=`Hi ${s.contact_name||"there"}! Is your ${s.kind==="takeover"?"lease takeover":"sublet"} at ${s.building_name||s.address} still available for ${dTxt(s.start_date)} to ${dTxt(s.end_date)}? When could I see it?`;
  chatShell(`<div class="chat"><div class="chead"><button class="back" aria-label="Back to the sublet">‹</button><div class="chw"><b>Message ${esc(name)}</b><span>${esc(s.title)}</span></div><button class="close" aria-label="Close">×</button></div>
   <form class="stack newchat" id="nc">
    <div class="ncl"><span class="myimg">${photoOf(s)}</span><div><b>${fmt(s.price)} / mo</b><span>${dTxt(s.start_date)} – ${dTxt(s.end_date)} · ${esc(s.building_name||s.address)}</span></div></div>
    <label><span>Your first name <small>(shown to ${esc(name)})</small></span><input name="n" maxlength="40" autocomplete="given-name" required value="${esc(me)}"></label>
    <label>Message<textarea name="m" rows="4" maxlength="2000" required>${esc(draft)}</textarea></label>
    <p class="mtip" id="mtip" hidden></p>
    <p class="fine">${esc(name)} won't see your email or phone number. You'll see each other's psu.edu email once you both tap "We agreed on Rhedr" in the chat.</p>
    <button class="btn primary big">Send message</button></form></div>`);
  $("#chatbody .back").onclick=()=>{$("#chat").close();open(s.id)};
  const f=$("#nc");f.m.oninput=()=>tipFor(f.m.value);
  f.onsubmit=async e=>{e.preventDefault();const n=f.n.value.trim(),m=f.m.value.trim();if(!n||!m){toast(n?"Write a message first":"Add your first name");return}
    const b=f.querySelector("button.btn");b.disabled=true;b.textContent="Sending…";
    try{try{localStorage.setItem("rhedr-first-name",n)}catch(_){}const id=await API.startChat(s.id,m,n);await refreshChats();await openChat(id)}
    catch(x){toast(x.message);b.disabled=false;b.textContent="Send message"}}}
async function loadMine(){MYIDS=new Set();if(!USER)return;try{(await API.mine()).forEach(s=>MYIDS.add(s.id))}catch(e){}}

/* ---------- sublet alerts (saved searches) ---------- */
// The same rules as public.search_matches in supabase/setup.sql
const walkMin=s=>(s.mi??miles(OM,s))*20;
function matchSearch(a,s){return (!a.kind||s.kind===a.kind)&&(!a.space||s.space===a.space)
  &&(a.beds==null||(a.beds>=4?s.beds>=4:s.beds===a.beds))&&(!a.max_price||s.price<=a.max_price)
  &&(!a.move_in_by||s.start_date<=a.move_in_by)&&(!a.stay_until||s.end_date>=a.stay_until)
  &&(!a.lease_only||!!s.lease_verified)&&(!a.query||[s.title,s.address,s.building_name].join(" ").toLowerCase().includes(a.query.toLowerCase()))
  &&(!a.max_walk_min||walkMin(s)<=a.max_walk_min)}
function alertLabel(a){const p=[];
  if(a.beds!=null)p.push(a.beds===0?"Studio":a.beds>=4?"4+ bed":a.beds+"-bed");
  p.push(a.space==="unit"?"whole place":a.space==="room"?"room":"");if(a.kind==="takeover")p.push("takeover");
  if(a.max_price)p.push("under "+fmt(a.max_price));if(a.max_walk_min)p.push(a.max_walk_min+" min walk");
  if(a.move_in_by)p.push("by "+dTxt(a.move_in_by));if(a.query)p.push(`"${a.query}"`);
  const t=p.filter(Boolean).join(", ");return (t?t[0].toUpperCase()+t.slice(1):"Any sublet").slice(0,60)}
function alertDraft(){const a={kind:null,space:null,beds:null,max_price:state.maxp<2000?state.maxp:null,max_walk_min:null,move_in_by:state.from||null,stay_until:null,query:state.q.trim()||null,lease_only:true,frequency:"daily"};
  if(["spring","summer","fall"].includes(state.tab)){const w=season(state.tab);a.move_in_by=a.move_in_by||iso(new Date(D(w.a).getTime()+14*864e5));a.stay_until=iso(new Date(D(w.b).getTime()-14*864e5))}
  if(state.tab==="takeover")a.kind="takeover";if(state.tab==="unit")a.space="unit";return a}
function alertSummary(a){return [a.space==="unit"?"Whole place":a.space==="room"?"Private room":"Room or whole place",a.kind==="takeover"?"lease takeovers":a.kind==="sublet"?"sublets only":"",
  a.beds!=null?(a.beds===0?"studio":a.beds>=4?"4+ bedrooms":a.beds+" bedrooms"):"",a.max_price?"up to "+fmt(a.max_price)+"/mo":"",a.max_walk_min?"within a "+a.max_walk_min+" min walk":"",
  a.move_in_by?"move in by "+dTxt(a.move_in_by):"",a.stay_until?"until at least "+dTxt(a.stay_until):"",a.query?`matching "${a.query}"`:"",a.lease_only?"lease checked only":""].filter(Boolean).join(" · ")}
const BELL='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
async function openAlerts(){if(!USER){openAuth(openAlerts);return}const d=$("#alerts");const a=alertDraft();const t=today();
  const opt=(v,cur,txt)=>`<option value="${v}"${String(cur??"")===String(v)?" selected":""}>${txt}</option>`;
  $("#alertsbody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>Get sublet alerts</h2>
  <p class="lead">We email <b>${esc(USER.email)}</b> when a new sublet matches. Lease-checked sublets come first.</p>
  <form id="af" class="stack" novalidate>
   <fieldset class="seg seg3"><legend>Space</legend><label><input type="radio" name="space" value=""${!a.space?" checked":""}><span><b>Either</b></span></label><label><input type="radio" name="space" value="room"${a.space==="room"?" checked":""}><span><b>Private room</b></span></label><label><input type="radio" name="space" value="unit"${a.space==="unit"?" checked":""}><span><b>Whole place</b></span></label></fieldset>
   <div class="three"><label>Bedrooms in unit<select name="beds">${opt("",a.beds,"Any")}${[0,1,2,3,4].map(n=>opt(n,a.beds,n===0?"Studio":n===4?"4 or more":n)).join("")}</select></label>
    <label>Max price / month<span class="money"><input name="max_price" type="number" min="50" max="6000" inputmode="numeric" placeholder="Any" value="${a.max_price||""}"></span></label>
    <label>Walk to Old Main<select name="max_walk_min">${opt("",a.max_walk_min,"Any distance")}${[10,15,20,30].map(n=>opt(n,a.max_walk_min,"Up to "+n+" min")).join("")}</select></label></div>
   <div class="two"><label><span>Move in by <small>(optional)</small></span><input name="move_in_by" type="date" min="${t}" value="${a.move_in_by||""}"></label><label><span>Stay until at least <small>(optional)</small></span><input name="stay_until" type="date" min="${t}" value="${a.stay_until||""}"></label></div>
   <div class="two"><label>Type<select name="kind">${opt("",a.kind,"Sublets and lease takeovers")}${opt("sublet",a.kind,"Sublets only")}${opt("takeover",a.kind,"Lease takeovers only")}</select></label><label><span>Building or street <small>(optional)</small></span><input name="query" maxlength="60" placeholder="Like Beaver Ave or The Rise" value="${esc(a.query||"")}"></label></div>
   <div class="checks"><label><input type="checkbox" name="lease_only"${a.lease_only?" checked":""}> Only lease-checked sublets <small class="hint">(recommended)</small></label></div>
   <fieldset class="seg"><legend>How often</legend><label><input type="radio" name="frequency" value="daily" checked><span><b>Once a day</b><small>One email in the morning with everything new</small></span></label><label><input type="radio" name="frequency" value="instant"><span><b>As they're posted</b><small>Within about 15 minutes</small></span></label></fieldset>
   <label>Name this alert<input name="label" maxlength="60" placeholder="Summer 2-bed under $900"></label>
   <p class="matchnow" id="amatch"></p>
   <p class="err" id="aerr" hidden></p>
   <button class="btn primary big" id="abtn">${BELL}Save alert</button>
   <p class="fine">Every email has a link to turn it off. Up to 5 alerts at once. ${API.demo?"Demo mode: alerts are saved in this browser and no email is sent.":""}</p>
  </form>
  <h3 class="myalerts-h">Your alerts</h3><div id="alist" class="mylist">Loading…</div></div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();
  const f=$("#af");let named=false;
  const row=()=>{const n=v=>v===""?null:+v;return {space:f.space.value||null,kind:f.kind.value||null,beds:n(f.beds.value),max_price:n(f.max_price.value),max_walk_min:n(f.max_walk_min.value),
    move_in_by:f.move_in_by.value||null,stay_until:f.stay_until.value||null,query:f.query.value.trim()||null,lease_only:f.lease_only.checked,frequency:f.frequency.value}};
  const refresh=()=>{const r=row();if(!named)f.label.value=alertLabel(r);const all=ALL.filter(s=>!s.example&&matchSearch({...r,lease_only:false},s)),n=r.lease_only?all.filter(s=>s.lease_verified).length:all.length;
    $("#amatch").innerHTML=r.lease_only&&all.length>n?`<b>${n}</b> lease-checked sublet${n===1?"":"s"} match right now (<b>${all.length}</b> counting ones without a lease check). We'll email you about new ones.`
      :`<b>${n}</b> sublet${n===1?"":"s"} match${n===1?"es":""} right now. We'll email you about new ones.`};
  f.label.addEventListener("input",()=>{named=!!f.label.value.trim()});
  f.move_in_by.addEventListener("change",()=>{f.stay_until.min=f.move_in_by.value||t});
  f.addEventListener("input",refresh);f.addEventListener("change",refresh);refresh();
  const draw=async()=>{let list=[];try{list=await API.searches()}catch(e){$("#alist").textContent=e.message;return}
    $("#alist").innerHTML=list.length?list.map(x=>`<div class="myrow arow"><div class="myt"><b>${esc(x.label)}</b><span>${esc(alertSummary(x))}</span><span class="st ${x.active?"st-ok":"st-off"}">${x.active?(x.frequency==="instant"?"On · as they're posted":"On · once a day"):"Off"}</span></div>
      <div class="mya"><button class="btn" data-a="${x.active?"off":"on"}" data-id="${x.id}">${x.active?"Turn off":"Turn on"}</button><button class="btn ghost" data-a="del" data-id="${x.id}">Delete</button></div></div>`).join("")
      :`<p class="fine">No alerts yet. Save one above.</p>`};
  $("#alist").onclick=async e=>{const b=e.target.closest("button[data-a]");if(!b)return;const id=+b.dataset.id;
    try{if(b.dataset.a==="del"){if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to delete";return}await API.deleteSearch(id)}
      else await API.updateSearch(id,{active:b.dataset.a==="on"})}catch(x){toast(x.message)}draw()};
  f.onsubmit=async e=>{e.preventDefault();const er=$("#aerr");er.hidden=true;const r=row();
    if(r.max_price!=null&&(r.max_price<50||r.max_price>6000)){er.textContent="Enter a max price between $50 and $6,000, or leave it empty.";er.hidden=false;return}
    if(r.move_in_by&&r.stay_until&&r.stay_until<r.move_in_by){er.textContent="\"Stay until\" has to be after the move-in day.";er.hidden=false;return}
    const btn=$("#abtn");btn.disabled=true;
    try{await API.saveSearch({...r,label:f.label.value.trim()||alertLabel(r)});toast(r.frequency==="instant"?"Alert saved. We'll email you as matching sublets post.":"Alert saved. We'll email you each morning there's something new.");named=false;await draw()}
    catch(x){er.textContent=x.message;er.hidden=false}finally{btn.disabled=false}};
  draw()}
// the "Turn off" links in alert emails land here
async function unsubscribeFromLink(token,all){const d=$("#alerts");let msg;
  try{const n=await API.unsubscribe(token,all);msg=n?(all?"All your Rhedr alerts are off. You won't get more alert emails.":"That alert is off. You won't get more emails for it."):"That alert was already off."}
  catch(e){msg="We couldn't turn it off: "+e.message+". Try the link again, or email support@rhedr.com."}
  $("#alertsbody").innerHTML=`<button class="close" aria-label="Close">×</button><div class="body"><h2>Sublet alerts</h2><p>${esc(msg)}</p><div class="cta"><button class="btn" id="amanage">Manage alerts</button><button class="btn primary" id="adone">Done</button></div></div>`;
  if(!d.open)d.showModal();d.querySelector(".close").onclick=()=>d.close();$("#adone").onclick=()=>d.close();$("#amanage").onclick=()=>{d.close();openAlerts()}}

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
  $("#alertbtn").onclick=openAlerts;
  $("#acctbtn").onclick=()=>USER?openMine():openAuth();
  $("#maptoggle").onclick=()=>{headH();document.body.classList.toggle("showmap");$("#maptoggle span").textContent=document.body.classList.contains("showmap")?"Show list":"Show map";if(document.body.classList.contains("showmap"))setTimeout(()=>{MAP.resize();MAP.fit()},30);else window.scrollTo(0,0)};
  $("#msgbtn").onclick=openChats;
  ["#dlg","#auth","#post","#mine","#alerts","#chat"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).close()}));
  window.addEventListener("resize",()=>{headH();MAP.resize()});headH();document.fonts?.ready.then(headH);
}
async function load(){try{ALL=await API.list()}catch(e){console.error(e);toast("Couldn't load sublets: "+e.message);ALL=[]}
  byId={};ALL.forEach(s=>{s.mi=miles(OM,s);byId[s.id]=s});renderTabs();renderList()}
async function start(){wire();lbInit();$("#demonote").hidden=!API.demo;
  try{BLD=await (await fetch("data/listings.json")).json();BLD.forEach(b=>bById[b.id]=b)}catch(e){console.error(e)}
  API.onAuth(u=>{const was=USER;USER=u;setAcct();setUnread();
    if((was?.id||null)!==(u?.id||null)){chatOff?.();chatOff=u?API.onChat(onChatEvent):null;CHATS=[];MYIDS=new Set();if(u){refreshChats();loadMine()}else if($("#chat").open)$("#chat").close()}
    if(!!was!==!!u&&ALL.length)renderList()});
  setInterval(()=>{if(USER&&document.visibilityState==="visible"&&!threadPoll)refreshChats()},60000);
  $("#chat").addEventListener("close",()=>{stopPoll();CHAT=null});
  API.settings().then(x=>{LEASE_REQ=!!x?.lease_proof_required}).catch(()=>{});
  await load();
  try{if(CFG.googleMapsApiKey)await initGoogle();else await initLeaflet()}catch(e){console.error("Map failed, using OpenStreetMap",e);try{if(!MAP.ready)await initLeaflet()}catch(_){}}
  // links from emails: ?s=123 opens a sublet, ?alerts=1 opens your alerts, ?unsubscribe=... turns an alert off
  const qs=new URLSearchParams(location.search),clean=()=>history.replaceState(null,"",location.pathname+location.hash);
  if(qs.get("unsubscribe")){unsubscribeFromLink(qs.get("unsubscribe"),qs.get("all")==="1");clean()}
  else if(qs.get("s")){const id=+qs.get("s");if(byId[id])open(id);else toast("That sublet is no longer listed.");clean()}
  else if(qs.get("alerts")==="1"){openAlerts();clean()}
  else if(qs.get("chat")){const id=+qs.get("chat");clean();if(USER)openChat(id);else openAuth(()=>openChat(id))}
  else if(/[?&]post=1/.test(location.search))openPost();
}
start();
})();
