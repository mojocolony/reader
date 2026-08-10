const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DB_NAME='reader-db-v1', DB_VERSION=1, STORE='articles';
const META_KEY='reader-meta-v1', SETTINGS_KEY='reader-settings-v1';
let db, articles=[], meta={folders:[]}, currentView='inbox', currentFolder=null, currentId=null, currentPage=0, pageCount=1, currentPageStep=756, paginateSeq=0, resizeTimer, toastTimer;
let settings={mode:'paged',font:'Georgia,serif',size:19,line:1.65,width:700,theme:'light'};

function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
function esc(s=''){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200)}
function saveMeta(){localStorage.setItem(META_KEY,JSON.stringify(meta))} function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}
function loadLocal(){try{meta={folders:[],...JSON.parse(localStorage.getItem(META_KEY)||'{}')}}catch{};try{settings={...settings,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')}}catch{}}
function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function dbAll(){return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function dbPut(a){return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(a);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function dbDelete(id){return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function stripHtml(html){const d=document.createElement('div');d.innerHTML=html;return (d.textContent||'').replace(/\s+/g,' ').trim()}
function sanitize(html){if(window.DOMPurify)return DOMPurify.sanitize(html,{USE_PROFILES:{html:true},ADD_ATTR:['target','rel']});const d=document.createElement('template');d.innerHTML=html;d.content.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(n=>n.remove());d.content.querySelectorAll('*').forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||((a.name==='href'||a.name==='src')&&/^javascript:/i.test(a.value)))n.removeAttribute(a.name)}));return d.innerHTML}
function readingMinutes(a){return Math.max(1,Math.round((a.wordCount||stripHtml(a.content).split(/\s+/).length)/225))}
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}}
function currentArticle(){return articles.find(a=>a.id===currentId)}

async function saveArticle(raw){const now=Date.now();let content=sanitize(raw.content||'');const tmp=document.createElement('div');tmp.innerHTML=content;tmp.querySelectorAll('a[href]').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});content=tmp.innerHTML;const text=raw.textContent||stripHtml(content);const a={id:raw.id||uid(),title:(raw.title||'Untitled').trim(),byline:raw.byline||'',siteName:raw.siteName||hostOf(raw.url),url:raw.url||'',excerpt:raw.excerpt||text.slice(0,240),content,textContent:text,wordCount:text.split(/\s+/).filter(Boolean).length,savedAt:raw.savedAt||now,updatedAt:now,archived:false,favorite:false,folderId:null,progress:0,...raw,content,textContent:text};await dbPut(a);const i=articles.findIndex(x=>x.id===a.id);if(i>=0)articles[i]=a;else articles.unshift(a);cacheImages(a);renderAll();openArticle(a.id);toast('Saved to Reader')}
async function cacheImages(a){const tmp=document.createElement('div');tmp.innerHTML=a.content;const urls=[...tmp.querySelectorAll('img[src]')].map(i=>i.src).filter(u=>/^https?:/.test(u));if(!urls.length||!('caches'in window))return;try{const c=await caches.open('reader-images-v1');for(const u of urls.slice(0,60)){try{const req=new Request(u,{mode:'no-cors'});const old=await c.match(req);if(!old){const resp=await fetch(req);await c.put(req,resp)}}catch{}}}catch{}}

