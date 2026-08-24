const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DB_NAME='reader-db-v1', DB_VERSION=1, STORE='articles';
const META_KEY='reader-meta-v1', SETTINGS_KEY='reader-settings-v1', DELETED_KEY='reader-deleted-v1';
const DROPBOX_KEY='reader.dropbox.v1', DROPBOX_PKCE_KEY='reader.dropbox.pkce.v1', DROPBOX_FILE='/reader.json', DROPBOX_SYNC_DELAY=1400;
const LAYOUT_KEY='reader-layout-widths-v1', LAYOUT_DEFAULTS={sidebar:230,list:310}, LAYOUT_LIMITS={sidebarMin:180,sidebarMax:380,listMin:240,listMax:520,readerMin:420};
let db, articles=[], meta={folders:[],folderSort:'manual'}, currentView='inbox', currentFolder=null, currentId=null, currentPage=0, pageCount=1, paginateSeq=0, resizeTimer, toastTimer, folderEditorId=null, draggedArticleId=null, draggedFolderId=null, lastViewportWidth=window.innerWidth, lastViewportHeight=window.innerHeight;
let settings={mode:'paged',font:'Georgia,serif',size:19,line:1.65,width:620,theme:'light'};
let deletedArticles={}, dbx=loadDropboxState(), dropboxSyncTimer=null, dropboxSyncing=false, dropboxSyncAgain=false, suppressDropboxSync=false;
let layoutWidths=loadLayoutWidths(), imageSettleSeq=0;

function repairSettings(){
  let changed=false;
  const size=Number(settings.size), line=Number(settings.line), width=Number(settings.width);
  if(!Number.isFinite(size)||size<13||size>28){settings.size=19;changed=true}else settings.size=size;
  if(!Number.isFinite(line)||line<1.2||line>2.2){settings.line=1.65;changed=true}else settings.line=line;
  if(width===600){settings.width=520;changed=true}
  else if(width===700){settings.width=620;changed=true}
  else if(!Number.isFinite(width)||width<500||width>1000){settings.width=620;changed=true}
  else settings.width=width;
  if(!['paged','scroll'].includes(settings.mode)){settings.mode='paged';changed=true}
  if(!['light','sepia','dark','eink'].includes(settings.theme)){settings.theme='light';changed=true}
  return changed;
}

function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
function esc(s=''){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200)}
function saveMeta(){if(!suppressDropboxSync)meta.updatedAt=Date.now();localStorage.setItem(META_KEY,JSON.stringify(meta));scheduleDropboxSync()}
function saveSettings(){if(!suppressDropboxSync)settings.updatedAt=Date.now();localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));scheduleDropboxSync()}
function saveDeleted(){localStorage.setItem(DELETED_KEY,JSON.stringify(deletedArticles));scheduleDropboxSync()}
function loadLocal(){const rawMeta=localStorage.getItem(META_KEY),rawSettings=localStorage.getItem(SETTINGS_KEY);try{meta={folders:[],folderSort:'manual',...JSON.parse(rawMeta||'{}')}}catch{};if(!['manual','alpha'].includes(meta.folderSort))meta.folderSort='manual';if(rawMeta&&!meta.updatedAt){meta.updatedAt=Date.now();localStorage.setItem(META_KEY,JSON.stringify(meta))}try{settings={...settings,...JSON.parse(rawSettings||'{}')}}catch{};if(rawSettings&&!settings.updatedAt){settings.updatedAt=Date.now();localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}try{deletedArticles=JSON.parse(localStorage.getItem(DELETED_KEY)||'{}')||{}}catch{deletedArticles={}};if(repairSettings()){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings))}}
function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function dbAll(){return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function dbPut(a){return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(a);r.onsuccess=()=>{scheduleDropboxSync();res()};r.onerror=()=>rej(r.error)})}
function dbDelete(id){return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=()=>{scheduleDropboxSync();res()};r.onerror=()=>rej(r.error)})}
function dbReplaceAll(list){return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);store.clear();for(const a of list)store.put(a);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
function stripHtml(html){const d=document.createElement('div');d.innerHTML=html;return (d.textContent||'').replace(/\s+/g,' ').trim()}
function sanitize(html){if(window.DOMPurify)return DOMPurify.sanitize(html,{USE_PROFILES:{html:true},ADD_ATTR:['target','rel']});const d=document.createElement('template');d.innerHTML=html;d.content.querySelectorAll('script,style,iframe,object,embed,form,input,button').forEach(n=>n.remove());d.content.querySelectorAll('*').forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||((a.name==='href'||a.name==='src')&&/^javascript:/i.test(a.value)))n.removeAttribute(a.name)}));return d.innerHTML}
function readingMinutes(a){return Math.max(1,Math.round((a.wordCount||stripHtml(a.content).split(/\s+/).length)/225))}
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}}
function currentArticle(){return articles.find(a=>a.id===currentId)}

function refreshIcons(){if(window.lucide)window.lucide.createIcons()}
function clampNumber(value,min,max){return Math.min(max,Math.max(min,value))}
function loadLayoutWidths(){try{const raw=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'{}');return {sidebar:Number.isFinite(Number(raw.sidebar))?Number(raw.sidebar):LAYOUT_DEFAULTS.sidebar,list:Number.isFinite(Number(raw.list))?Number(raw.list):LAYOUT_DEFAULTS.list}}catch{return {...LAYOUT_DEFAULTS}}}
function saveLayoutWidths(){try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layoutWidths))}catch{}}
function desktopLayoutActive(){return window.matchMedia('(min-width: 901px)').matches}
function clampLayoutToViewport(){const shell=document.querySelector('.app-shell');if(!shell)return;const width=shell.getBoundingClientRect().width||innerWidth;layoutWidths.sidebar=clampNumber(layoutWidths.sidebar,LAYOUT_LIMITS.sidebarMin,Math.min(LAYOUT_LIMITS.sidebarMax,Math.max(LAYOUT_LIMITS.sidebarMin,width-LAYOUT_LIMITS.listMin-LAYOUT_LIMITS.readerMin)));layoutWidths.list=clampNumber(layoutWidths.list,LAYOUT_LIMITS.listMin,Math.min(LAYOUT_LIMITS.listMax,Math.max(LAYOUT_LIMITS.listMin,width-layoutWidths.sidebar-LAYOUT_LIMITS.readerMin)))}
function applyLayoutWidths(){const root=document.documentElement;if(!desktopLayoutActive()){root.style.removeProperty('--sidebar-width');root.style.removeProperty('--list-width');return}clampLayoutToViewport();root.style.setProperty('--sidebar-width',`${Math.round(layoutWidths.sidebar)}px`);root.style.setProperty('--list-width',`${Math.round(layoutWidths.list)}px`)}
function setupColumnResizers(){const shell=document.querySelector('.app-shell'),sidebarResizer=$('#sidebarResizer'),listResizer=$('#listResizer');if(!shell||!sidebarResizer||!listResizer)return;const startDrag=(kind,event)=>{if(!desktopLayoutActive()||event.button!==0)return;event.preventDefault();const resizer=kind==='sidebar'?sidebarResizer:listResizer;resizer.classList.add('active');document.body.classList.add('resizing-columns');try{resizer.setPointerCapture(event.pointerId)}catch{}const move=e=>{const rect=shell.getBoundingClientRect(),x=e.clientX-rect.left;if(kind==='sidebar'){const maxSidebar=Math.min(LAYOUT_LIMITS.sidebarMax,rect.width-layoutWidths.list-LAYOUT_LIMITS.readerMin);layoutWidths.sidebar=clampNumber(x,LAYOUT_LIMITS.sidebarMin,Math.max(LAYOUT_LIMITS.sidebarMin,maxSidebar))}else{const maxList=Math.min(LAYOUT_LIMITS.listMax,rect.width-layoutWidths.sidebar-LAYOUT_LIMITS.readerMin);layoutWidths.list=clampNumber(x-layoutWidths.sidebar,LAYOUT_LIMITS.listMin,Math.max(LAYOUT_LIMITS.listMin,maxList))}applyLayoutWidths()};const end=e=>{move(e);resizer.classList.remove('active');document.body.classList.remove('resizing-columns');resizer.removeEventListener('pointermove',move);resizer.removeEventListener('pointerup',end);resizer.removeEventListener('pointercancel',end);try{resizer.releasePointerCapture(e.pointerId)}catch{}saveLayoutWidths();clearTimeout(resizeTimer);resizeTimer=setTimeout(paginate,80)};resizer.addEventListener('pointermove',move);resizer.addEventListener('pointerup',end);resizer.addEventListener('pointercancel',end)};sidebarResizer.addEventListener('pointerdown',e=>startDrag('sidebar',e));listResizer.addEventListener('pointerdown',e=>startDrag('list',e));sidebarResizer.addEventListener('dblclick',()=>{layoutWidths.sidebar=LAYOUT_DEFAULTS.sidebar;applyLayoutWidths();saveLayoutWidths();paginate()});listResizer.addEventListener('dblclick',()=>{layoutWidths.list=LAYOUT_DEFAULTS.list;applyLayoutWidths();saveLayoutWidths();paginate()});applyLayoutWidths()}
async function settleCanonicalImages(articleId){const token=++imageSettleSeq,imgs=[...$('#scrollArticle').querySelectorAll('img')].filter(img=>!img.complete);if(!imgs.length)return;const wait=img=>new Promise(resolve=>{const done=()=>resolve();img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true})});await Promise.race([Promise.all(imgs.map(wait)),new Promise(r=>setTimeout(r,1800))]);if(token!==imageSettleSeq||currentId!==articleId||$('#pagedReader').hidden)return;await paginate()}


