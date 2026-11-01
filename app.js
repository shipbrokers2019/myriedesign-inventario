/* Myriedesign Inventario — app instalable (PWA) sobre Supabase. Montos solo en USD. */
(() => {
"use strict";

/* ---------- catálogos ---------- */
const TIPOS = ["Dije","Cadena","Pulsera","Placa","Llavero","Zarcillos","Anillo","Tobillera","Sobre","Libro","Péndulo","Bolígrafo","Placa de mascota","Otro"];
const PREF = {Dije:"DIJ",Cadena:"CAD",Pulsera:"PUL",Placa:"PLA",Llavero:"LLA",Zarcillos:"ZAR",Anillo:"ANI",Tobillera:"TOB",Sobre:"SOB",Libro:"LIB","Péndulo":"PEN","Bolígrafo":"BOL","Placa de mascota":"PLM",Otro:"OTR"};
const MATS = ["Acero","Oro / baño de oro","Fantasía"];
const MATCODE = {"Acero":"AC","Oro / baño de oro":"OR","Fantasía":"FA"};
const FORMAS = ["Corazón","Huesito","Cuero","Redondo","Cuadrado","Rectangular","Ovalado","Estrella","Cruz","Letra","Infinito","Mariposa","Trébol","Luna"];
const MEDIDAS = ["6 mm","8 mm","10 mm","12 mm","15 mm","18 mm","20 mm","25 mm","30 mm","40 cm","45 cm","50 cm","60 cm","18 cm","20 cm"];
const BUCKET = "inventario-fotos";

/* ---------- estado ---------- */
const S = { products:[], movs:[], loading:true, error:null, view:"inv", q:"", tipo:"Todos", mat:"Todos", movF:"Todos", sheet:null, picking:false };
let sb = null, me = null;

/* ---------- utilidades ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n2 = v => Number(v||0).toLocaleString("es-VE",{minimumFractionDigits:2,maximumFractionDigits:2});
const usd = v => "$" + n2(v);
const parseNum = v => { let s=String(v??"").trim().replace(/\s/g,""); if(s.includes(",")) s=s.replace(/\./g,"").replace(",","."); const x=Number(s); return s!=="" && isFinite(x) ? x : NaN; };
const nombre = p => [p.tipo, p.forma, p.medida].filter(Boolean).join(" ");
const norm = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9 ]/g,"");
const num = v => Number(v)||0;
const stockClass = p => num(p.stock) <= 0 ? "out" : (num(p.stock) <= num(p.minimo) ? "low" : "");
const byId = id => S.products.find(p=>p.id===id);
const fotoUrl = path => path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "";
const movNom = m => { const p=byId(m.producto_id); return p ? nombre(p) : m.nombre; };
const movCod = m => { const p=byId(m.producto_id); return p ? p.codigo : m.codigo; };
const who = m => m.usuario && me && m.usuario===me.id ? "Tú" : String(m.usuario_email||"").split("@")[0];
const startOfDay = (d=new Date()) => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
const startOfMonth = () => { const x=startOfDay(); x.setDate(1); return x; };
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej({code:"timeout"}),ms))]);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function thumbHtml(p, cls="thumb"){
  const letter = esc((p.tipo||"P")[0]);
  return p.foto
    ? `<span class="${cls}"><img src="${esc(fotoUrl(p.foto))}" alt="" loading="lazy" data-letter="${letter}"></span>`
    : `<span class="${cls}"><span class="mono">${letter}</span></span>`;
}
document.addEventListener("error", e=>{
  const img=e.target; if(img.tagName!=="IMG" || !img.dataset.letter) return;
  const s=document.createElement("span"); s.className="mono"; s.textContent=img.dataset.letter; img.replaceWith(s);
}, true);

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, msg.length>45?6000:2600); }

function errMsg(e){
  const raw = (e && (e.message || e.error_description || e.msg)) || "";
  const c = e && e.code;
  if(c==="stock") return e.message;
  if(c==="timeout") return "La operación tardó demasiado. Revisa tu conexión e intenta de nuevo.";
  if(c==="heic") return "No se pudo leer esta foto. Elige otra o toma la foto en formato JPG.";
  if(c==="too_large") return "La foto es muy pesada. Prueba con otra.";
  if(c==="23505" || /duplicate key/i.test(raw)) return "Ya existe otra pieza con ese código.";
  if(/Solo hay|ya no existe|La cantidad|El conteo|Inicia sesión/.test(raw)) return raw.replace(/^.*?(Solo hay|Esta pieza|La cantidad|El conteo|Inicia sesión)/,"$1");
  if(/JWT|not authenticated|401/i.test(raw)) return "Tu sesión venció. Sal y vuelve a entrar.";
  if(!navigator.onLine || /Failed to fetch|NetworkError|network/i.test(raw)) return "No hay conexión a internet. Intenta de nuevo cuando vuelva.";
  return "No se pudo guardar. Intenta de nuevo." + (raw ? " (" + raw.slice(0,80) + ")" : "");
}
const check = ({data,error}) => { if(error) throw error; return data; };

/* ---------- datos ---------- */
async function loadProducts(){
  const rows = check(await sb.from("inv_productos").select("*").order("codigo").limit(5000));
  S.products = rows;
}
async function loadMovs(){
  const rows = check(await sb.from("inv_movimientos").select("*").order("fecha",{ascending:false}).limit(1000));
  S.movs = rows;
}
async function refresh(which="all"){
  try{
    if(which==="all"||which==="p") await loadProducts();
    if(which==="all"||which==="m") await loadMovs();
    S.error=null;
  }catch(e){ S.error=errMsg(e); }
  S.loading=false; render();
}
const pending={p:false,m:false}; let refreshTimer=null;
function scheduleRefresh(which){
  pending[which]=true; clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>{ const w = pending.p&&pending.m ? "all" : pending.p ? "p" : "m"; pending.p=pending.m=false; refresh(w); }, 350);
}

/* ---------- vistas ---------- */
function render(){
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-current", b.dataset.tab===S.view ? "page":"false"));
  $("#v-inv").hidden = S.view!=="inv"; $("#v-mov").hidden = S.view!=="mov"; $("#v-res").hidden = S.view!=="res";
  $("#fab").hidden = S.view!=="inv";
  if(S.view==="inv") renderInv(); else if(S.view==="mov") renderMov(); else renderRes();
  if(S.sheet && S.sheet.kind==="detail" && !S.picking) renderDetail(S.sheet.pid);
}
function noticeHtml(){
  if(S.error) return `<div class="notice">${esc(S.error)}</div>`;
  return "";
}
function renderChips(el, opts, cur, attr){
  const html = opts.map(o=>`<button type="button" class="chip" ${attr}="${esc(o)}" aria-pressed="${o===cur}">${esc(o)}</button>`).join("");
  if(el._h!==html){ el.innerHTML=html; el._h=html; }
}
function filtered(){
  const q = norm(S.q).trim();
  return S.products.filter(p=>{
    if(S.tipo!=="Todos" && p.tipo!==S.tipo) return false;
    if(S.mat!=="Todos" && p.material!==S.mat) return false;
    if(!q) return true;
    const hay = norm([nombre(p), p.codigo, p.material, p.acabado, p.notas].join(" "));
    return q.split(/\s+/).every(w=>hay.includes(w));
  }).sort((a,b)=> (a.tipo||"").localeCompare(b.tipo||"","es") || nombre(a).localeCompare(nombre(b),"es",{numeric:true}));
}
function renderInv(){
  $("#invNotice").innerHTML = noticeHtml();
  const tiposUsados = TIPOS.filter(t=>S.products.some(p=>p.tipo===t));
  const extra = [...new Set(S.products.map(p=>p.tipo).filter(t=>t && !TIPOS.includes(t)))];
  renderChips($("#chipsTipo"), ["Todos", ...tiposUsados, ...extra], S.tipo, "data-tipo");
  renderChips($("#chipsMat"), ["Todos", ...MATS], S.mat, "data-mat");
  const list = filtered();
  const units = list.reduce((a,p)=>a+num(p.stock),0);
  $("#invCount").textContent = S.products.length ? `${list.length} ${list.length===1?"pieza":"piezas"} · ${units} unidades` : "";
  const box = $("#invList");
  if(S.loading){ box.innerHTML = `<div class="empty"><p>Cargando inventario…</p></div>`; return; }
  if(!S.products.length){
    box.innerHTML = `<div class="empty"><h3>Tu vitrina está vacía</h3><p>Aquí aparecerán tus dijes, cadenas, pulseras, placas y llaveros con su foto, medida, material y existencia.</p><button class="btn" type="button" data-act="nueva">Agregar la primera pieza</button><button class="btn ghost" type="button" data-act="importar">Traer datos de la app anterior</button></div>`;
    return;
  }
  if(!list.length){ box.innerHTML = `<div class="empty"><p>Ninguna pieza coincide con la búsqueda o el filtro.</p></div>`; return; }
  const html = `<ul class="list">${list.map(p=>`<li><button type="button" class="item" data-pid="${esc(p.id)}">
    ${thumbHtml(p)}
    <span class="info"><span class="name">${esc(nombre(p))}</span>
      <span class="meta"><span class="num">${esc(p.codigo)}</span> · ${esc(p.material||"")}${p.acabado?" · "+esc(p.acabado):""}</span>
      <span class="price num">${usd(p.precio)}</span></span>
    <span class="stock ${stockClass(p)}"><b>${num(p.stock)}</b><small>${stockClass(p)==="out"?"agotado":stockClass(p)==="low"?"reponer":"und"}</small></span>
  </button></li>`).join("")}</ul>`;
  if(box._h!==html){ box.innerHTML=html; box._h=html; }
}
function dayLabel(d){
  const t=startOfDay(), y=new Date(t); y.setDate(t.getDate()-1);
  if(d>=t) return "Hoy"; if(d>=y) return "Ayer";
  return d.toLocaleDateString("es-VE",{weekday:"long",day:"numeric",month:"long"});
}
function renderMov(){
  renderChips($("#chipsMov"), ["Todos","Ventas","Entradas","Ajustes"], S.movF, "data-movf");
  const map={Ventas:"venta",Entradas:"entrada",Ajustes:"ajuste"};
  const list = S.movs.filter(m=>S.movF==="Todos"||m.tipo===map[S.movF]);
  const box=$("#movList");
  if(!list.length){
    box.innerHTML = `${noticeHtml()}<div class="empty"><h3>Sin movimientos</h3><p>Cada venta descuenta del inventario y cada entrada de mercancía lo suma. Todo queda registrado aquí con fecha y quién lo hizo.</p></div>`;
    return;
  }
  let html=noticeHtml(), cur="";
  for(const m of list){
    const d=new Date(m.fecha), lbl=dayLabel(d);
    if(lbl!==cur){ if(cur) html+="</ul>"; html+=`<div class="daylabel">${esc(lbl)}</div><ul class="list">`; cur=lbl; }
    const sign = m.tipo==="venta" ? "−" : m.tipo==="entrada" ? "+" : "=";
    const qty = m.tipo==="ajuste" ? (m.cantidad>0?"+":"")+m.cantidad : (m.tipo==="venta"?"−":"+")+m.cantidad;
    const amount = m.tipo==="venta" ? usd(m.cantidad*num(m.precio)) : m.tipo==="entrada" ? usd(m.cantidad*num(m.costo)) : "Conteo";
    const sub = [d.toLocaleTimeString("es-VE",{hour:"numeric",minute:"2-digit"}), who(m)].filter(Boolean).join(" · ");
    html+=`<li><button type="button" class="mov" data-mid="${esc(m.id)}"><span class="badge ${m.tipo}">${sign}</span>
      <span class="info"><span class="name">${esc(movNom(m))}</span><span class="meta"><span class="num">${esc(movCod(m))}</span> · ${esc(sub)}${m.nota?" · "+esc(m.nota):""}</span></span>
      <span class="r"><span class="num">${qty} und</span><small class="num">${amount}</small></span></button></li>`;
  }
  html+="</ul>";
  if(box._h!==html){ box.innerHTML=html; box._h=html; }
}
function renderRes(){
  const el=$("#v-res");
  const today=startOfDay(), month=startOfMonth();
  const sales = S.movs.filter(m=>m.tipo==="venta");
  const sum = (arr,f)=>arr.reduce((a,m)=>a+f(m),0);
  const sToday = sales.filter(m=>new Date(m.fecha)>=today), sMonth = sales.filter(m=>new Date(m.fecha)>=month);
  const vToday = sum(sToday,m=>m.cantidad*num(m.precio)), vMonth = sum(sMonth,m=>m.cantidad*num(m.precio));
  const gMonth = sum(sMonth,m=>m.cantidad*(num(m.precio)-num(m.costo)));
  const uToday = sum(sToday,m=>m.cantidad), uMonth = sum(sMonth,m=>m.cantidad);
  const units = S.products.reduce((a,p)=>a+num(p.stock),0);
  const atCost = S.products.reduce((a,p)=>a+num(p.stock)*num(p.costo),0);
  const atPrice = S.products.reduce((a,p)=>a+num(p.stock)*num(p.precio),0);
  const low = S.products.filter(p=>stockClass(p)).sort((a,b)=>num(a.stock)-num(b.stock));
  const top = {}; sMonth.forEach(m=>{ const k=m.producto_id||m.codigo; top[k]=top[k]||{n:movNom(m),u:0}; top[k].u+=m.cantidad; });
  const topL = Object.values(top).sort((a,b)=>b.u-a.u).slice(0,5); const topMax = topL[0]?.u||1;
  const porTipo = {}; S.products.forEach(p=>{ porTipo[p.tipo]=(porTipo[p.tipo]||0)+num(p.stock); });
  const tipoL = Object.entries(porTipo).sort((a,b)=>b[1]-a[1]); const tipoMax = Math.max(1,...tipoL.map(t=>t[1]));
  const mesNombre = month.toLocaleDateString("es-VE",{month:"long"});
  el.innerHTML = `${noticeHtml()}
  <div class="tiles">
    <div class="tile wide"><span>Ventas de ${esc(mesNombre)}</span><strong>${usd(vMonth)}</strong><small>${uMonth} und vendidas</small></div>
    <div class="tile"><span>Ventas de hoy</span><strong>${usd(vToday)}</strong><small>${uToday} und</small></div>
    <div class="tile"><span>Ganancia del mes</span><strong>${usd(gMonth)}</strong><small>precio menos costo</small></div>
    <div class="tile"><span>Inventario a costo</span><strong>${usd(atCost)}</strong><small>${units} und</small></div>
    <div class="tile"><span>A precio de venta</span><strong>${usd(atPrice)}</strong><small>${S.products.length} piezas</small></div>
  </div>
  <div class="panel"><h2>Por reponer</h2>${low.length? low.slice(0,15).map(p=>`<div class="mini"><span>${esc(nombre(p))} <span class="num" style="color:var(--muted)">${esc(p.codigo)}</span></span><span class="num" style="color:var(--${stockClass(p)==="out"?"bad":"warn"})">${num(p.stock)} / mín ${num(p.minimo)}</span></div>`).join("") : `<p style="margin:0;color:var(--muted)">Todo está por encima del stock mínimo.</p>`}</div>
  <div class="panel"><h2>Más vendidos en ${esc(mesNombre)}</h2>${topL.length? topL.map(t=>`<div class="bar"><span class="lbl">${esc(t.n)}</span><span class="num">${t.u} und</span><div class="track"><div class="fill" style="width:${(t.u/topMax*100).toFixed(1)}%"></div></div></div>`).join("") : `<p style="margin:0;color:var(--muted)">Aún no hay ventas este mes.</p>`}</div>
  <div class="panel"><h2>Existencia por tipo</h2>${tipoL.length? tipoL.map(([t,u])=>`<div class="bar"><span class="lbl">${esc(t)}</span><span class="num">${u} und</span><div class="track"><div class="fill" style="width:${(u/tipoMax*100).toFixed(1)}%;background:var(--plum)"></div></div></div>`).join("") : `<p style="margin:0;color:var(--muted)">Agrega piezas para ver la distribución.</p>`}</div>`;
}

/* ---------- hoja inferior ---------- */
function openSheet(html, state){ S.sheet=state||{kind:"x"}; const b=$("#sheetBody"); b.innerHTML=html; b._h=null; $("#scrim").hidden=false; $("#sheet").hidden=false; $("#sheet").scrollTop=0; }
function closeSheet(){ S.sheet=null; S.picking=false; $("#scrim").hidden=true; $("#sheet").hidden=true; $("#sheetBody").innerHTML=""; }
$("#scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && S.sheet) closeSheet(); });

function renderDetail(pid){
  const p = byId(pid);
  if(!p){ closeSheet(); return; }
  const margen = num(p.precio)-num(p.costo);
  const pct = num(p.precio) ? Math.round(margen/num(p.precio)*100) : 0;
  const movs = S.movs.filter(m=>m.producto_id===pid).slice(0,5);
  const html = `<div class="sh">
    <div class="hero">${p.foto?`<img src="${esc(fotoUrl(p.foto))}" alt="${esc(nombre(p))}" data-letter="${esc((p.tipo||"P")[0])}">`:`<span class="mono">${esc((p.tipo||"P")[0])}</span>`}</div>
    <span class="btn ${p.foto?"ghost":"soft"} pick" style="width:100%;min-height:48px;font-size:15px"><span class="pick-lbl">${p.foto?"Cambiar foto":"📷 Agregar foto"}</span><input id="dt-foto" type="file" accept="image/*" aria-label="Elegir foto"></span>
    <h2>${esc(nombre(p))}</h2>
    <div class="tags"><span class="tag code">${esc(p.codigo)}</span><span class="tag">${esc(p.material||"")}</span>${p.acabado?`<span class="tag">${esc(p.acabado)}</span>`:""}</div>
    <div class="kv">
      <div><span>Precio</span><b>${usd(p.precio)}</b></div>
      <div><span>Costo</span><b>${usd(p.costo)}</b><small>margen ${pct}%</small></div>
      <div><span>Existencia</span><b style="color:var(--${stockClass(p)==="out"?"bad":stockClass(p)==="low"?"warn":"ink"})">${num(p.stock)} und</b><small>mínimo ${num(p.minimo)}</small></div>
    </div>
    ${p.notas?`<p style="margin:0;color:var(--muted)">${esc(p.notas)}</p>`:""}
    <div class="row"><button class="btn" type="button" data-act="venta">Vender</button><button class="btn soft" type="button" data-act="entrada">Entrada</button></div>
    <div class="row"><button class="btn ghost" type="button" data-act="ajuste">Ajustar conteo</button><button class="btn ghost" type="button" data-act="editar">Editar</button></div>
    ${movs.length?`<div><div class="daylabel" style="margin:0 0 6px">Últimos movimientos</div>${movs.map(m=>`<div class="mini"><span>${new Date(m.fecha).toLocaleDateString("es-VE",{day:"numeric",month:"short"})} · ${m.tipo==="venta"?"Venta":m.tipo==="entrada"?"Entrada":"Ajuste"}</span><span class="num">${m.tipo==="venta"?"−":m.tipo==="entrada"?"+":(m.cantidad>0?"+":"")}${m.cantidad} und</span></div>`).join("")}</div>`:""}
    <button class="btn danger" type="button" data-act="eliminar">Eliminar pieza</button>
  </div>`;
  const sb_=$("#sheetBody");
  if(sb_._h!==html){ sb_.innerHTML=html; sb_._h=html; }
}

/* ---------- formulario de pieza ---------- */
function pieceForm(p){
  const isNew=!p; p = p || {tipo:S.tipo!=="Todos"?S.tipo:"Dije", material:S.mat!=="Todos"?S.mat:"Acero", stock:0, minimo:2};
  const tipoOpts = [...new Set([...TIPOS, p.tipo].filter(Boolean))];
  openSheet(`<form class="f sh" id="pf" novalidate>
    <h2>${isNew?"Nueva pieza":"Editar pieza"}</h2>
    <div class="photo-pick">${thumbHtml(p)}<div style="display:flex;flex-direction:column;gap:4px">
      <span class="btn ghost pick"><span class="pick-lbl">${p.foto?"Cambiar foto":"Agregar foto"}</span><input id="pf-foto" type="file" accept="image/*" aria-label="Elegir foto"></span>
    </div></div>
    <div class="grid2">
      <div class="fld"><label for="pf-tipo">Tipo</label><select id="pf-tipo">${tipoOpts.map(t=>`<option ${t===p.tipo?"selected":""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="fld"><label for="pf-mat">Material</label><select id="pf-mat">${[...new Set([...MATS,p.material].filter(Boolean))].map(m=>`<option ${m===p.material?"selected":""}>${esc(m)}</option>`).join("")}</select></div>
    </div>
    <div class="fld"><label for="pf-forma">Forma o modelo</label><input id="pf-forma" value="${esc(p.forma||"")}" placeholder="Toca una opción o escribe" autocomplete="off">
      <div class="chips sub">${FORMAS.map(f=>`<button type="button" class="chip" data-fill="pf-forma" data-val="${esc(f)}">${esc(f)}</button>`).join("")}</div></div>
    <div class="fld"><label for="pf-medida">Medida</label><input id="pf-medida" value="${esc(p.medida||"")}" placeholder="Toca una opción o escribe" autocomplete="off">
      <div class="chips sub">${MEDIDAS.map(f=>`<button type="button" class="chip" data-fill="pf-medida" data-val="${esc(f)}">${esc(f)}</button>`).join("")}</div></div>
    <div class="fld"><label for="pf-acabado">Color o acabado</label><input id="pf-acabado" value="${esc(p.acabado||"")}" placeholder="Dorado, plateado, con circón…"></div>
    <div class="grid2">
      <div class="fld"><label for="pf-costo">Costo (USD)</label><input id="pf-costo" inputmode="decimal" value="${p.costo!=null?esc(String(p.costo).replace(".",",")):""}" placeholder="0,00"></div>
      <div class="fld"><label for="pf-precio">Precio venta (USD)</label><input id="pf-precio" inputmode="decimal" value="${p.precio!=null?esc(String(p.precio).replace(".",",")):""}" placeholder="0,00"></div>
      ${isNew?`<div class="fld"><label for="pf-stock">Existencia inicial</label><input id="pf-stock" inputmode="numeric" value="${p.stock}"></div>`:""}
      <div class="fld"><label for="pf-min">Stock mínimo</label><input id="pf-min" inputmode="numeric" value="${num(p.minimo)}"></div>
    </div>
    <div class="fld"><label for="pf-codigo">Código</label><input id="pf-codigo" value="${esc(p.codigo||"")}" style="font-family:var(--f-mono)"><span class="hint">Se arma solo con tipo, forma, medida y material. Puedes cambiarlo.</span></div>
    <div class="fld"><label for="pf-notas">Notas</label><textarea id="pf-notas" placeholder="Proveedor, ubicación en la vitrina…">${esc(p.notas||"")}</textarea></div>
    <p class="err" id="pf-err" hidden></p>
    <div class="row"><button class="btn ghost" type="button" data-act="cerrar">Cancelar</button><button class="btn" type="submit" id="pf-save">${isNew?"Guardar pieza":"Guardar cambios"}</button></div>
  </form>`, {kind:"form", pid:p.id||null});
  const f=$("#pf"); let codeTouched = !isNew; let file=null;
  const upd = () => { if(!codeTouched) $("#pf-codigo").value = genCode(readForm(), p.id); };
  ["pf-tipo","pf-mat","pf-forma","pf-medida"].forEach(id=>$("#"+id).addEventListener("input",upd));
  $("#pf-tipo").addEventListener("change",upd); $("#pf-mat").addEventListener("change",upd);
  $("#pf-codigo").addEventListener("input",()=>codeTouched=true);
  if(isNew) upd();
  const fi=$("#pf-foto");
  fi.addEventListener("change", ()=>{ S.picking=false; file=fi.files[0]||null; if(!file) return;
    fi.parentNode.querySelector(".pick-lbl").textContent="Foto lista ✓";
    const u=URL.createObjectURL(file); f.querySelector(".photo-pick .thumb").innerHTML=`<img src="${u}" alt="">`; });
  f.addEventListener("submit", async e=>{
    e.preventDefault();
    const d=readForm(), err=$("#pf-err"); err.hidden=true;
    const fail = m => { err.textContent=m; err.hidden=false; };
    if(isNaN(d.costo)||isNaN(d.precio)||d.costo<0||d.precio<0) return fail("Revisa el costo y el precio: usa números como 3,50.");
    if(isNew && (!Number.isInteger(d.stock)||d.stock<0)) return fail("La existencia inicial debe ser un número entero.");
    if(!Number.isInteger(d.minimo)||d.minimo<0) return fail("El stock mínimo debe ser un número entero.");
    if(!d.codigo) d.codigo = genCode(d, p.id);
    if(S.products.some(x=>x.codigo===d.codigo && x.id!==p.id)) return fail("Ya existe otra pieza con ese código.");
    const btn=$("#pf-save"); btn.disabled=true; btn.textContent="Guardando…";
    try{
      const body={tipo:d.tipo,material:d.material,forma:d.forma,medida:d.medida,acabado:d.acabado,costo:d.costo,precio:d.precio,minimo:d.minimo,codigo:d.codigo,notas:d.notas,actualizado:new Date().toISOString()};
      let id=p.id;
      if(isNew){
        const row = check(await sb.from("inv_productos").insert({...body, stock:0}).select().single());
        id=row.id;
        if(d.stock>0) check(await sb.rpc("inv_registrar_movimiento",{p_producto:id,p_tipo:"entrada",p_cantidad:d.stock,p_monto:d.costo,p_nota:"Existencia inicial",p_nuevo_precio:null,p_actualizar_costo:false}));
      } else {
        check(await sb.from("inv_productos").update(body).eq("id",id));
      }
      let fotoErr=null;
      if(file){ btn.textContent="Subiendo foto…"; try{ await setFoto(id, file, isNew?null:p.foto); }catch(fx){ fotoErr=fx; } }
      await refresh();
      closeSheet();
      openSheet("",{kind:"detail",pid:id}); renderDetail(id);
      toast(fotoErr ? (isNew?"Pieza guardada sin foto. ":"Cambios guardados sin foto. ")+errMsg(fotoErr) : (isNew?"Pieza guardada":"Cambios guardados"));
    }catch(ex){ fail(errMsg(ex)); btn.disabled=false; btn.textContent=isNew?"Guardar pieza":"Guardar cambios"; }
  });
}
function readForm(){
  const v=id=>($("#"+id)?.value||"").trim();
  return {tipo:v("pf-tipo"),material:v("pf-mat"),forma:v("pf-forma"),medida:v("pf-medida"),acabado:v("pf-acabado"),
    costo:v("pf-costo")===""?0:parseNum(v("pf-costo")),precio:v("pf-precio")===""?0:parseNum(v("pf-precio")),
    stock:$("#pf-stock")?Number(v("pf-stock")||0):0,minimo:Number(v("pf-min")||0),codigo:v("pf-codigo").toUpperCase(),notas:v("pf-notas")};
}
function genCode(f, exclude){
  const t = PREF[f.tipo] || norm(f.tipo).slice(0,3) || "PZA";
  const fo = norm(f.forma).split(" ").filter(Boolean).map(w=>w.slice(0,3)).slice(0,2).join("");
  const mm = (f.medida||"").replace(/[^0-9.,]/g,"").replace(/[.,]/g,"");
  const base = [t,fo,mm,MATCODE[f.material]||""].filter(Boolean).join("-");
  let code=base, i=2; while(S.products.some(p=>p.codigo===code && p.id!==exclude)) code=base+"-"+(i++);
  return code;
}

/* ---------- fotos: centrar, achicar y subir directo a Supabase Storage ---------- */
async function loadImg(file){
  if(window.createImageBitmap){ try{ return await withTimeout(createImageBitmap(file,{imageOrientation:"from-image"}),30000); }catch{} }
  const u=URL.createObjectURL(file);
  try{ return await withTimeout(new Promise((res,rej)=>{const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=u;}),30000); }
  finally{ setTimeout(()=>URL.revokeObjectURL(u),60000); }
}
/* Busca la pieza en la foto por sus bordes y devuelve el recuadro que la contiene. */
function findPiece(img,w,h){
  const s=Math.min(1,200/Math.max(w,h)), aw=Math.max(1,Math.round(w*s)), ah=Math.max(1,Math.round(h*s));
  const full={bx:0,by:0,bw:w,bh:h,bg:"#000"};
  try{
    const c=document.createElement("canvas"); c.width=aw; c.height=ah;
    const x=c.getContext("2d",{willReadFrequently:true}); x.drawImage(img,0,0,aw,ah);
    const d=x.getImageData(0,0,aw,ah).data, N=aw*ah;
    let r=0,g=0,b=0,n=0; const add=i=>{r+=d[i];g+=d[i+1];b+=d[i+2];n++;};
    for(let X=0;X<aw;X++){ add(X*4); add(((ah-1)*aw+X)*4); }
    for(let Y=0;Y<ah;Y++){ add(Y*aw*4); add((Y*aw+aw-1)*4); }
    full.bg=`rgb(${(r/n)|0},${(g/n)|0},${(b/n)|0})`;
    const L=new Float32Array(N); for(let i=0;i<N;i++) L[i]=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];
    const B=new Float32Array(N);
    for(let Y=0;Y<ah;Y++) for(let X=0;X<aw;X++){ let t=0,k=0; for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const yy=Y+dy,xx=X+dx; if(yy>=0&&yy<ah&&xx>=0&&xx<aw){ t+=L[yy*aw+xx]; k++; } } B[Y*aw+X]=t/k; }
    const M=new Float32Array(N), mags=[];
    for(let Y=1;Y<ah-1;Y++) for(let X=1;X<aw-1;X++){ const i=Y*aw+X; const v=Math.abs(B[i+1]-B[i-1])+Math.abs(B[i+aw]-B[i-aw]); M[i]=v; mags.push(v); }
    mags.sort((a,b)=>a-b); const th=Math.max(18, mags[Math.floor(mags.length*0.95)]||0);
    const cols=new Array(aw).fill(0), rows=new Array(ah).fill(0); let tot=0;
    for(let Y=0;Y<ah;Y++) for(let X=0;X<aw;X++){ if(M[Y*aw+X]>=th){ cols[X]++; rows[Y]++; tot++; } }
    if(tot<20) return full;
    const bounds=a=>{ const cut=tot*0.04; let acc=0,lo=0,hi=a.length-1; for(let i=0;i<a.length;i++){ acc+=a[i]; if(acc>cut){lo=i;break;} } acc=0; for(let i=a.length-1;i>=0;i--){ acc+=a[i]; if(acc>cut){hi=i;break;} } return [lo,hi]; };
    const [x0,x1]=bounds(cols), [y0,y1]=bounds(rows);
    return {bx:x0/s, by:y0/s, bw:Math.max((x1-x0+1)/s,w*0.08), bh:Math.max((y1-y0+1)/s,h*0.08), bg:full.bg};
  }catch{ return full; }
}
async function toJpeg(file){
  const img=await loadImg(file);
  const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  if(!w||!h) throw {code:"heic"};
  const f=findPiece(img,w,h);
  const S2=Math.max(f.bw,f.bh)*1.5, cx=f.bx+f.bw/2, cy=f.by+f.bh/2;
  const sx = S2<=w ? Math.max(0,Math.min(w-S2,cx-S2/2)) : cx-S2/2;
  const sy = S2<=h ? Math.max(0,Math.min(h-S2,cy-S2/2)) : cy-S2/2;
  const out=Math.max(1,Math.min(1000,Math.round(S2))), k=out/S2;
  const c=document.createElement("canvas"); c.width=out; c.height=out;
  const ctx=c.getContext("2d"); ctx.fillStyle=f.bg; ctx.fillRect(0,0,out,out);
  const ix=Math.max(0,sx), iy=Math.max(0,sy), ix2=Math.min(w,sx+S2), iy2=Math.min(h,sy+S2);
  ctx.drawImage(img, ix,iy,ix2-ix,iy2-iy, (ix-sx)*k,(iy-sy)*k,(ix2-ix)*k,(iy2-iy)*k);
  if(img.close) try{ img.close(); }catch{}
  const b=await new Promise(res=>c.toBlob(res,"image/jpeg",.86));
  if(!b || !b.size) throw {code:"heic"};
  return b;
}
async function prepareFoto(file){
  if(!file || !file.size) throw {code:"heic"};
  try{ return {blob:await toJpeg(file), type:"image/jpeg", ext:"jpg"}; }
  catch(e){
    const ok={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
    if(!ok[file.type]) throw {code:"heic"};
    if(file.size>10*1024*1024) throw {code:"too_large"};
    return {blob:file, type:file.type, ext:ok[file.type]};
  }
}
async function uploadBlob(path, blob, type){
  let last;
  for(let i=0;i<3;i++){
    try{ check(await withTimeout(sb.storage.from(BUCKET).upload(path, blob, {contentType:type, upsert:true, cacheControl:"31536000"}),90000)); return; }
    catch(e){ last=e; if(i<2){ toast("Reintentando subir la foto…"); await sleep(1500*(i+1)); } }
  }
  throw last;
}
async function setFoto(pid, file, oldPath){
  const cp = await prepareFoto(file);
  const path = `${pid}/${Date.now()}.${cp.ext}`;
  await uploadBlob(path, cp.blob, cp.type);
  check(await sb.from("inv_productos").update({foto:path, actualizado:new Date().toISOString()}).eq("id",pid));
  if(oldPath && oldPath!==path) sb.storage.from(BUCKET).remove([oldPath]).catch(()=>{});
}

/* ---------- movimientos ---------- */
function moveForm(tipo, pid){
  const titles={venta:"Registrar venta",entrada:"Registrar entrada",ajuste:"Ajustar conteo"};
  const sorted=[...S.products].sort((a,b)=>nombre(a).localeCompare(nombre(b),"es",{numeric:true}));
  if(!sorted.length){ toast("Primero agrega piezas al inventario"); return; }
  const p0 = pid?byId(pid):null;
  openSheet(`<form class="f sh" id="mf" novalidate>
    <h2>${titles[tipo]}</h2>
    ${p0?`<p class="sub">${esc(nombre(p0))} · <span class="num">${esc(p0.codigo)}</span> · hay ${num(p0.stock)} und</p>`:
      `<div class="fld"><label for="mf-p">Pieza</label><select id="mf-p">${sorted.map(p=>`<option value="${esc(p.id)}">${esc(nombre(p))} · ${esc(p.codigo)} (${num(p.stock)})</option>`).join("")}</select></div>`}
    ${tipo==="ajuste"?`<div class="fld"><label for="mf-cant">Unidades contadas en físico</label><input id="mf-cant" inputmode="numeric" value="${p0?num(p0.stock):""}"><span class="hint">La existencia se corrige a este número y la diferencia queda registrada.</span></div>`:
    `<div class="grid2"><div class="fld"><label for="mf-cant">Cantidad</label><input id="mf-cant" inputmode="numeric" value="1"></div>
      <div class="fld"><label for="mf-unit">${tipo==="venta"?"Precio unitario (USD)":"Costo de compra por und (USD)"}</label><input id="mf-unit" inputmode="decimal"></div></div>`}
    ${tipo==="entrada"?`<div class="fld"><label for="mf-pv">Precio de venta (USD)</label><input id="mf-pv" inputmode="decimal"><span class="hint">Cámbialo si vas a vender esta pieza a otro precio.</span></div><label class="check"><input type="checkbox" id="mf-upcost" checked> Actualizar el costo de la pieza</label>`:""}
    <div class="fld"><label for="mf-nota">Nota</label><input id="mf-nota" placeholder="${tipo==="venta"?"Cliente, forma de pago…":tipo==="entrada"?"Proveedor, factura…":"Motivo"}"></div>
    ${tipo!=="ajuste"?`<div class="total"><span>Total</span><div><b id="mf-tot">$0,00</b></div></div>`:""}
    <p class="err" id="mf-err" hidden></p>
    <div class="row"><button class="btn ghost" type="button" data-act="${pid?"volver":"cerrar"}">Cancelar</button><button class="btn" type="submit" id="mf-save">${tipo==="venta"?"Registrar venta":tipo==="entrada"?"Sumar al inventario":"Guardar conteo"}</button></div>
  </form>`, {kind:"move", pid:pid||null});
  const cur = () => byId(p0?p0.id:$("#mf-p").value);
  const tot = () => { if(tipo==="ajuste") return; const c=Number($("#mf-cant").value)||0, u=parseNum($("#mf-unit").value)||0; $("#mf-tot").textContent=usd(c*u); };
  const setUnit = () => { const u=$("#mf-unit"); if(!u) return; const p=cur(); u.value = String(tipo==="venta"?num(p.precio):num(p.costo)).replace(".",","); const pv=$("#mf-pv"); if(pv) pv.value=String(num(p.precio)).replace(".",","); tot(); };
  setUnit();
  $("#mf-p")?.addEventListener("change", setUnit);
  ["mf-cant","mf-unit"].forEach(id=>$("#"+id)?.addEventListener("input",tot));
  $("#mf").addEventListener("submit", async e=>{
    e.preventDefault();
    const err=$("#mf-err"); err.hidden=true; const fail=m=>{err.textContent=m;err.hidden=false;};
    const p=cur(); const cant=Number($("#mf-cant").value); const unit = tipo==="ajuste"?0:parseNum($("#mf-unit").value);
    if(!Number.isInteger(cant) || cant<0 || (tipo!=="ajuste" && cant===0)) return fail("La cantidad debe ser un número entero mayor que cero.");
    if(tipo!=="ajuste" && (isNaN(unit)||unit<0)) return fail("Revisa el monto: usa números como 3,50.");
    const pvv = $("#mf-pv") ? parseNum($("#mf-pv").value) : null;
    if($("#mf-pv") && !(pvv>=0)) return fail("Revisa el precio de venta: usa números como 10,50.");
    const btn=$("#mf-save"); btn.disabled=true; btn.textContent="Guardando…";
    try{
      const next = check(await sb.rpc("inv_registrar_movimiento",{p_producto:p.id,p_tipo:tipo,p_cantidad:cant,p_monto:tipo==="ajuste"?0:unit,p_nota:$("#mf-nota").value.trim(),
        p_nuevo_precio: tipo==="entrada" ? pvv : null, p_actualizar_costo: tipo==="entrada" && !!$("#mf-upcost")?.checked}));
      await refresh();
      toast(tipo==="venta"?`Venta registrada · quedan ${next}`:tipo==="entrada"?`Entrada registrada · hay ${next}`:`Conteo guardado · hay ${next}`);
      closeOrBack(pid);
    }catch(ex){ fail(errMsg(ex)); btn.disabled=false; btn.textContent="Intentar de nuevo"; }
  });
}
function closeOrBack(pid){ if(pid && byId(pid)){ S.sheet={kind:"detail",pid}; $("#sheetBody")._h=null; renderDetail(pid); $("#sheet").scrollTop=0; } else closeSheet(); }

function movDetail(mid){
  const m=S.movs.find(x=>x.id===mid); if(!m) return;
  const d=new Date(m.fecha);
  const label={venta:"Venta",entrada:"Entrada",ajuste:"Ajuste de conteo"}[m.tipo];
  const unit = m.tipo==="entrada"?num(m.costo):num(m.precio);
  openSheet(`<div class="sh">
    <h2>${label}</h2><p class="sub">${esc(d.toLocaleString("es-VE",{dateStyle:"long",timeStyle:"short"}))}${who(m)?" · "+esc(who(m)):""}</p>
    <div class="tags"><span class="tag code">${esc(movCod(m))}</span><span class="tag">${esc(movNom(m))}</span></div>
    <div class="kv">
      <div><span>Cantidad</span><b>${m.tipo==="ajuste"&&m.cantidad>0?"+":""}${m.cantidad} und</b></div>
      <div><span>${m.tipo==="entrada"?"Costo und":"Precio und"}</span><b>${usd(unit)}</b></div>
      <div><span>Total</span><b>${m.tipo==="ajuste"?"—":usd(m.cantidad*unit)}</b></div>
    </div>
    ${m.nota?`<p style="margin:0">${esc(m.nota)}</p>`:""}
    <div id="annul"><button class="btn danger" type="button" data-act="anular-ask" style="width:100%">Anular movimiento</button></div>
  </div>`, {kind:"mov", mid});
}

/* ---------- menú: exportar, importar, salir ---------- */
function menuSheet(){
  openSheet(`<div class="sh">
    <h2>Menú</h2>
    <p class="who">Sesión: ${esc(me?.email||"")}</p>
    <div class="menu-list">
      <button class="btn ghost" type="button" data-act="exportar">Descargar inventario para Excel</button>
      <button class="btn ghost" type="button" data-act="importar">Traer datos de la app anterior</button>
      <button class="btn ghost" type="button" data-act="recargar">Actualizar datos</button>
      <button class="btn danger" type="button" data-act="salir">Cerrar sesión</button>
    </div>
  </div>`, {kind:"menu"});
}
function csvCell(v){ const s=String(v??""); return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function dec(v){ return String(Number(v||0).toFixed(2)).replace(".",","); }
function download(name, text){
  const blob=new Blob(["﻿"+text],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },2000);
}
function exportCsv(){
  const day=new Date().toISOString().slice(0,10);
  const P=[["Código","Tipo","Forma","Medida","Material","Acabado","Costo USD","Precio USD","Existencia","Mínimo","Valor a costo USD","Notas"]];
  [...S.products].sort((a,b)=>a.codigo.localeCompare(b.codigo)).forEach(p=>P.push([p.codigo,p.tipo,p.forma,p.medida,p.material,p.acabado,dec(p.costo),dec(p.precio),num(p.stock),num(p.minimo),dec(num(p.stock)*num(p.costo)),p.notas]));
  download(`myriedesign-inventario-${day}.csv`, P.map(r=>r.map(csvCell).join(";")).join("\n"));
  const M=[["Fecha","Tipo","Código","Pieza","Cantidad","Precio USD","Costo USD","Total USD","Nota","Usuario"]];
  S.movs.forEach(m=>{ const u=m.tipo==="entrada"?num(m.costo):num(m.precio); M.push([new Date(m.fecha).toLocaleString("es-VE"),m.tipo,movCod(m),movNom(m),m.cantidad,dec(m.precio),dec(m.costo),m.tipo==="ajuste"?"":dec(m.cantidad*u),m.nota,who(m)]); });
  setTimeout(()=>download(`myriedesign-movimientos-${day}.csv`, M.map(r=>r.map(csvCell).join(";")).join("\n")),800);
  toast("Descargando 2 archivos para Excel");
}

function importSheet(){
  openSheet(`<div class="sh">
    <h2>Traer datos de la app anterior</h2>
    <p class="sub">Elige el archivo de respaldo que te preparó Claude (termina en .json). Se agregan las piezas, los movimientos y las fotos. Si una pieza ya está, no se duplica.</p>
    <span class="btn pick" style="width:100%;min-height:48px"><span class="pick-lbl">Elegir archivo de respaldo</span><input id="imp-file" type="file" accept=".json,application/json"></span>
    <div id="imp-status"></div>
  </div>`, {kind:"import"});
  $("#imp-file").addEventListener("change", e=>{ const f=e.target.files[0]; if(f) runImport(f); });
}
function b64ToBlob(b64, type){ const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return new Blob([u],{type}); }
async function runImport(file){
  const st=$("#imp-status");
  const show=(msg,pct)=>{ st.innerHTML=`<p style="margin:0 0 8px">${esc(msg)}</p>${pct!=null?`<div class="progress"><div style="width:${pct}%"></div></div>`:""}`; };
  let data;
  try{ data=JSON.parse(await file.text()); }catch{ show("Ese archivo no es un respaldo válido."); return; }
  if(!data || data.formato!=="myriedesign-respaldo" || !Array.isArray(data.productos)){ show("Ese archivo no es un respaldo de Myriedesign."); return; }
  const prods=data.productos, movs=data.movimientos||[];
  try{
    show(`Guardando ${prods.length} piezas…`, 5);
    for(let i=0;i<prods.length;i+=100){
      const chunk=prods.slice(i,i+100).map(p=>({id:p.id,codigo:p.codigo,tipo:p.tipo||"Otro",material:p.material||"Acero",forma:p.forma||"",medida:p.medida||"",acabado:p.acabado||"",notas:p.notas||"",
        costo:num(p.costo),precio:num(p.precio),stock:Math.max(0,Math.round(num(p.stock))),minimo:Math.max(0,Math.round(num(p.minimo))),creado:p.creado||new Date().toISOString(),actualizado:p.actualizado||new Date().toISOString()}));
      check(await sb.from("inv_productos").upsert(chunk,{onConflict:"id",ignoreDuplicates:true}));
    }
    await loadProducts();
    const conFoto=prods.filter(p=>p.foto_b64 && byId(p.id) && !byId(p.id).foto);
    let hechas=0, fallidas=0;
    for(const p of conFoto){
      show(`Subiendo fotos… ${hechas+fallidas+1} de ${conFoto.length}`, 10+Math.round((hechas+fallidas)/Math.max(1,conFoto.length)*70));
      try{
        const path=`${p.id}/importada.jpg`;
        await uploadBlob(path, b64ToBlob(p.foto_b64, p.foto_tipo||"image/jpeg"), p.foto_tipo||"image/jpeg");
        check(await sb.from("inv_productos").update({foto:path}).eq("id",p.id));
        hechas++;
      }catch{ fallidas++; }
    }
    show(`Guardando ${movs.length} movimientos…`, 85);
    for(let i=0;i<movs.length;i+=200){
      const chunk=movs.slice(i,i+200).map(m=>({id:m.id,producto_id:byId(m.producto_id)?m.producto_id:null,tipo:m.tipo,cantidad:Math.round(num(m.cantidad)),precio:num(m.precio),costo:num(m.costo),
        nota:m.nota||"",nombre:m.nombre||"",codigo:m.codigo||"",fecha:m.fecha,usuario:null,usuario_email:m.usuario||"app anterior"}));
      check(await sb.from("inv_movimientos").upsert(chunk,{onConflict:"id",ignoreDuplicates:true}));
    }
    await refresh();
    show(`Listo: ${prods.length} piezas, ${movs.length} movimientos y ${hechas} fotos.${fallidas?` ${fallidas} fotos no se pudieron subir; vuelve a elegir el mismo archivo para reintentarlas.`:""}`, 100);
  }catch(e){ show("Se detuvo: "+errMsg(e)+" Puedes volver a elegir el archivo; lo que ya se guardó no se duplica."); }
}

/* ---------- eventos ---------- */
document.addEventListener("click", async e=>{
  if(e.target.matches && e.target.matches('input[type="file"]')){ S.picking=true; return; }
  const t=e.target.closest("button,[data-pid]"); if(!t) return;
  if(t.dataset.fill){ const inp=$("#"+t.dataset.fill); if(inp){ inp.value=t.dataset.val; inp.dispatchEvent(new Event("input",{bubbles:true})); t.parentNode.querySelectorAll(".chip").forEach(c=>c.setAttribute("aria-pressed", c===t)); } return; }
  if(t.dataset.tab){ S.view=t.dataset.tab; render(); window.scrollTo(0,0); return; }
  if(t.dataset.tipo){ S.tipo=t.dataset.tipo; renderInv(); return; }
  if(t.dataset.mat){ S.mat=t.dataset.mat; renderInv(); return; }
  if(t.dataset.movf){ S.movF=t.dataset.movf; renderMov(); return; }
  if(t.dataset.new){ moveForm(t.dataset.new); return; }
  if(t.dataset.mid){ movDetail(t.dataset.mid); return; }
  if(t.dataset.pid){ openSheet("",{kind:"detail",pid:t.dataset.pid}); renderDetail(t.dataset.pid); return; }
  if(t.id==="fab"){ pieceForm(); return; }
  if(t.id==="menuBtn"){ menuSheet(); return; }
  const a=t.dataset.act; if(!a) return;
  const pid=S.sheet?.pid;
  if(a==="cerrar") closeSheet();
  else if(a==="nueva") pieceForm();
  else if(a==="volver") closeOrBack(pid);
  else if(["venta","entrada","ajuste"].includes(a)) moveForm(a,pid);
  else if(a==="editar") pieceForm(byId(pid));
  else if(a==="exportar") exportCsv();
  else if(a==="importar") importSheet();
  else if(a==="recargar"){ closeSheet(); S.loading=true; render(); await refresh(); toast("Datos actualizados"); }
  else if(a==="salir"){ closeSheet(); await sb.auth.signOut(); }
  else if(a==="eliminar"){ t.outerHTML=`<div class="panel" style="background:var(--bad-soft);border-color:transparent"><p style="margin:0">¿Eliminar <b>${esc(nombre(byId(pid)))}</b> del inventario? Su historial de movimientos se conserva.</p><div class="row"><button class="btn ghost" type="button" data-act="volver">No, conservar</button><button class="btn danger" type="button" data-act="eliminar-ok" style="background:var(--bad);color:var(--surface)">Sí, eliminar</button></div></div>`; }
  else if(a==="eliminar-ok"){
    const p=byId(pid); t.disabled=true;
    try{ check(await sb.from("inv_productos").delete().eq("id",pid)); if(p?.foto) sb.storage.from(BUCKET).remove([p.foto]).catch(()=>{}); closeSheet(); await refresh(); toast("Pieza eliminada"); }
    catch(ex){ toast(errMsg(ex)); t.disabled=false; }
  }
  else if(a==="anular-ask"){ $("#annul").innerHTML=`<div class="panel" style="background:var(--bad-soft);border-color:transparent"><p style="margin:0">Se borrará este movimiento y la existencia volverá a como estaba antes de él.</p><div class="row"><button class="btn ghost" type="button" data-act="cerrar">Cancelar</button><button class="btn" type="button" data-act="anular-ok" style="background:var(--bad);color:var(--surface)">Anular</button></div></div>`; }
  else if(a==="anular-ok"){
    t.disabled=true;
    try{ check(await sb.rpc("inv_anular_movimiento",{p_movimiento:S.sheet.mid})); closeSheet(); await refresh(); toast("Movimiento anulado y existencia corregida"); }
    catch(ex){ toast(errMsg(ex)); t.disabled=false; }
  }
});
$("#q").addEventListener("input", e=>{ S.q=e.target.value; renderInv(); });
document.addEventListener("change", async e=>{
  if(e.target.id!=="dt-foto") return;
  S.picking=false;
  const file=e.target.files[0], pid=S.sheet?.pid; if(!file||!pid) return;
  const lbl=e.target.parentNode.querySelector(".pick-lbl"); if(lbl) lbl.textContent="Subiendo foto…";
  e.target.disabled=true;
  try{ await setFoto(pid, file, byId(pid)?.foto); await refresh("p"); toast("Foto guardada"); }
  catch(ex){ toast(errMsg(ex)); }
  $("#sheetBody")._h=null;
  if(S.sheet && S.sheet.kind==="detail") renderDetail(S.sheet.pid);
});
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && me) { if(S.picking) setTimeout(()=>{ S.picking=false; }, 5000); scheduleRefresh("p"); scheduleRefresh("m"); } });
const netBanner = () => { $("#offline").hidden = navigator.onLine; };
window.addEventListener("online", ()=>{ netBanner(); if(me){ scheduleRefresh("p"); scheduleRefresh("m"); } });
window.addEventListener("offline", netBanner);

/* ---------- sesión ---------- */
let channel=null;
function showLogin(){ $("#app").hidden=true; $("#login").hidden=false; closeSheet(); }
async function showApp(){
  $("#login").hidden=true; $("#app").hidden=false;
  S.loading=true; render();
  await refresh();
  if(!channel){
    channel = sb.channel("inventario")
      .on("postgres_changes",{event:"*",schema:"public",table:"inv_productos"},()=>scheduleRefresh("p"))
      .on("postgres_changes",{event:"*",schema:"public",table:"inv_movimientos"},()=>scheduleRefresh("m"))
      .subscribe();
  }
}
$("#lf").addEventListener("submit", async e=>{
  e.preventDefault();
  const err=$("#lf-err"), btn=$("#lf-btn"); err.hidden=true;
  if(!sb){ err.textContent="La app aún no está conectada a Supabase."; err.hidden=false; return; }
  btn.disabled=true; btn.textContent="Entrando…";
  const {error}=await sb.auth.signInWithPassword({email:$("#lf-email").value.trim(), password:$("#lf-pass").value});
  btn.disabled=false; btn.textContent="Entrar";
  if(error){ err.textContent = /invalid/i.test(error.message) ? "Correo o clave incorrectos." : errMsg(error); err.hidden=false; }
});

function boot(){
  netBanner();
  const cfg = window.MYRIE_CONFIG || {};
  const ok = cfg.supabaseUrl && /^https:\/\//.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/PEGA_AQUI/.test(cfg.supabaseUrl+cfg.supabaseAnonKey);
  if(!ok || !window.supabase){ $("#cfgWarn").hidden=false; showLogin(); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true } });
  /* Supabase pide no llamar a la base dentro de este aviso; por eso el trabajo va en setTimeout. */
  sb.auth.onAuthStateChange((event, session)=>{
    const was=me; me = session ? session.user : null;
    setTimeout(()=>{
      if(me && !was) showApp();
      else if(!me){ if(channel){ sb.removeChannel(channel); channel=null; } S.products=[]; S.movs=[]; showLogin(); }
    },0);
  });
}
boot();

/* ---------- instalable: service worker ---------- */
if("serviceWorker" in navigator && location.protocol==="https:"){
  window.addEventListener("load", ()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
}
})();