function filteredArticles(){const q=$('#searchInput').value.trim().toLowerCase();let arr=articles.filter(a=>{if(currentFolder)return a.folderId===currentFolder&&!a.archived;if(currentView==='favorites')return a.favorite&&!a.archived;if(currentView==='archive')return a.archived;return !a.archived});if(q)arr=arr.filter(a=>[a.title,a.excerpt,a.siteName,a.byline,a.textContent].some(v=>(v||'').toLowerCase().includes(q)));const sort=$('#sortSelect').value;arr.sort((a,b)=>sort==='oldest'?a.savedAt-b.savedAt:sort==='title'?a.title.localeCompare(b.title):sort==='source'?(a.siteName||'').localeCompare(b.siteName||''):b.savedAt-a.savedAt);return arr}
function renderAll(){renderSidebar();renderList()}
function renderSidebar(){const inbox=articles.filter(a=>!a.archived).length,fav=articles.filter(a=>a.favorite&&!a.archived).length,arc=articles.filter(a=>a.archived).length;$('#inboxCount').textContent=inbox||'';$('#favoriteCount').textContent=fav||'';$('#archiveCount').textContent=arc||'';$$('.nav-item').forEach(b=>b.classList.toggle('active',!currentFolder&&b.dataset.view===currentView));$('#folderList').innerHTML=meta.folders.map(f=>`<button class="folder-item ${currentFolder===f.id?'active':''}" data-folder="${f.id}"><span>${esc(f.name)}</span><span class="count">${articles.filter(a=>a.folderId===f.id&&!a.archived).length||''}</span></button>`).join('');$$('.folder-item').forEach(b=>b.onclick=()=>{currentFolder=b.dataset.folder;currentView='inbox';renderAll()})}
function renderList(){const arr=filteredArticles();const title=currentFolder?(meta.folders.find(f=>f.id===currentFolder)?.name||'Folder'):{inbox:'Inbox',favorites:'Favorites',archive:'Archive'}[currentView];$('#viewTitle').textContent=title;$('#viewSubtitle').textContent=`${arr.length} article${arr.length===1?'':'s'}`;$('#articleList').innerHTML=arr.length?arr.map(a=>`<div class="article-row ${a.id===currentId?'active':''}" data-id="${a.id}"><div class="article-row-title">${a.favorite?'<span class="fav">★</span> ':''}${esc(a.title)}</div><div class="article-row-excerpt">${esc(a.excerpt||'')}</div><div class="article-row-meta"><span>${esc(a.siteName||hostOf(a.url)||'Saved article')}</span><span>·</span><span>${readingMinutes(a)} min</span><span>·</span><span>${formatAge(a.savedAt)}</span></div></div>`).join(''):`<div class="empty-reader" style="height:auto;padding-top:60px"><p>No articles here yet.</p></div>`;$$('.article-row').forEach(r=>r.onclick=()=>openArticle(r.dataset.id))}
function formatAge(t){const d=(Date.now()-t)/86400000;if(d<1)return 'Today';if(d<2)return 'Yesterday';if(d<7)return `${Math.floor(d)}d ago`;return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}