function loadDropboxState(){try{const v=JSON.parse(localStorage.getItem(DROPBOX_KEY)||'{}');return v&&typeof v==='object'?{connected:false,...v}:{connected:false}}catch{return {connected:false}}}
function saveDropboxState(){localStorage.setItem(DROPBOX_KEY,JSON.stringify(dbx));updateDropboxUI()}
function dropboxRedirectUri(){return location.origin+location.pathname}
function dropboxRelativeTime(ts){if(!ts)return 'Not yet synced';const ms=Date.now()-Number(ts);if(ms<60000)return 'Synced just now';if(ms<3600000)return `Synced ${Math.max(1,Math.floor(ms/60000))}m ago`;if(ms<86400000)return `Synced ${Math.floor(ms/3600000)}h ago`;return `Synced ${Math.floor(ms/86400000)}d ago`}
function updateDropboxUI(statusText=''){
  const key=$('#dropboxAppKey'),uri=$('#dropboxRedirectUri'),status=$('#dropboxStatus'),connect=$('#connectDropboxBtn'),disconnect=$('#disconnectDropboxBtn');
  if(key&&document.activeElement!==key)key.value=dbx.appKey||'';
  if(uri)uri.textContent=dropboxRedirectUri();
  if(connect)connect.textContent=dbx.connected?'Sync now':'Connect Dropbox';
  if(disconnect)disconnect.hidden=!dbx.connected;
  if(status)status.textContent=statusText||(dbx.connected?dropboxRelativeTime(dbx.lastSync):'Not connected');
}
function base64Url(bytes){let b='';new Uint8Array(bytes).forEach(x=>b+=String.fromCharCode(x));return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function randomString(n=64){const b=new Uint8Array(n);crypto.getRandomValues(b);return base64Url(b)}
async function sha256base64url(text){return base64Url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))}
async function connectDropbox(){
  if(dbx.connected){await syncDropbox({announce:true});return}
  const appKey=$('#dropboxAppKey')?.value.trim();if(!appKey)return updateDropboxUI('Paste your Dropbox App Key first.');
  dbx.appKey=appKey;saveDropboxState();
  const verifier=randomString(64),state=randomString(24),challenge=await sha256base64url(verifier);
  localStorage.setItem(DROPBOX_PKCE_KEY,JSON.stringify({verifier,state,appKey,startedAt:Date.now()}));
  const q=new URLSearchParams({client_id:appKey,response_type:'code',redirect_uri:dropboxRedirectUri(),code_challenge:challenge,code_challenge_method:'S256',token_access_type:'offline',state});
  location.assign(`https://www.dropbox.com/oauth2/authorize?${q}`);
}
async function handleDropboxOAuth(){
  const q=new URLSearchParams(location.search),code=q.get('code');if(!code)return false;
  let pkce;try{pkce=JSON.parse(localStorage.getItem(DROPBOX_PKCE_KEY)||'{}')}catch{}
  const err=q.get('error_description')||q.get('error');
  if(err){history.replaceState({},'',dropboxRedirectUri());toast(`Dropbox: ${err}`);return true}
  if(!pkce?.verifier||!pkce?.appKey||q.get('state')!==pkce.state){history.replaceState({},'',dropboxRedirectUri());toast('Dropbox connection could not be verified');return true}
  updateDropboxUI('Connecting…');
  try{
    const body=new URLSearchParams({code,grant_type:'authorization_code',client_id:pkce.appKey,redirect_uri:dropboxRedirectUri(),code_verifier:pkce.verifier});
    const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const data=await r.json();if(!r.ok)throw new Error(data.error_description||'Dropbox connection failed');
    dbx={connected:true,appKey:pkce.appKey,accessToken:data.access_token,refreshToken:data.refresh_token||null,expiresAt:Date.now()+((data.expires_in||14400)*1000)-60000,lastSync:null};
    localStorage.removeItem(DROPBOX_PKCE_KEY);history.replaceState({},'',dropboxRedirectUri());saveDropboxState();await syncDropbox({announce:true});toast('Dropbox connected');
  }catch(e){console.error(e);dbx.connected=false;saveDropboxState();updateDropboxUI(e.message||'Dropbox connection failed')}
  return true;
}
async function validDropboxToken(){
  if(!dbx.connected||!dbx.accessToken)throw new Error('Dropbox is not connected');
  if(!dbx.expiresAt||Date.now()<dbx.expiresAt)return dbx.accessToken;
  if(!dbx.refreshToken)throw new Error('Dropbox authorization expired. Reconnect Dropbox.');
  const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:dbx.refreshToken,client_id:dbx.appKey});
  const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const data=await r.json();if(!r.ok)throw new Error('Could not refresh Dropbox authorization');
  dbx.accessToken=data.access_token;dbx.expiresAt=Date.now()+((data.expires_in||14400)*1000)-60000;saveDropboxState();return dbx.accessToken;
}
async function readDropboxLibrary(){
  const token=await validDropboxToken();const r=await fetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Dropbox-API-Arg':JSON.stringify({path:DROPBOX_FILE})}});
  if(r.status===409)return null;if(!r.ok)throw new Error('Could not read Reader data from Dropbox');
  try{return JSON.parse(await r.text())}catch{throw new Error('Dropbox Reader data is not valid JSON')}
}
async function writeDropboxLibrary(payload){
  const token=await validDropboxToken();const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:DROPBOX_FILE,mode:'overwrite',autorename:false,mute:true})},body:JSON.stringify(payload)});
  if(!r.ok)throw new Error('Could not save Reader data to Dropbox');
}
function articleStamp(a){return Number(a?.updatedAt||a?.savedAt||0)}
function cleanArticleForSync(a){const out={};for(const [k,v] of Object.entries(a||{}))if(!k.startsWith('_')&&typeof v!=='function')out[k]=v;return out}
function mergeTombstones(a={},b={}){const out={...a};for(const [id,ts] of Object.entries(b||{}))out[id]=Math.max(Number(out[id]||0),Number(ts||0));const cutoff=Date.now()-180*86400000;for(const [id,ts] of Object.entries(out))if(Number(ts)<cutoff)delete out[id];return out}
function mergeArticleLists(local,remote,tombs){const map=new Map();for(const a of [...(local||[]),...(remote||[])]){if(!a?.id)continue;const prev=map.get(a.id);if(!prev||articleStamp(a)>=articleStamp(prev))map.set(a.id,a)}return [...map.values()].filter(a=>Number(tombs[a.id]||0)<articleStamp(a)).map(cleanArticleForSync)}
function newerObject(local,remote){const l=Number(local?.updatedAt||0),r=Number(remote?.updatedAt||0);return r>l?{...remote}:{...local}}
function localDropboxPayload(){return {version:1,syncedAt:Date.now(),meta:{...meta},settings:{...settings},deletedArticles:{...deletedArticles},articles:articles.map(cleanArticleForSync)}}
function articleUiStamp(a){
  if(!a)return '';
  return JSON.stringify({id:a.id,title:a.title,byline:a.byline,siteName:a.siteName,url:a.url,excerpt:a.excerpt,content:a.content,textContent:a.textContent,archived:!!a.archived,favorite:!!a.favorite,folderId:a.folderId||null,mode:a.mode||null});
}
function libraryUiStamp(articleList=articles,metaObj=meta,settingsObj=settings){
  return JSON.stringify({
    meta:{folders:metaObj?.folders||[],folderSort:metaObj?.folderSort||'manual'},
    settings:{mode:settingsObj?.mode,font:settingsObj?.font,size:settingsObj?.size,line:settingsObj?.line,width:settingsObj?.width,theme:settingsObj?.theme},
    articles:(articleList||[]).map(articleUiStamp)
  });
}
async function applyMergedLibrary(payload){
  suppressDropboxSync=true;
  try{
    const beforeUi=libraryUiStamp();
    const beforeSettings=JSON.stringify({mode:settings.mode,font:settings.font,size:settings.size,line:settings.line,width:settings.width,theme:settings.theme});
    meta={folders:[],folderSort:'manual',...(payload.meta||{})};settings={...settings,...(payload.settings||{})};repairSettings();deletedArticles=payload.deletedArticles||{};articles=payload.articles||[];
    await dbReplaceAll(articles);localStorage.setItem(META_KEY,JSON.stringify(meta));localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));localStorage.setItem(DELETED_KEY,JSON.stringify(deletedArticles));
    if(currentId&&!articles.some(a=>a.id===currentId)){currentId=null;$('#readerView').hidden=true;$('#emptyReader').hidden=false}
    const afterUi=libraryUiStamp();
    const afterSettings=JSON.stringify({mode:settings.mode,font:settings.font,size:settings.size,line:settings.line,width:settings.width,theme:settings.theme});
    // Reading progress and timestamps sync frequently. They must not rebuild the
    // reader pane, because that causes a visible flash about 1-2 seconds after a
    // page turn when Dropbox sync finishes. Only rerender when visible library
    // structure/content or appearance settings actually changed.
    if(beforeUi!==afterUi){
      if(beforeSettings!==afterSettings)applySettings();
      renderAll();
      const a=currentArticle();
      if(a&&$('#readerView')&&!$('#readerView').hidden){
        $('#sourceLabel').textContent=a.siteName||hostOf(a.url)||'Saved article';
        $('#readingTimeLabel').textContent=`${readingMinutes(a)} min read`;
        $('#favoriteBtn').classList.toggle('is-favorite',!!a.favorite);$('#favoriteBtn').title=a.favorite?'Remove favorite':'Favorite';$('#favoriteBtn').setAttribute('aria-label',$('#favoriteBtn').title);
        $('#archiveBtn').title=a.archived?'Move to Inbox':'Archive';$('#archiveBtn').setAttribute('aria-label',$('#archiveBtn').title);$('#archiveBtn').innerHTML=`<i data-lucide="${a.archived?'archive-restore':'archive'}"></i>`;refreshIcons();
        $('#originalBtn').disabled=!a.url;
        // Only replace/repage the article if its visible article data changed.
        // Folder ordering, counts, etc. can update without disturbing reading.
        const currentShell=$('#scrollArticle').innerHTML;
        const nextShell=articleShell(a);
        if(currentShell!==nextShell){
          $('#scrollArticle').innerHTML=nextShell;
          if(!$('#pagedReader').hidden)requestAnimationFrame(()=>paginate().then(()=>restoreProgress(a)));
        }
      }
    }
  }finally{suppressDropboxSync=false}
}
function scheduleDropboxSync(){if(suppressDropboxSync||!dbx.connected)return;clearTimeout(dropboxSyncTimer);dropboxSyncTimer=setTimeout(()=>syncDropbox().catch(()=>{}),DROPBOX_SYNC_DELAY)}
async function syncDropbox({announce=false}={}){
  if(!dbx.connected)return;if(dropboxSyncing){dropboxSyncAgain=true;return}dropboxSyncing=true;dropboxSyncAgain=false;clearTimeout(dropboxSyncTimer);updateDropboxUI('Syncing…');
  try{
    const remote=await readDropboxLibrary(),local=localDropboxPayload();let merged=local;
    if(remote){const tombs=mergeTombstones(local.deletedArticles,remote.deletedArticles);merged={version:1,syncedAt:Date.now(),deletedArticles:tombs,articles:mergeArticleLists(local.articles,remote.articles,tombs),meta:newerObject(local.meta,remote.meta),settings:newerObject(local.settings,remote.settings)}}
    await applyMergedLibrary(merged);await writeDropboxLibrary(localDropboxPayload());dbx.lastSync=Date.now();saveDropboxState();updateDropboxUI();if(announce)toast('Dropbox synced');
  }catch(e){console.error(e);updateDropboxUI(e.message||'Dropbox sync failed');if(announce)toast('Dropbox sync failed')}
  finally{dropboxSyncing=false;if(dropboxSyncAgain){dropboxSyncAgain=false;setTimeout(()=>syncDropbox().catch(()=>{}),0)}}
}
function disconnectDropbox(){dbx={connected:false,appKey:dbx.appKey||''};saveDropboxState();updateDropboxUI('Dropbox disconnected from this browser.')}

