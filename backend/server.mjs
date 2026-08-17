import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8000);
const REQUEST_TIMEOUT = 10000;

// No API key is required. Providers are public, so the app rotates through them.
// Keep this list small and health-check each provider per request.
const INVIDIOUS = [
  'https://yt.omada.cafe',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://invidious.f5.si',
  'https://inv.zoomerville.com'
];
const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://api-piped.mha.fi',
  'https://piped-api.garudalinux.org'
];

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store'
};

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, {...headers, 'Content-Type': type});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function timeoutFetch(url, options={}) {
  return fetch(url, {...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT), headers:{'User-Agent':'OB-Tunes/2.0','Accept':'application/json', ...(options.headers||{})}});
}
async function jsonFetch(url) {
  const r = await timeoutFetch(url);
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let data; try { data=JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
  return data;
}
function thumb(id) { return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`; }
function normalizeInvidious(x) {
  const id=x.videoId;
  if (!id) return null;
  const t=x.videoThumbnails || [];
  return {title:x.title || 'Unknown title', videoId:id, artists:[{name:x.author || 'Unknown artist'}], thumbnails:t.length?t.map(v=>({url:v.url})): [{url:thumb(id)}], resultType:'song', duration:Number(x.lengthSeconds||0)};
}
function normalizePiped(x) {
  const id=x.url?.split('v=')[1]?.split('&')[0] || x.id || x.videoId;
  if (!id) return null;
  return {title:x.title || 'Unknown title', videoId:id, artists:[{name:x.uploaderName || x.uploader || 'Unknown artist'}], thumbnails:[{url:x.thumbnailUrl || thumb(id)}], resultType:'song', duration:Number(x.duration||0)};
}

async function searchInvidious(q) {
  for (const base of INVIDIOUS) {
    try {
      const data=await jsonFetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=relevance`);
      const results=Array.isArray(data)?data.map(normalizeInvidious).filter(Boolean):[];
      if (results.length) return {results, provider:'invidious', instance:base};
    } catch {}
  }
  throw new Error('All Invidious search instances failed');
}
async function searchPiped(q) {
  for (const base of PIPED) {
    try {
      const data=await jsonFetch(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`);
      const results=(data.items||[]).map(normalizePiped).filter(Boolean);
      if (results.length) return {results, provider:'piped', instance:base};
    } catch {}
  }
  throw new Error('All Piped search instances failed');
}
async function search(q) {
  try { return await searchPiped(q); } catch {}
  return await searchInvidious(q);
}
function audioScore(f) {
  const mime=String(f?.type||f?.mimeType||'').toLowerCase();
  const br=Number(f?.bitrate||f?.bitrateKbps||0);
  if (mime.includes('audio/mp4')) return 1000000+br;
  if (mime.includes('audio/webm')) return 900000+br;
  if (mime.startsWith('audio/')) return 800000+br;
  return 0;
}
async function streamInvidious(id) {
  for (const base of INVIDIOUS) {
    try {
      const data=await jsonFetch(`${base}/api/v1/videos/${encodeURIComponent(id)}`);
      const formats=[...(data.adaptiveFormats||[]), ...(data.formatStreams||[])].filter(x=>x.url || x.directUrl);
      const streamingUrls=formats.map(f=>({url:f.url||`${base}/latest_version?id=${encodeURIComponent(id)}&itag=${f.itag}`, directUrl:f.url||f.directUrl, bitrate:f.bitrate, type:f.type||f.mimeType, audioQuality:f.audioQuality, itag:String(f.itag||'')})).filter(x=>x.directUrl&&audioScore(x)>0).sort((a,b)=>audioScore(b)-audioScore(a));
      if (streamingUrls.length) return {success:true,service:'invidious',instance:base,streamingUrls,metadata:{id,title:data.title,author:data.author,thumbnail:data.videoThumbnails?.at(-1)?.url||thumb(id),lengthSeconds:data.lengthSeconds,viewCount:data.viewCount},requestedId:id,timestamp:new Date().toISOString()};
    } catch {}
  }
  throw new Error('No working Invidious instance returned an audio stream');
}
async function streamPiped(id) {
  for (const base of PIPED) {
    try {
      const data=await jsonFetch(`${base}/streams/${encodeURIComponent(id)}`);
      const formats=[...(data.audioStreams||[])].filter(x=>x.url);
      const streamingUrls=formats.map(f=>({url:f.url,directUrl:f.url,bitrate:Number(f.bitrate||0)*1000,type:f.mimeType||`audio/${f.codec||'webm'}`,audioQuality:f.quality,itag:String(f.itag||'')})).sort((a,b)=>audioScore(b)-audioScore(a));
      if (streamingUrls.length) return {success:true,service:'piped',instance:base,streamingUrls,metadata:{id,title:data.title,author:data.uploader,thumbnail:data.thumbnailUrl||thumb(id),lengthSeconds:data.duration},requestedId:id,timestamp:new Date().toISOString()};
    } catch {}
  }
  throw new Error('No working Piped instance returned an audio stream');
}
async function stream(id) {
  try { return await streamPiped(id); } catch {}
  return await streamInvidious(id);
}
function safePath(urlPath) {
  const decoded=decodeURIComponent(urlPath);
  const target=path.resolve(DIST, decoded.replace(/^\/+/,''));
  return target.startsWith(path.resolve(DIST)) ? target : null;
}
function serveStatic(req,res) {
  if (!fs.existsSync(DIST)) return send(res,404,{error:'Frontend not built. Run npm run build.'});
  let file=safePath(new URL(req.url,'http://localhost').pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(DIST,'index.html');
  if (!fs.existsSync(file)) return send(res,404,{error:'Frontend build missing.'});
  const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
  send(res,200,fs.readFileSync(file),types[ext]||'application/octet-stream');
}

const server=http.createServer(async (req,res)=>{
  try {
    if (req.method==='OPTIONS') return send(res,204,'','text/plain');
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if (u.pathname==='/api/health') return send(res,200,{ok:true,service:'OB Tunes combined API',providers:{invidious:INVIDIOUS.length,piped:PIPED.length},time:new Date().toISOString()});
    if (u.pathname==='/api/search') {
      const q=u.searchParams.get('q')?.trim()||'';
      if (!q) return send(res,200,{query:'',filter:'songs',results:[]});
      const out=await search(q); return send(res,200,{query:q,filter:'songs',results:out.results,provider:out.provider,instance:out.instance});
    }
    if (u.pathname==='/api/stream') {
      const id=u.searchParams.get('id')?.trim()||'';
      if (!id) return send(res,400,{success:false,error:'Missing id'});
      const out=await stream(id); return send(res,200,out);
    }
    if (req.method==='GET') return serveStatic(req,res);
    return send(res,404,{error:'Not found'});
  } catch (e) {
    send(res,502,{success:false,error:e?.message||'Music provider unavailable',timestamp:new Date().toISOString()});
  }
});
server.listen(PORT,()=>console.log(`OB Tunes API + web server listening on http://localhost:${PORT}`));