function normalizeReaderHtml(html=''){
  const t=document.createElement('template');
  t.innerHTML=sanitize(html);
  t.content.querySelectorAll('*').forEach(el=>{
    const style=(el.getAttribute('style')||'').toLowerCase();
    if(el.hasAttribute('hidden')||el.getAttribute('aria-hidden')==='true'||/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/.test(style)){
      el.remove();return;
    }
    ['style','class','id','width','height','align','bgcolor','color','face','size'].forEach(a=>el.removeAttribute(a));
    if(el.tagName==='IMG'){
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
    }
  });
  return t.innerHTML;
}
function articleShell(a){return `<h1 class="reader-title">${esc(a.title)}</h1><div class="reader-deck">${[a.byline,a.siteName].filter(Boolean).map(esc).join(' · ')}${a.excerpt?`<br>${esc(a.excerpt)}`:''}</div>${normalizeReaderHtml(a.content)}`}
async function openArticle(id){const a=articles.find(x=>x.id===id);if(!a)return;currentId=id;currentPage=0;$('#emptyReader').hidden=true;$('#readerView').hidden=false;$('#readerPane').classList.add('mobile-open');$('#sourceLabel').textContent=a.siteName||hostOf(a.url)||'Saved article';$('#readingTimeLabel').textContent=`${readingMinutes(a)} min read`;$('#favoriteBtn').textContent=a.favorite?'★':'☆';$('#archiveBtn').title=a.archived?'Move to Inbox':'Archive';$('#originalBtn').disabled=!a.url;$('#scrollArticle').innerHTML=articleShell(a);$('#pagedArticle').innerHTML=articleShell(a);renderList();applySettings();setMode(a.mode||settings.mode,false);requestAnimationFrame(()=>{paginate();restoreProgress(a)})}
function closeMobileArticle(){if(innerWidth<=680)$('#readerPane').classList.remove('mobile-open')}
function setMode(mode,save=true){const a=currentArticle();mode=mode==='scroll'?'scroll':'paged';$('#scrollReader').hidden=mode!=='scroll';$('#pagedReader').hidden=mode!=='paged';$('#modeBtn').textContent=mode==='paged'?'Paged':'Scroll';if(a&&save){a.mode=mode;dbPut(a)}if(mode==='paged')requestAnimationFrame(paginate)}
function pageStep(){return currentPageStep}
async function paginate(){
  if($('#pagedReader').hidden||!currentArticle())return;
  const seq=++paginateSeq,flow=$('#pagedArticle'),vp=$('#pageViewport'),a=currentArticle();
  const savedProgress=Number.isFinite(a?.progress)?a.progress:(pageCount<=1?0:currentPage/(pageCount-1));

  // iOS Safari can retain stale glyph layers when a transformed multicolumn element
  // changes font metrics. Rebuild the paged DOM and move the viewport with scrollLeft
  // instead of transforming the text layer itself.
  flow.classList.add('repaginating');
  flow.style.visibility='hidden';
  flow.style.transform='none';
  vp.scrollLeft=0;
  flow.innerHTML=articleShell(a);
  flow.style.columnWidth='auto';
  flow.style.width='1px';
  void flow.offsetHeight;

  const host=vp.parentElement;
  const available=(host?.clientWidth||window.innerWidth||vp.clientWidth)-36;
  const width=Math.min(settings.width,Math.max(220,available));
  document.documentElement.style.setProperty('--reader-width',width+'px');
  vp.style.width=width+'px';
  flow.style.width=width+'px';
  flow.style.paddingLeft='0px';
  flow.style.paddingRight='0px';
  flow.style.columnWidth=width+'px';
  flow.style.columnFill='auto';
  flow.style.columnGap=getComputedStyle(flow).getPropertyValue('--page-gap').trim()||'56px';

  try{if(document.fonts?.ready)await document.fonts.ready}catch{}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  if(seq!==paginateSeq)return;

  const cs=getComputedStyle(flow);
  const gap=parseFloat(cs.columnGap)||56;
  const padX=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
  const actualColumnWidth=Math.max(1,flow.clientWidth-padX);
  currentPageStep=actualColumnWidth+gap;
  pageCount=Math.max(1,Math.ceil((flow.scrollWidth+1)/currentPageStep));
  currentPage=Math.max(0,Math.min(pageCount-1,Math.round(savedProgress*Math.max(0,pageCount-1))));
  vp.scrollLeft=currentPage*currentPageStep;
  flow.style.visibility='';
  flow.classList.remove('repaginating');
  updatePageUI();
}
function updatePageUI(){const a=currentArticle();$('#pageLabel').textContent=`${currentPage+1} / ${pageCount}`;$('#prevPageBtn').disabled=currentPage<=0;$('#nextPageBtn').disabled=currentPage>=pageCount-1;const prog=pageCount<=1?1:(currentPage/(pageCount-1));$('#progressBar').style.width=`${prog*100}%`;if(a){a.progress=prog;a.lastPage=currentPage;dbPut(a)}}
function goPage(delta){currentPage=Math.max(0,Math.min(pageCount-1,currentPage+delta));const vp=$('#pageViewport');vp.scrollLeft=currentPage*currentPageStep;updatePageUI()}
function restoreProgress(a){if((a.mode||settings.mode)==='paged'){currentPage=Math.round((a.progress||0)*Math.max(0,pageCount-1));goPage(0)}else $('#scrollReader').scrollTop=(a.progress||0)*Math.max(0,$('#scrollReader').scrollHeight-$('#scrollReader').clientHeight)}
function saveScrollProgress(){const a=currentArticle();if(!a||$('#scrollReader').hidden)return;const el=$('#scrollReader'),den=Math.max(1,el.scrollHeight-el.clientHeight);a.progress=Math.min(1,Math.max(0,el.scrollTop/den));clearTimeout(a._pTimer);a._pTimer=setTimeout(()=>dbPut(a),500)}

function applySettings(){document.documentElement.style.setProperty('--reader-font',settings.font);document.documentElement.style.setProperty('--reader-size',settings.size+'px');document.documentElement.style.setProperty('--reader-line',settings.line);document.documentElement.style.setProperty('--reader-width',settings.width+'px');document.body.classList.remove('theme-light','theme-sepia','theme-dark','theme-eink');document.body.classList.add('theme-'+settings.theme);$('#fontSelect').value=settings.font;$('#fontSizeSelect').value=String(settings.size);$('#lineHeightSelect').value=String(settings.line);$('#widthSelect').value=String(settings.width);$$('.theme-row button').forEach(b=>b.classList.toggle('active',b.dataset.theme===settings.theme));$('#defaultModeSelect').value=settings.mode;requestAnimationFrame(paginate)}
function positionPopover(pop,anchor){const r=anchor.getBoundingClientRect();pop.hidden=false;const w=pop.offsetWidth,h=pop.offsetHeight;pop.style.left=Math.min(innerWidth-w-10,Math.max(10,r.right-w))+'px';pop.style.top=Math.min(innerHeight-h-10,r.bottom+7)+'px'}