async function saveArticle(raw){const now=Date.now();let content=sanitize(raw.content||'');const tmp=document.createElement('div');tmp.innerHTML=content;tmp.querySelectorAll('a[href]').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});content=tmp.innerHTML;const text=raw.textContent||stripHtml(content);const a={id:raw.id||uid(),title:(raw.title||'Untitled').trim(),byline:raw.byline||'',siteName:raw.siteName||hostOf(raw.url),url:raw.url||'',excerpt:raw.excerpt||text.slice(0,240),content,textContent:text,wordCount:text.split(/\s+/).filter(Boolean).length,savedAt:raw.savedAt||now,updatedAt:now,archived:false,favorite:false,folderId:null,progress:0,...raw,content,textContent:text};await dbPut(a);const i=articles.findIndex(x=>x.id===a.id);if(i>=0)articles[i]=a;else articles.unshift(a);cacheImages(a);renderAll();openArticle(a.id);toast('Saved to Reader')}
async function cacheImages(a){const tmp=document.createElement('div');tmp.innerHTML=a.content;const urls=[...tmp.querySelectorAll('img[src]')].map(i=>i.src).filter(u=>/^https?:/.test(u));if(!urls.length||!('caches'in window))return;try{const c=await caches.open('reader-images-v1');for(const u of urls.slice(0,60)){try{const req=new Request(u,{mode:'no-cors'});const old=await c.match(req);if(!old){const resp=await fetch(req);await c.put(req,resp)}}catch{}}}catch{}}