function createBookmarklet(){const base=location.href.split('#')[0].split('?')[0];const origin=location.origin;const js=`javascript:(()=>{const R=${JSON.stringify(base)},O=${JSON.stringify(origin)},T=Math.random().toString(36).slice(2)+Date.now().toString(36);let W;const abs=(root)=>{root.querySelectorAll('[src]').forEach(e=>{try{e.src=new URL(e.getAttribute('src'),location.href).href}catch{}});root.querySelectorAll('a[href]').forEach(e=>{try{e.href=new URL(e.getAttribute('href'),location.href).href}catch{}})};const send=(a)=>{W=window.open(R+'#capture='+T,'_blank');const m={type:'reader-capture',token:T,article:{title:a.title||document.title,byline:a.byline||'',siteName:a.siteName||location.hostname,url:location.href,excerpt:a.excerpt||'',content:a.content||'',textContent:a.textContent||''}};let n=0;const i=setInterval(()=>{try{W.postMessage(m,O)}catch{}if(++n>16)clearInterval(i)},350)};const fallback=()=>{const n=(document.querySelector('article')||document.querySelector('main')||document.body).cloneNode(true);n.querySelectorAll('script,style,nav,form,button,aside').forEach(x=>x.remove());abs(n);send({title:document.title,content:n.innerHTML,textContent:n.textContent,siteName:location.hostname})};const run=()=>{try{const d=document.cloneNode(true);abs(d);const a=new Readability(d).parse();a?send(a):fallback()}catch(e){fallback()}};if(window.Readability)return run();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/Readability.js';s.onload=run;s.onerror=fallback;document.documentElement.appendChild(s);setTimeout(()=>{if(!window.Readability&&!W)fallback()},2500)})();`;return js.replace(/\n/g,'')}
function handleCapture(){const m=location.hash.match(/^#capture=(.+)$/);if(!m)return;const token=m[1];window.addEventListener('message',async e=>{if(!e.data||e.data.type!=='reader-capture'||e.data.token!==token)return;history.replaceState(null,'',location.pathname+location.search);await saveArticle(e.data.article)}, {once:true})}

async function init(){loadLocal();await openDb();articles=await dbAll();if(!articles.length)await createWelcome();for(let s=13;s<=28;s++)$('#fontSizeSelect').insertAdjacentHTML('beforeend',`<option value="${s}">${s} px</option>`);applySettings();renderAll();handleCapture();wire()}
async function createWelcome(){const content=`<p>Reader is a small read-it-later app with two reading styles.</p><h2>Try Paged mode</h2><p>Instead of scrolling forever, Paged mode lays the article out in screen-sized columns. Use the Previous and Next controls below, or the left and right arrow keys. Change the typeface, size, spacing, or reading width and Reader recalculates the pages for you.</p><p>This approach is especially pleasant for long essays, tablets, and e-ink-like reading. If you prefer the web’s usual behaviour, switch to Scroll at any time.</p><h2>Save something from the web</h2><p>Open Settings and drag <strong>Save to Reader</strong> to your bookmarks bar. Then visit an article and click the bookmarklet. Reader will attempt to extract the clean article using Mozilla Readability and add it to your Inbox.</p><p>Your saved article text lives locally in your browser in this first version. Reader also tries to cache article images for offline viewing when the source site permits it.</p><h2>A portable direction</h2><p>If you like the core reading experience, the next logical step is Dropbox sync so the same library and reading position can move among your devices. We can also add highlights, notes, tags, and a Send to Notes action without changing the basic reading interface.</p>`;await saveArticle({title:'Welcome to Reader',siteName:'Reader',excerpt:'A quick tour of paged and scrolling reading.',content,textContent:stripHtml(content),savedAt:Date.now()-1000})}

function wire(){
  $$('.nav-item').forEach(b=>b.onclick=()=>{currentFolder=null;currentView=b.dataset.view;renderAll()});
  $('#searchInput').oninput=renderList;$('#sortSelect').onchange=renderList;
  $('#settingsBtn').onclick=()=>{const bm=createBookmarklet();$('#bookmarkletLink').href=bm;$('#settingsDialog').showModal()};
  $('#addBtn').onclick=()=>$('#addDialog').showModal();
  $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
  $('#saveManualBtn').onclick=async()=>{const val=$('#manualContent').value.trim();if(!val)return toast('Paste some article text first');const html=/<[a-z][\s\S]*>/i.test(val)?val:val.split(/\n\n+/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');await saveArticle({title:$('#manualTitle').value||'Untitled',url:$('#manualUrl').value,content:html,textContent:stripHtml(html)});$('#addDialog').close();$('#manualContent').value='';$('#manualTitle').value='';$('#manualUrl').value=''};
  $('#copyBookmarkletBtn').onclick=async()=>{await navigator.clipboard.writeText(createBookmarklet());toast('Bookmarklet copied')};
  $('#newFolderBtn').onclick=()=>{const name=prompt('Folder name');if(name?.trim()){meta.folders.push({id:uid(),name:name.trim()});saveMeta();renderSidebar()}};
  $('#favoriteBtn').onclick=async()=>{const a=currentArticle();if(!a)return;a.favorite=!a.favorite;await dbPut(a);$('#favoriteBtn').textContent=a.favorite?'★':'☆';renderAll()};
  $('#archiveBtn').onclick=async()=>{const a=currentArticle();if(!a)return;a.archived=!a.archived;await dbPut(a);renderAll();toast(a.archived?'Archived':'Moved to Inbox')};
  $('#originalBtn').onclick=()=>{const a=currentArticle();if(a?.url)window.open(a.url,'_blank','noopener')};
  $('#modeBtn').onclick=()=>{const mode=$('#pagedReader').hidden?'paged':'scroll';setMode(mode);const a=currentArticle();if(a)a.mode=mode;};
  $('#prevPageBtn').onclick=()=>goPage(-1);$('#nextPageBtn').onclick=()=>goPage(1);
  document.addEventListener('keydown',e=>{if(!$('#pagedReader').hidden&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(e.key==='ArrowRight'||e.key==='PageDown'){goPage(1);e.preventDefault()}if(e.key==='ArrowLeft'||e.key==='PageUp'){goPage(-1);e.preventDefault()}}});
  let sx=null;$('#pageViewport').addEventListener('touchstart',e=>sx=e.touches[0].clientX,{passive:true});$('#pageViewport').addEventListener('touchend',e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>50)goPage(dx<0?1:-1);sx=null},{passive:true});
  $('#scrollReader').onscroll=saveScrollProgress;
  $('#appearanceBtn').onclick=e=>positionPopover($('#appearancePopover'),e.currentTarget);$('#moreBtn').onclick=e=>positionPopover($('#morePopover'),e.currentTarget);
  document.addEventListener('pointerdown',e=>{for(const id of ['appearancePopover','morePopover']){const p=document.getElementById(id);if(!p.hidden&&!p.contains(e.target)&&!['appearanceBtn','moreBtn'].includes(e.target.id))p.hidden=true}});
  const updateAppearance=()=>{settings.font=$('#fontSelect').value;settings.size=+$('#fontSizeSelect').value;settings.line=+$('#lineHeightSelect').value;settings.width=+$('#widthSelect').value;saveSettings();applySettings()};$('#fontSelect').onchange=updateAppearance;$('#fontSizeSelect').onchange=updateAppearance;$('#lineHeightSelect').onchange=updateAppearance;$('#widthSelect').onchange=updateAppearance;
  $$('.theme-row button').forEach(b=>b.onclick=()=>{settings.theme=b.dataset.theme;saveSettings();applySettings()});$('#defaultModeSelect').onchange=()=>{settings.mode=$('#defaultModeSelect').value;saveSettings()};
  $('#moveFolderBtn').onclick=async()=>{const a=currentArticle();if(!a)return;const choices=['Inbox',...meta.folders.map(f=>f.name)];const ans=prompt('Move to folder:\n'+choices.map((x,i)=>`${i}: ${x}`).join('\n'),'0');if(ans===null)return;const n=+ans;a.folderId=n>0&&meta.folders[n-1]?meta.folders[n-1].id:null;await dbPut(a);$('#morePopover').hidden=true;renderAll();toast('Moved')};
  $('#deleteArticleBtn').onclick=async()=>{const a=currentArticle();if(!a||!confirm(`Delete “${a.title}”?`))return;await dbDelete(a.id);articles=articles.filter(x=>x.id!==a.id);currentId=null;$('#readerView').hidden=true;$('#emptyReader').hidden=false;$('#morePopover').hidden=true;renderAll();closeMobileArticle()};
  $('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:Date.now(),meta,settings,articles},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`reader-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
  $('#importInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());if(!Array.isArray(j.articles))throw 0;if(confirm(`Import ${j.articles.length} articles? Existing articles with the same IDs will be replaced.`)){for(const a of j.articles)await dbPut(a);if(j.meta){meta=j.meta;saveMeta()}if(j.settings){settings={...settings,...j.settings};saveSettings()}articles=await dbAll();applySettings();renderAll();toast('Backup imported')}}catch{toast('Could not read backup')}e.target.value=''};
  $('#mobileMenuBtn').onclick=()=>{$('#sidebar').classList.add('open');$('#backdrop').hidden=false};$('#backdrop').onclick=()=>{$('#sidebar').classList.remove('open');$('#backdrop').hidden=true};$('#mobileBackBtn').onclick=closeMobileArticle;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(paginate,120)});
}
init().catch(e=>{console.error(e);toast('Reader could not start')});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