function filteredArticles(){const q=$('#searchInput').value.trim().toLowerCase();let arr=articles.filter(a=>{if(currentFolder)return a.folderId===currentFolder&&!a.archived;if(currentView==='favorites')return a.favorite&&!a.archived;if(currentView==='archive')return a.archived;return !a.archived&&!a.folderId});if(q)arr=arr.filter(a=>[a.title,a.excerpt,a.siteName,a.byline,a.textContent].some(v=>(v||'').toLowerCase().includes(q)));const sort=$('#sortSelect').value;arr.sort((a,b)=>sort==='oldest'?a.savedAt-b.savedAt:sort==='title'?a.title.localeCompare(b.title):sort==='source'?(a.siteName||'').localeCompare(b.siteName||''):b.savedAt-a.savedAt);return arr}
function renderAll(){renderSidebar();renderList()}
function folderById(id){return meta.folders.find(f=>f.id===id)}
function displayedFolders(){
  const folders=[...meta.folders];
  if(meta.folderSort==='alpha')folders.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  return folders;
}
function reorderFolder(dragId,targetId,after=false){
  if(meta.folderSort!=='manual'||!dragId||!targetId||dragId===targetId)return;
  const from=meta.folders.findIndex(f=>f.id===dragId);if(from<0)return;
  const [moved]=meta.folders.splice(from,1);
  let to=meta.folders.findIndex(f=>f.id===targetId);if(to<0){meta.folders.splice(from,0,moved);return}
  if(after)to+=1;
  meta.folders.splice(to,0,moved);
  saveMeta();renderSidebar();toast('Folder order saved');
}
function clearFolderDropIndicators(){
  $$('.folder-drop-before,.folder-drop-after').forEach(x=>x.classList.remove('folder-drop-before','folder-drop-after'));
}
function wireFolderSortRow(row){
  if(!row||meta.folderSort!=='manual')return;
  const id=row.dataset.folderWrap,handle=row.querySelector('.folder-drag-handle');if(!handle)return;
  handle.draggable=true;
  handle.addEventListener('dragstart',e=>{
    if(draggedArticleId){e.preventDefault();return}
    draggedFolderId=id;row.classList.add('folder-dragging');
    if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/x-reader-folder',id);e.dataTransfer.setData('text/plain',id)}
  });
  row.addEventListener('dragover',e=>{
    if(!draggedFolderId||draggedFolderId===id)return;
    e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
    clearFolderDropIndicators();
    const r=row.getBoundingClientRect();row.classList.add(e.clientY<r.top+r.height/2?'folder-drop-before':'folder-drop-after');
  });
  row.addEventListener('drop',e=>{
    if(!draggedFolderId)return;
    e.preventDefault();e.stopPropagation();
    const r=row.getBoundingClientRect(),after=e.clientY>=r.top+r.height/2;
    const dragId=e.dataTransfer?.getData('text/x-reader-folder')||draggedFolderId;
    clearFolderDropIndicators();reorderFolder(dragId,id,after);
  });
  handle.addEventListener('dragend',()=>{draggedFolderId=null;row.classList.remove('folder-dragging');clearFolderDropIndicators()});
}
async function moveArticleToFolder(articleId,folderId){
  const a=articles.find(x=>x.id===articleId);if(!a)return;
  a.folderId=folderId||null;
  a.archived=false;
  a.updatedAt=Date.now();
  await dbPut(a);
  renderAll();
  const name=folderId?(folderById(folderId)?.name||'folder'):'Inbox';
  toast(`Moved to ${name}`);
}
function wireDropTarget(el,folderId){
  if(!el)return;
  el.addEventListener('dragover',e=>{if(!draggedArticleId)return;e.preventDefault();e.stopPropagation();if(e.dataTransfer)e.dataTransfer.dropEffect='move';el.classList.add('article-drop-target')});
  el.addEventListener('dragleave',e=>{if(!el.contains(e.relatedTarget))el.classList.remove('article-drop-target')});
  el.addEventListener('drop',e=>{if(!draggedArticleId)return;e.preventDefault();e.stopPropagation();el.classList.remove('article-drop-target');const id=e.dataTransfer?.getData('text/x-reader-article')||e.dataTransfer?.getData('text/plain')||draggedArticleId;if(id)moveArticleToFolder(id,folderId)});
}
function renderSidebar(){
  const inbox=articles.filter(a=>!a.archived&&!a.folderId).length,fav=articles.filter(a=>a.favorite&&!a.archived).length,arc=articles.filter(a=>a.archived).length;
  $('#inboxCount').textContent=inbox||'';$('#favoriteCount').textContent=fav||'';$('#archiveCount').textContent=arc||'';
  $$('.nav-item').forEach(b=>b.classList.toggle('active',!currentFolder&&b.dataset.view===currentView));
  const folders=displayedFolders();
  $('#folderSortSelect').value=meta.folderSort;
  $('#folderList').innerHTML=folders.map(f=>`<div class="folder-row-wrap ${currentFolder===f.id?'active':''}" data-folder-wrap="${f.id}">${meta.folderSort==='manual'?'<span class="folder-drag-handle" title="Drag to reorder" aria-hidden="true"><i data-lucide="grip-vertical"></i></span>':''}<button class="folder-item ${currentFolder===f.id?'active':''}" data-folder="${f.id}"><span>${esc(f.name)}</span><span class="count">${articles.filter(a=>a.folderId===f.id&&!a.archived).length||''}</span></button><button class="folder-more" data-folder-more="${f.id}" title="Folder options" aria-label="Folder options"><i data-lucide="ellipsis"></i></button></div>`).join('');
  $$('.folder-item').forEach(b=>b.onclick=()=>{currentFolder=b.dataset.folder;currentView='inbox';renderAll();if(innerWidth<=900){$('#sidebar').classList.remove('open');$('#backdrop').hidden=true}});
  $$('[data-folder-more]').forEach(b=>b.onclick=e=>{e.stopPropagation();openFolderEditor(b.dataset.folder)});
  $$('.folder-row-wrap').forEach(w=>{wireDropTarget(w,w.dataset.folderWrap);wireFolderSortRow(w)});
  wireDropTarget(document.querySelector('.nav-item[data-view="inbox"]'),null);
  refreshIcons();
}
function renderList(){
  const arr=filteredArticles();const title=currentFolder?(folderById(currentFolder)?.name||'Folder'):{inbox:'Inbox',favorites:'Favorites',archive:'Archive'}[currentView];
  $('#viewTitle').textContent=title;$('#viewSubtitle').textContent=`${arr.length} article${arr.length===1?'':'s'}`;
  $('#articleList').innerHTML=arr.length?arr.map(a=>`<div class="article-row ${a.id===currentId?'active':''}" data-id="${a.id}" draggable="true"><div class="article-drag" title="Drag to a folder" aria-hidden="true"><i data-lucide="grip-vertical"></i></div><div class="article-row-body"><div class="article-row-title">${a.favorite?'<span class="fav"><i data-lucide="star"></i></span> ':''}${esc(a.title)}</div><div class="article-row-excerpt">${esc(a.excerpt||'')}</div><div class="article-row-meta"><span>${esc(a.siteName||hostOf(a.url)||'Saved article')}</span><span>·</span><span>${readingMinutes(a)} min</span><span>·</span><span>${formatAge(a.savedAt)}</span></div></div></div>`).join(''):`<div class="empty-reader" style="height:auto;padding-top:60px"><p>No articles here yet.</p></div>`;
  refreshIcons();
  $$('.article-row').forEach(r=>{
    r.onclick=()=>openArticle(r.dataset.id);
    r.addEventListener('dragstart',e=>{draggedFolderId=null;draggedArticleId=r.dataset.id;r.classList.add('dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/x-reader-article',draggedArticleId);e.dataTransfer.setData('text/plain',draggedArticleId)}});
    r.addEventListener('dragend',()=>{draggedArticleId=null;r.classList.remove('dragging');$$('.article-drop-target').forEach(x=>x.classList.remove('article-drop-target'))});
  });
}
function openFolderEditor(id=null){
  folderEditorId=id;
  const f=id?folderById(id):null;
  $('#folderDialogTitle').textContent=f?'Edit folder':'New folder';
  $('#folderNameInput').value=f?.name||'';
  $('#deleteFolderBtn').hidden=!f;
  $('#folderDialog').showModal();
  requestAnimationFrame(()=>{$('#folderNameInput').focus();$('#folderNameInput').select()});
}
async function saveFolderEditor(){
  const name=$('#folderNameInput').value.trim();if(!name)return toast('Give the folder a name');
  if(folderEditorId){const f=folderById(folderEditorId);if(f)f.name=name}else meta.folders.push({id:uid(),name});
  saveMeta();$('#folderDialog').close();renderAll();toast(folderEditorId?'Folder renamed':'Folder created');folderEditorId=null;
}
async function deleteFolder(){
  const f=folderById(folderEditorId);if(!f)return;
  if(!confirm(`Delete “${f.name}”? Articles in it will move back to Inbox.`))return;
  const affected=articles.filter(a=>a.folderId===f.id);for(const a of affected){a.folderId=null;a.updatedAt=Date.now();await dbPut(a)}
  meta.folders=meta.folders.filter(x=>x.id!==f.id);saveMeta();if(currentFolder===f.id){currentFolder=null;currentView='inbox'}
  $('#folderDialog').close();folderEditorId=null;renderAll();toast('Folder deleted');
}
function formatAge(t){const d=(Date.now()-t)/86400000;if(d<1)return 'Today';if(d<2)return 'Yesterday';if(d<7)return `${Math.floor(d)}d ago`;return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'})}

function normalizeReaderHtml(html=''){
  const t=document.createElement('template');
  t.innerHTML=sanitize(html);
  // Readability has already identified the article. Source-site visibility/layout
  // attributes often depend on the site's JavaScript, so strip them rather than
  // deleting otherwise valid extracted article text.
  t.content.querySelectorAll('script,style,noscript,template,form,button,input,select,textarea').forEach(el=>el.remove());
  t.content.querySelectorAll('*').forEach(el=>{
    ['style','class','id','width','height','align','bgcolor','color','face','size','hidden','aria-hidden','inert'].forEach(a=>el.removeAttribute(a));
    if(el.tagName==='IMG'){
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
      el.removeAttribute('loading');
    }
  });
  return t.innerHTML;
}
function textFallbackHtml(text=''){
  const clean=String(text||'').replace(/\r/g,'').trim();
  if(!clean)return '';
  let blocks=clean.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  if(blocks.length<=1)blocks=clean.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  // Readability textContent can occasionally arrive as one enormous line.
  // Break very long blocks at sentence/word boundaries so pagination has
  // manageable paragraphs to measure instead of one monolithic node.
  const out=[];
  for(const block of blocks.length?blocks:[clean]){
    let rest=block;
    while(rest.length>1600){
      let cut=-1;
      const window=rest.slice(0,1600);
      const sentence=[...window.matchAll(/[.!?][”’"')\]]?\s+/g)].pop();
      if(sentence)cut=sentence.index+sentence[0].length;
      if(cut<700){const ws=window.lastIndexOf(' ');cut=ws>700?ws:1600}
      out.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();
    }
    if(rest)out.push(rest);
  }
  return out.map(x=>`<p>${esc(x)}</p>`).join('');
}
function articleBodyHtml(a,forceText=false){
  const cleaned=normalizeReaderHtml(a.content||'');
  const cleanedText=stripHtml(cleaned).replace(/\s+/g,' ').trim();
  const savedRaw=String(a.textContent||'').trim();
  const savedText=savedRaw.replace(/\s+/g,' ').trim();
  if(forceText)return textFallbackHtml(savedRaw)||cleaned;
  if(!savedText)return cleaned;
  // Validate coverage, not merely the presence of a small amount of text.
  // A long captured article should not be considered healthy when only a
  // short wrapper/caption survives HTML normalization.
  const coverage=savedText.length?cleanedText.length/savedText.length:1;
  const materiallyShort=cleanedText.length<Math.max(120,Math.min(900,savedText.length*.35));
  const poorCoverage=savedText.length>600&&coverage<.55;
  if(!cleanedText||materiallyShort||poorCoverage)return textFallbackHtml(savedRaw)||cleaned;
  return cleaned;
}
function articleShell(a,forceText=false){return `<h1 class="reader-title">${esc(a.title)}</h1><div class="reader-deck">${[a.byline,a.siteName].filter(Boolean).map(esc).join(' · ')}${a.excerpt?`<br>${esc(a.excerpt)}`:''}</div>${articleBodyHtml(a,forceText)}`}
async function openArticle(id){
  const a=articles.find(x=>x.id===id);if(!a)return;
  currentId=id;currentPage=0;
  document.querySelector('.app-shell')?.classList.remove('tablet-list-only');
  $('#emptyReader').hidden=true;$('#readerView').hidden=false;$('#readerPane').classList.add('mobile-open');
  $('#sourceLabel').textContent=a.siteName||hostOf(a.url)||'Saved article';
  $('#readingTimeLabel').textContent=`${readingMinutes(a)} min read`;
  $('#favoriteBtn').classList.toggle('is-favorite',!!a.favorite);$('#favoriteBtn').title=a.favorite?'Remove favorite':'Favorite';$('#favoriteBtn').setAttribute('aria-label',$('#favoriteBtn').title);
  $('#archiveBtn').title=a.archived?'Move to Inbox':'Archive';$('#archiveBtn').setAttribute('aria-label',$('#archiveBtn').title);$('#archiveBtn').innerHTML=`<i data-lucide="${a.archived?'archive-restore':'archive'}"></i>`;$('#originalBtn').disabled=!a.url;refreshIcons();
  // Scroll view is the canonical rendered article. Paged mode clones this exact
  // body, so the two modes cannot diverge because of separate cleaning passes.
  const shell=articleShell(a);
  $('#scrollArticle').innerHTML=shell;
  renderList();setMode(a.mode||settings.mode,false,false);
  requestAnimationFrame(async()=>{await paginate();if(currentId!==id)return;restoreProgress(a);settleCanonicalImages(id).catch(()=>{})});
}
function setReaderFocus(on){
  const shell=document.querySelector('.app-shell'),btn=$('#fullscreenBtn'),panelBtn=$('#tabletPanelBtn');
  if(!shell)return;
  shell.classList.toggle('reader-focus',!!on);
  const active=shell.classList.contains('reader-focus');
  if(btn){btn.innerHTML=`<i data-lucide="${active?'minimize-2':'maximize-2'}"></i>`;btn.title=active?'Exit full-screen reading':'Full-screen reading';btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-pressed',String(active))}
  if(panelBtn){panelBtn.innerHTML=`<i data-lucide="${active?'panel-left-open':'panel-left-close'}"></i>`;panelBtn.title=active?'Show article list':'Hide article list';panelBtn.setAttribute('aria-label',panelBtn.title);panelBtn.setAttribute('aria-pressed',String(active))}
  refreshIcons();
  clearTimeout(resizeTimer);resizeTimer=setTimeout(paginate,80);
}
function toggleReaderFocus(){const shell=document.querySelector('.app-shell');if(shell)setReaderFocus(!shell.classList.contains('reader-focus'))}
function closeMobileArticle(){
  setReaderFocus(false);
  const shell=document.querySelector('.app-shell');
  if(innerWidth<=680){$('#readerPane').classList.remove('mobile-open');return}
  if(innerWidth<=900&&shell){shell.classList.add('tablet-list-only');requestAnimationFrame(()=>$('#articleList')?.focus?.())}
}
function setMode(mode,save=true,repaginate=true){const a=currentArticle();mode=mode==='scroll'?'scroll':'paged';$('#scrollReader').hidden=mode!=='scroll';$('#pagedReader').hidden=mode!=='paged';$('#modeBtn').textContent=mode==='paged'?'Paged':'Scroll';if(a&&save){a.mode=mode;a.updatedAt=Date.now();dbPut(a)}if(mode==='paged'&&repaginate)requestAnimationFrame(paginate)}
function pageHasContent(page){return page && page.childNodes.length>0}
function makePage(deck){
  const page=document.createElement('article');
  page.className='article-content reader-page';
  deck.appendChild(page);
  return page;
}
function pageFits(page){
  // Measure the actual rendered bottom edge rather than relying on scrollHeight.
  // A fixed-height page's scrollHeight is always at least its clientHeight and can
  // be a little optimistic around line boxes in Safari. Keep a small safety gap so
  // the final line never sits under the page boundary/footer.
  const pr=page.getBoundingClientRect();
  const children=[...page.children];
  if(!children.length)return true;
  let bottom=pr.top;
  for(const child of children){
    const r=child.getBoundingClientRect();
    if(!r.width&&!r.height)continue;
    const cs=getComputedStyle(child);
    const mb=parseFloat(cs.marginBottom)||0;
    bottom=Math.max(bottom,r.bottom+mb);
  }
  return bottom<=pr.bottom-10;
}
function textNodesOf(el){
  const out=[],w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let n; while((n=w.nextNode())) out.push(n);
  return out;
}
function rangePoint(nodes,index){
  let left=Math.max(0,index);
  for(const n of nodes){
    if(left<=n.nodeValue.length)return [n,left];
    left-=n.nodeValue.length;
  }
  const n=nodes[nodes.length-1];
  return n?[n,n.nodeValue.length]:[null,0];
}
function cloneTextSlice(el,start,end){
  const clone=el.cloneNode(false),nodes=textNodesOf(el);
  if(!nodes.length)return clone;
  const [sn,so]=rangePoint(nodes,start),[en,eo]=rangePoint(nodes,end);
  if(!sn||!en)return clone;
  const r=document.createRange();r.setStart(sn,so);r.setEnd(en,eo);
  clone.appendChild(r.cloneContents());
  return clone;
}
function bestTextEnd(el,start,total,page){
  let lo=start+1,hi=total,best=start;
  while(lo<=hi){
    const mid=Math.floor((lo+hi)/2),candidate=cloneTextSlice(el,start,mid);
    page.appendChild(candidate);
    const ok=pageFits(page);
    candidate.remove();
    if(ok){best=mid;lo=mid+1}else hi=mid-1;
  }
  if(best<=start)return start;
  if(best<total){
    const text=el.textContent||'';
    const floor=Math.max(start+1,best-80);
    let cut=best;
    for(let i=best;i>=floor;i--){if(/\s/.test(text[i-1]||'')){cut=i;break}}
    if(cut>start+8)best=cut;
  }
  return best;
}
function forceBlock(page,node){
  const c=node.cloneNode(true);c.classList?.add('reader-forced-block');page.appendChild(c);return c;
}
function paginateTextBlock(el,state){
  const total=(el.textContent||'').length;
  if(!total){forceBlock(state.page,el);return}
  let start=0;
  while(start<total){
    let end=bestTextEnd(el,start,total,state.page);
    if(end===start&&pageHasContent(state.page)){
      state.page=makePage(state.deck);end=bestTextEnd(el,start,total,state.page);
    }
    if(end===start){forceBlock(state.page,el);break}
    state.page.appendChild(cloneTextSlice(el,start,end));
    start=end;
    while(start<total&&/\s/.test((el.textContent||'')[start]))start++;
    if(start<total)state.page=makePage(state.deck);
  }
}
function paginateList(el,state){
  const tag=el.tagName.toLowerCase();let list=el.cloneNode(false);
  state.page.appendChild(list);
  for(const li of [...el.children]){
    const c=li.cloneNode(true);list.appendChild(c);
    if(pageFits(state.page))continue;
    c.remove();
    if(list.children.length===0)list.remove();
    state.page=makePage(state.deck);list=el.cloneNode(false);state.page.appendChild(list);
    list.appendChild(c);
    if(!pageFits(state.page)){
      c.remove();
      const proxy=document.createElement('p');proxy.className='reader-list-fragment';proxy.textContent=(tag==='ol'?'1. ':'• ')+(li.textContent||'');
      paginateTextBlock(proxy,state);
      list.remove();
      list=el.cloneNode(false);
      if(!state.page.contains(list))state.page.appendChild(list);
    }
  }
  if(!list.children.length)list.remove();
}
function paginateNode(node,state){
  if(node.nodeType===Node.TEXT_NODE){
    if(!node.textContent.trim())return;
    const p=document.createElement('p');p.textContent=node.textContent;paginateNode(p,state);return;
  }
  if(node.nodeType!==Node.ELEMENT_NODE)return;
  const tag=node.tagName.toLowerCase();

  // First see whether the node fits intact in the space that remains on the
  // current page. If it does, keep it there.
  const clone=node.cloneNode(true);state.page.appendChild(clone);
  if(pageFits(state.page))return;
  clone.remove();

  // Containers and text blocks are splittable. Crucially, split them into the
  // *remaining space on this page first* instead of jumping to a fresh page.
  // The old behaviour is what left every article's first page mostly blank.
  if(['div','section','article','main'].includes(tag)&&node.childNodes.length){
    for(const child of [...node.childNodes])paginateNode(child,state);
    return;
  }
  if(tag==='ul'||tag==='ol'){paginateList(node,state);return}
  if(['p','blockquote','li','h1','h2','h3','h4','h5','h6'].includes(tag)){
    paginateTextBlock(node,state);return;
  }

  // Truly indivisible blocks (images, figures, preformatted content, etc.) can
  // move to a fresh page. If even a fresh page cannot contain one, constrain it
  // rather than letting it clip through the footer.
  if(pageHasContent(state.page))state.page=makePage(state.deck);
  const whole=node.cloneNode(true);state.page.appendChild(whole);
  if(pageFits(state.page))return;
  whole.remove();
  forceBlock(state.page,node);
}
async function paginate(){
  if($('#pagedReader').hidden||!currentArticle())return;
  const seq=++paginateSeq,deck=$('#pageDeck'),vp=$('#pageViewport'),a=currentArticle();
  const savedProgress=Number.isFinite(a?.progress)?a.progress:(pageCount<=1?0:currentPage/(pageCount-1));
  deck.classList.add('repaginating');deck.style.visibility='hidden';deck.replaceChildren();
  try{if(document.fonts?.ready)await document.fonts.ready}catch{}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  if(seq!==paginateSeq)return;
  const host=vp.parentElement;
  const available=(host?.clientWidth||window.innerWidth||vp.clientWidth)-36;
  const width=Math.min(settings.width,Math.max(220,available));
  vp.style.width=width+'px';
  document.documentElement.style.setProperty('--reader-width',width+'px');
  const buildPages=(html)=>{
    deck.replaceChildren();
    const template=document.createElement('template');template.innerHTML=html;
    const state={deck,page:makePage(deck)};
    for(const node of [...template.content.childNodes])paginateNode(node,state);
    [...deck.children].forEach(p=>{if(!p.childNodes.length)p.remove()});
    if(!deck.children.length)makePage(deck);
  };
  const canonicalHtml=$('#scrollArticle').innerHTML||articleShell(a);
  buildPages(canonicalHtml);
  // Last-resort integrity check: if pagination somehow loses most of the captured
  // article, rebuild from the saved plain-text copy rather than showing a blank
  // or severely truncated reader view.
  const expected=String(a.textContent||'').replace(/\s+/g,' ').trim();
  const rendered=[...deck.children].map(p=>p.textContent||'').join(' ').replace(/\s+/g,' ').trim();
  const titleDeckAllowance=(a.title||'').length+(a.excerpt||'').length+(a.byline||'').length+(a.siteName||'').length+120;
  const renderedBody=Math.max(0,rendered.length-titleDeckAllowance);
  if(expected.length>600&&renderedBody<expected.length*.45){
    buildPages(articleShell(a,true));
    const forced=[...deck.children].map(p=>p.textContent||'').join(' ').replace(/\s+/g,' ').trim();
    if(forced.length<Math.min(500,expected.length*.2)){
      deck.replaceChildren();
      const p=makePage(deck);p.innerHTML=articleShell(a,true);p.classList.add('reader-emergency-page');
    }
  }
  pageCount=Math.max(1,deck.children.length);
  currentPage=Math.max(0,Math.min(pageCount-1,Math.round(savedProgress*Math.max(0,pageCount-1))));
  deck.style.visibility='';deck.classList.remove('repaginating');
  showCurrentPage();
}
function showCurrentPage(){
  const deck=$('#pageDeck');[...deck.children].forEach((p,i)=>p.classList.toggle('is-active',i===currentPage));updatePageUI();
}
function updatePageUI(){const a=currentArticle();$('#pageLabel').textContent=`Page ${currentPage+1} of ${pageCount}`;$('#prevPageBtn').disabled=currentPage<=0;$('#nextPageBtn').disabled=currentPage>=pageCount-1;const prog=pageCount<=1?1:(currentPage/(pageCount-1));$('#progressBar').style.width=`${prog*100}%`;if(a&&(Math.abs(Number(a.progress||0)-prog)>.0005||Number(a.lastPage)!==currentPage)){a.progress=prog;a.lastPage=currentPage;a.updatedAt=Date.now();dbPut(a)}}
function goPage(delta){currentPage=Math.max(0,Math.min(pageCount-1,currentPage+delta));showCurrentPage()}
function restoreProgress(a){if((a.mode||settings.mode)==='paged'){currentPage=Math.round((a.progress||0)*Math.max(0,pageCount-1));showCurrentPage()}else $('#scrollReader').scrollTop=(a.progress||0)*Math.max(0,$('#scrollReader').scrollHeight-$('#scrollReader').clientHeight)}
function saveScrollProgress(){const a=currentArticle();if(!a||$('#scrollReader').hidden)return;const el=$('#scrollReader'),den=Math.max(1,el.scrollHeight-el.clientHeight);a.progress=Math.min(1,Math.max(0,el.scrollTop/den));a.updatedAt=Date.now();clearTimeout(a._pTimer);a._pTimer=setTimeout(()=>dbPut(a),500)}

function applySettings(){document.documentElement.style.setProperty('--reader-font',settings.font);document.documentElement.style.setProperty('--reader-size',settings.size+'px');document.documentElement.style.setProperty('--reader-line',settings.line);document.documentElement.style.setProperty('--reader-width',settings.width+'px');const themeClasses=['theme-light','theme-sepia','theme-dark','theme-eink'];document.body.classList.remove(...themeClasses);document.documentElement.classList.remove(...themeClasses);document.body.classList.add('theme-'+settings.theme);document.documentElement.classList.add('theme-'+settings.theme);const themeColor={light:'#f7f5f1',sepia:'#eee5d5',dark:'#181817',eink:'#ffffff'}[settings.theme]||'#f7f5f1';const themeMeta=document.querySelector('meta[name="theme-color"]');if(themeMeta)themeMeta.setAttribute('content',themeColor);$('#fontSelect').value=settings.font;$('#fontSizeSelect').value=String(settings.size);$('#lineHeightSelect').value=String(settings.line);$('#widthSelect').value=String(settings.width);$$('.theme-row button').forEach(b=>b.classList.toggle('active',b.dataset.theme===settings.theme));$('#defaultModeSelect').value=settings.mode;requestAnimationFrame(paginate)}
function positionPopover(pop,anchor){const r=anchor.getBoundingClientRect();pop.hidden=false;const w=pop.offsetWidth,h=pop.offsetHeight;pop.style.left=Math.min(innerWidth-w-10,Math.max(10,r.right-w))+'px';pop.style.top=Math.min(innerHeight-h-10,r.bottom+7)+'px'}

function createBookmarklet(){const base=location.href.split('#')[0].split('?')[0];const origin=location.origin;const js=`javascript:(()=>{const R=${JSON.stringify(base)},O=${JSON.stringify(origin)},T=Math.random().toString(36).slice(2)+Date.now().toString(36);let W;const abs=(root)=>{root.querySelectorAll('[src]').forEach(e=>{try{e.src=new URL(e.getAttribute('src'),location.href).href}catch{}});root.querySelectorAll('a[href]').forEach(e=>{try{e.href=new URL(e.getAttribute('href'),location.href).href}catch{}})};const send=(a)=>{W=window.open(R+'#capture='+T,'_blank');const m={type:'reader-capture',token:T,article:{title:a.title||document.title,byline:a.byline||'',siteName:a.siteName||location.hostname,url:location.href,excerpt:a.excerpt||'',content:a.content||'',textContent:a.textContent||''}};let n=0;const i=setInterval(()=>{try{W.postMessage(m,O)}catch{}if(++n>16)clearInterval(i)},350)};const fallback=()=>{const n=(document.querySelector('article')||document.querySelector('main')||document.body).cloneNode(true);n.querySelectorAll('script,style,nav,form,button,aside').forEach(x=>x.remove());abs(n);send({title:document.title,content:n.innerHTML,textContent:n.textContent,siteName:location.hostname})};const run=()=>{try{const d=document.cloneNode(true);abs(d);const a=new Readability(d).parse();a?send(a):fallback()}catch(e){fallback()}};if(window.Readability)return run();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/Readability.js';s.onload=run;s.onerror=fallback;document.documentElement.appendChild(s);setTimeout(()=>{if(!window.Readability&&!W)fallback()},2500)})();`;return js.replace(/\n/g,'')}
function handleCapture(){const m=location.hash.match(/^#capture=(.+)$/);if(!m)return;const token=m[1];window.addEventListener('message',async e=>{if(!e.data||e.data.type!=='reader-capture'||e.data.token!==token)return;history.replaceState(null,'',location.pathname+location.search);await saveArticle(e.data.article)}, {once:true})}

async function init(){loadLocal();applySettings();applyLayoutWidths();refreshIcons();await openDb();articles=await dbAll();const oauth=await handleDropboxOAuth();if(!oauth&&dbx.connected)await syncDropbox();if(!articles.length)await createWelcome();for(let s=13;s<=28;s++)$('#fontSizeSelect').insertAdjacentHTML('beforeend',`<option value="${s}">${s} px</option>`);applySettings();renderAll();handleCapture();wire();setupColumnResizers();updateDropboxUI();refreshIcons();document.body.classList.remove('booting');document.body.classList.add('reader-ready');setTimeout(()=>document.querySelector('#readerBoot')?.remove(),200)}
async function createWelcome(){const content=`<p>Reader is a small read-it-later app with two reading styles.</p><h2>Try Paged mode</h2><p>Instead of scrolling forever, Paged mode lays the article out in screen-sized columns. Use the Previous and Next controls below, or the left and right arrow keys. Change the typeface, size, spacing, or reading width and Reader recalculates the pages for you.</p><p>This approach is especially pleasant for long essays, tablets, and e-ink-like reading. If you prefer the web’s usual behaviour, switch to Scroll at any time.</p><h2>Save something from the web</h2><p>Open Settings and drag <strong>Save to Reader</strong> to your bookmarks bar. Then visit an article and click the bookmarklet. Reader will attempt to extract the clean article using Mozilla Readability and add it to your Inbox.</p><p>Your saved article text lives locally in your browser in this first version. Reader also tries to cache article images for offline viewing when the source site permits it.</p><h2>A portable direction</h2><p>If you like the core reading experience, the next logical step is Dropbox sync so the same library and reading position can move among your devices. We can also add highlights, notes, tags, and a Send to Notes action without changing the basic reading interface.</p>`;await saveArticle({title:'Welcome to Reader',siteName:'Reader',excerpt:'A quick tour of paged and scrolling reading.',content,textContent:stripHtml(content),savedAt:Date.now()-1000})}

function wire(){
  $$('.nav-item').forEach(b=>b.onclick=()=>{currentFolder=null;currentView=b.dataset.view;renderAll();if(innerWidth<=900){$('#sidebar').classList.remove('open');$('#backdrop').hidden=true}});
  $('#searchInput').oninput=renderList;$('#sortSelect').onchange=renderList;
  $('#settingsBtn').onclick=()=>{const bm=createBookmarklet();$('#bookmarkletLink').href=bm;updateDropboxUI();$('#settingsDialog').showModal()};
  $('#addBtn').onclick=()=>$('#addDialog').showModal();
  $$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
  $('#saveManualBtn').onclick=async()=>{const val=$('#manualContent').value.trim();if(!val)return toast('Paste some article text first');const html=/<[a-z][\s\S]*>/i.test(val)?val:val.split(/\n\n+/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');await saveArticle({title:$('#manualTitle').value||'Untitled',url:$('#manualUrl').value,content:html,textContent:stripHtml(html)});$('#addDialog').close();$('#manualContent').value='';$('#manualTitle').value='';$('#manualUrl').value=''};
  $('#copyBookmarkletBtn').onclick=async()=>{await navigator.clipboard.writeText(createBookmarklet());toast('Bookmarklet copied')};
  $('#connectDropboxBtn').onclick=connectDropbox;$('#disconnectDropboxBtn').onclick=disconnectDropbox;$('#copyDropboxRedirectBtn').onclick=async()=>{await navigator.clipboard.writeText(dropboxRedirectUri());toast('Redirect URI copied')};
  const newFolderBtn=$('#newFolderBtn'),folderSortSelect=$('#folderSortSelect'),saveFolderBtn=$('#saveFolderBtn'),deleteFolderBtn=$('#deleteFolderBtn'),folderNameInput=$('#folderNameInput');
  if(newFolderBtn)newFolderBtn.onclick=()=>openFolderEditor();
  if(folderSortSelect)folderSortSelect.onchange=()=>{meta.folderSort=folderSortSelect.value;saveMeta();renderSidebar()};
  if(saveFolderBtn)saveFolderBtn.onclick=saveFolderEditor;
  if(deleteFolderBtn)deleteFolderBtn.onclick=deleteFolder;
  if(folderNameInput)folderNameInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveFolderEditor()}});
  $('#favoriteBtn').onclick=async()=>{const a=currentArticle();if(!a)return;a.favorite=!a.favorite;a.updatedAt=Date.now();await dbPut(a);$('#favoriteBtn').classList.toggle('is-favorite',a.favorite);$('#favoriteBtn').title=a.favorite?'Remove favorite':'Favorite';$('#favoriteBtn').setAttribute('aria-label',$('#favoriteBtn').title);renderAll()};
  $('#archiveBtn').onclick=async()=>{const a=currentArticle();if(!a)return;a.archived=!a.archived;a.updatedAt=Date.now();await dbPut(a);$('#archiveBtn').title=a.archived?'Move to Inbox':'Archive';$('#archiveBtn').setAttribute('aria-label',$('#archiveBtn').title);$('#archiveBtn').innerHTML=`<i data-lucide="${a.archived?'archive-restore':'archive'}"></i>`;refreshIcons();renderAll();toast(a.archived?'Archived':'Moved to Inbox')};
  $('#originalBtn').onclick=()=>{const a=currentArticle();if(a?.url)window.open(a.url,'_blank','noopener')};
  $('#fullscreenBtn').onclick=toggleReaderFocus;
  const tabletPanelBtn=$('#tabletPanelBtn');if(tabletPanelBtn)tabletPanelBtn.onclick=toggleReaderFocus;
  $('#modeBtn').onclick=()=>{const mode=$('#pagedReader').hidden?'paged':'scroll';setMode(mode);const a=currentArticle();if(a)a.mode=mode;};
  $('#prevPageBtn').onclick=()=>goPage(-1);$('#nextPageBtn').onclick=()=>goPage(1);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&document.querySelector('.app-shell')?.classList.contains('reader-focus')){setReaderFocus(false);e.preventDefault();return}
    if(!$('#pagedReader').hidden&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(e.key==='ArrowRight'||e.key==='PageDown'){goPage(1);e.preventDefault()}if(e.key==='ArrowLeft'||e.key==='PageUp'){goPage(-1);e.preventDefault()}}
  });
  let touchStart=null,pointerStart=null;
  const pageViewport=$('#pageViewport'),pagedReader=$('#pagedReader');
  const isInteractiveTapTarget=target=>!!target?.closest?.('a,button,input,select,textarea,label,[role="button"],[contenteditable="true"]');
  const tapToTurnPage=(clientX,target)=>{
    if(pagedReader.hidden||!currentArticle()||isInteractiveTapTarget(target)||target?.closest?.('.page-footer'))return;
    const sel=window.getSelection?.();if(sel&&!sel.isCollapsed&&String(sel).trim())return;
    const r=pageViewport.getBoundingClientRect();if(!r.width)return;
    const x=clientX-r.left,ratio=x/r.width;
    if(ratio<=0.38)goPage(-1);
    else if(ratio>=0.62)goPage(1);
  };
  pageViewport.addEventListener('touchstart',e=>{const t=e.touches[0];touchStart=t?{x:t.clientX,y:t.clientY}:null},{passive:true});
  pageViewport.addEventListener('touchend',e=>{
    if(!touchStart)return;
    const t=e.changedTouches[0];if(!t){touchStart=null;return}
    const dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))goPage(dx<0?1:-1);
    else if(Math.abs(dx)<12&&Math.abs(dy)<12)tapToTurnPage(t.clientX,e.target);
    touchStart=null;
  },{passive:true});
  // Desktop: listen on the whole reading surface, not just the text-width page.
  // This makes the outer margins generous page-turn targets while preserving
  // links, selection, the footer controls, and the quiet centre of the page.
  pagedReader.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.target?.closest?.('.page-footer'))return;pointerStart={x:e.clientX,y:e.clientY,target:e.target}});
  pagedReader.addEventListener('pointerup',e=>{if(!pointerStart||e.pointerType==='touch')return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;if(Math.abs(dx)<7&&Math.abs(dy)<7)tapToTurnPage(e.clientX,e.target);pointerStart=null});
  pagedReader.addEventListener('pointercancel',()=>{pointerStart=null});
  $('#scrollReader').onscroll=saveScrollProgress;
  $('#appearanceBtn').onclick=e=>positionPopover($('#appearancePopover'),e.currentTarget);$('#moreBtn').onclick=e=>positionPopover($('#morePopover'),e.currentTarget);
  document.addEventListener('pointerdown',e=>{for(const id of ['appearancePopover','morePopover']){const p=document.getElementById(id);if(!p.hidden&&!p.contains(e.target)&&!['appearanceBtn','moreBtn'].includes(e.target.id))p.hidden=true}});
  const updateAppearance=()=>{const size=Number($('#fontSizeSelect').value),line=Number($('#lineHeightSelect').value),width=Number($('#widthSelect').value);settings.font=$('#fontSelect').value||settings.font;if(Number.isFinite(size)&&size>=13&&size<=28)settings.size=size;if(Number.isFinite(line)&&line>=1.2&&line<=2.2)settings.line=line;if(Number.isFinite(width)&&width>=500&&width<=1000)settings.width=width;repairSettings();saveSettings();applySettings()};$('#fontSelect').onchange=updateAppearance;$('#fontSizeSelect').onchange=updateAppearance;$('#lineHeightSelect').onchange=updateAppearance;$('#widthSelect').onchange=updateAppearance;
  $$('.theme-row button').forEach(b=>b.onclick=()=>{settings.theme=b.dataset.theme;saveSettings();applySettings()});$('#defaultModeSelect').onchange=()=>{settings.mode=$('#defaultModeSelect').value;saveSettings()};
  $('#moveFolderBtn').onclick=async()=>{const a=currentArticle();if(!a)return;const choices=['Inbox',...meta.folders.map(f=>f.name)];const cur=a.folderId?meta.folders.findIndex(f=>f.id===a.folderId)+1:0;const ans=prompt('Move to folder:\n'+choices.map((x,i)=>`${i}: ${x}`).join('\n'),String(Math.max(0,cur)));if(ans===null)return;const n=Number(ans);if(!Number.isInteger(n)||n<0||n>=choices.length)return toast('Choose one of the listed numbers');await moveArticleToFolder(a.id,n===0?null:meta.folders[n-1].id);$('#morePopover').hidden=true};
  $('#deleteArticleBtn').onclick=async()=>{const a=currentArticle();if(!a||!confirm(`Delete “${a.title}”?`))return;deletedArticles[a.id]=Date.now();saveDeleted();await dbDelete(a.id);articles=articles.filter(x=>x.id!==a.id);currentId=null;$('#readerView').hidden=true;$('#emptyReader').hidden=false;$('#morePopover').hidden=true;renderAll();closeMobileArticle()};
  $('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:Date.now(),meta,settings,articles},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`reader-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
  $('#importInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());if(!Array.isArray(j.articles))throw 0;if(confirm(`Import ${j.articles.length} articles? Existing articles with the same IDs will be replaced.`)){for(const a of j.articles){if(a?.id)delete deletedArticles[a.id];await dbPut(a)}saveDeleted();if(j.meta){meta=j.meta;saveMeta()}if(j.settings){settings={...settings,...j.settings};saveSettings()}articles=await dbAll();applySettings();renderAll();toast('Backup imported')}}catch{toast('Could not read backup')}e.target.value=''};
  $('#mobileMenuBtn').onclick=()=>{$('#sidebar').classList.add('open');$('#backdrop').hidden=false};$('#backdrop').onclick=()=>{$('#sidebar').classList.remove('open');$('#backdrop').hidden=true};$('#mobileBackBtn').onclick=closeMobileArticle;
  window.addEventListener('resize',()=>{
    const w=window.innerWidth,h=window.innerHeight,shell=document.querySelector('.app-shell');
    if(shell&&(w>900||w<=680))shell.classList.remove('tablet-list-only');
    applyLayoutWidths();
    const widthChanged=Math.abs(w-lastViewportWidth)>6;
    const heightChanged=Math.abs(h-lastViewportHeight)>24;
    lastViewportWidth=w;lastViewportHeight=h;
    // iOS Safari repeatedly changes the viewport height while its browser chrome
    // expands/collapses. Repaginating on those height-only resizes makes the
    // current page visibly blink. On phone-sized layouts, repaginate only when
    // width changes (rotation / real layout change). Desktop still responds to
    // meaningful width or height resizing.
    if(w<=680&&!widthChanged)return;
    if(w>680&&!widthChanged&&!heightChanged)return;
    clearTimeout(resizeTimer);resizeTimer=setTimeout(paginate,140);
  });
}
init().catch(e=>{console.error(e);toast('Reader could not start')});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
