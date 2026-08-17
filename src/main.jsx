import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
 Search, Home, Heart, ListMusic, Play, Pause, SkipBack, SkipForward,
 Shuffle, Repeat, Volume2, VolumeX, MoreHorizontal, X, ChevronDown,
 LoaderCircle, AlertCircle, Settings, Info, Shield, FileText, SlidersHorizontal,
 Moon, Sun, Smartphone, Monitor, Trash2, Check, ExternalLink, Clock3, Music2,
 ListPlus, Download, ChevronRight, RotateCcw
} from 'lucide-react';
import './styles.css';

const API_BASE=(import.meta.env.VITE_API_BASE||'').replace(/\/$/,'');
const SEARCH_CACHE=new Map();
const STORAGE={fav:'ob-favorites',queue:'ob-queue',settings:'ob-settings'};
const DEFAULT_SETTINGS={theme:'dark',autoplay:true,gapless:true,rememberVolume:true,showArtwork:true,reduceMotion:false};

function read(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}}
function imageFor(s){return s.thumbnail||s.artworkUrl600||s.artworkUrl||s.thumbnails?.at(-1)?.url||s.thumbnails?.[0]?.url||`https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`}
function normalizeSong(raw){
 const artist=Array.isArray(raw.artists)?raw.artists.map(a=>a?.name).filter(Boolean).join(', '):(raw.artistName||raw.author||'Unknown artist');
 return {id:raw.videoId||raw.id||raw.trackId,videoId:raw.videoId||raw.id||null,title:raw.title||raw.trackName||'Unknown title',artist:artist||'Unknown artist',album:raw.collectionName||raw.album?.name||'',artwork:imageFor(raw),duration:Number(raw.duration||raw.lengthSeconds||0),raw};
}
async function api(path){const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(`${API_BASE}${path}`,{signal:c.signal,headers:{Accept:'application/json'}});const txt=await r.text();let d;try{d=JSON.parse(txt)}catch{throw new Error(`API returned non-JSON (${r.status})`)}if(!r.ok)throw new Error(d?.error||`API error ${r.status}`);return d}finally{clearTimeout(t)}}
function fmt(sec){if(!Number.isFinite(sec)||sec<0)return '0:00';return `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`}

function App(){
 const audio=useRef(null), searchTimer=useRef(null);
 const [page,setPage]=useState('home'),[query,setQuery]=useState(''),[results,setResults]=useState([]),[discover,setDiscover]=useState([]);
 const [favorites,setFavorites]=useState(()=>read(STORAGE.fav,[])),[queue,setQueue]=useState(()=>read(STORAGE.queue,[]));
 const [settings,setSettings]=useState(()=>({...DEFAULT_SETTINGS,...read(STORAGE.settings,{})}));
 const [current,setCurrent]=useState(null),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[streamLoading,setStreamLoading]=useState(false);
 const [error,setError]=useState(''),[progress,setProgress]=useState(0),[duration,setDuration]=useState(0),[shuffle,setShuffle]=useState(false),[repeat,setRepeat]=useState(false);
 const [volume,setVolume]=useState(()=>read('ob-volume',0.9)),[playerOpen,setPlayerOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[legal,setLegal]=useState(null),[toast,setToast]=useState('');

 useEffect(()=>localStorage.setItem(STORAGE.fav,JSON.stringify(favorites)),[favorites]);
 useEffect(()=>localStorage.setItem(STORAGE.queue,JSON.stringify(queue)),[queue]);
 useEffect(()=>localStorage.setItem(STORAGE.settings,JSON.stringify(settings)),[settings]);
 useEffect(()=>{if(settings.rememberVolume)localStorage.setItem('ob-volume',String(volume))},[volume,settings.rememberVolume]);
 useEffect(()=>{document.documentElement.dataset.theme=settings.theme;document.documentElement.dataset.reduceMotion=settings.reduceMotion?'true':'false'},[settings]);
 useEffect(()=>{search('The Weeknd',true)},[]);
 useEffect(()=>{if(audio.current)audio.current.volume=volume},[volume]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2600);return()=>clearTimeout(t)},[toast]);

 async function search(q,initial=false){
  const term=q.trim();
  if(!term){setResults([]);return}
  const cacheKey=term.toLowerCase();
  const cached=SEARCH_CACHE.get(cacheKey);
  if(cached){initial?setDiscover(cached):setResults(cached);return}
  setLoading(true);setError('');
  try{
    let d;
    try{
      d=await api(`/api/search?q=${encodeURIComponent(term)}&filter=songs&fallback=0`);
    }catch(first){
      // Some upstreams reject the strict route temporarily. Retry once using the backend fallback path.
      d=await api(`/api/search?q=${encodeURIComponent(term)}&filter=songs&fallback=1`);
    }
    const songs=(d.results||[]).map(normalizeSong).filter(s=>s.videoId);
    SEARCH_CACHE.set(cacheKey,songs);
    initial?setDiscover(songs):setResults(songs);
    if(!songs.length && !initial)setError('No songs were returned for this search. Try another title or artist.');
  }catch(e){
    const message=e.name==='AbortError'?'Search timed out.':e.message||'Search failed';
    setError(`Music service unavailable: ${message}`);
    if(initial)setDiscover([]);
  }finally{setLoading(false)}
}
 function onQuery(v){setQuery(v);clearTimeout(searchTimer.current);if(!v.trim()){setResults([]);return}searchTimer.current=setTimeout(()=>search(v),320)}
 async function playSong(song){
  if(!song?.videoId)return;
  setCurrent(song);setPlayerOpen(true);setStreamLoading(true);setError('');setProgress(0);setDuration(song.duration||0);
  try{
    let d;
    try{d=await api(`/api/stream?id=${encodeURIComponent(song.videoId)}`)}
    catch(first){await new Promise(r=>setTimeout(r,350));d=await api(`/api/stream?id=${encodeURIComponent(song.videoId)}`)}
    const urls=Array.isArray(d.streamingUrls)?d.streamingUrls:[];
    const score=u=>/audio\/mp4/i.test(u?.type)?4:/audio\/webm/i.test(u?.type)?3:/audio\//i.test(u?.type)?2:0;
    const playable=urls.filter(u=>u?.directUrl&&score(u)>0).sort((a,b)=>score(b)-score(a))[0] || urls.find(u=>u?.directUrl);
    if(!playable)throw new Error(d.error||'No playable audio stream is currently available.');
    const el=audio.current;
    el.src=playable.directUrl;el.load();
    await el.play();setPlaying(true);
  }catch(e){setPlaying(false);setError(`Playback failed: ${e.message||'The selected stream is unavailable.'}`)}
  finally{setStreamLoading(false)}
}
 function togglePlay(){if(!audio.current||!current)return;playing?audio.current.pause():audio.current.play().then(()=>setPlaying(true)).catch(e=>setError(e.message))}
 function toggleFavorite(song){setFavorites(p=>p.some(x=>x.id===song.id)?p.filter(x=>x.id!==song.id):[song,...p]);setToast(favorites.some(x=>x.id===song.id)?'Removed from favorites':'Added to favorites')}
 function addQueue(song){if(!queue.some(x=>x.id===song.id)){setQueue(q=>[...q,song]);setToast('Added to queue')}}
 function removeQueue(id){setQueue(q=>q.filter(x=>x.id!==id))}
 function sourceList(){if(page==='favorites')return favorites;if(page==='queue')return queue;return results.length?results:discover}
 function nextSong(){let list=sourceList();if(!list.length)return;let i=current?list.findIndex(x=>x.id===current.id):-1;i=shuffle?Math.floor(Math.random()*list.length):(i+1)%list.length;playSong(list[i])}
 function prevSong(){let list=sourceList();if(!list.length)return;let i=current?list.findIndex(x=>x.id===current.id):0;i=(i-1+list.length)%list.length;playSong(list[i])}
 function ended(){if(repeat&&audio.current){audio.current.currentTime=0;audio.current.play();return}nextSong()}
 function updateSettings(patch){setSettings(s=>({...s,...patch}))}
 function clearData(){localStorage.removeItem(STORAGE.fav);localStorage.removeItem(STORAGE.queue);setFavorites([]);setQueue([]);setToast('Local library cleared')}
 const visible=sourceList();
 const title=page==='favorites'?'Favorites':page==='queue'?'Up next':results.length?`Results for “${query}”`:'Discover';
 return <div className="app">
  <header className="topbar"><button className="brand" onClick={()=>setPage('home')}><span className="brandMark"><Music2 size={17}/></span><span>OB Tunes</span></button>
   <div className="search"><Search size={18}/><input value={query} onChange={e=>onQuery(e.target.value)} placeholder="Search songs, artists..."/><kbd>⌘ K</kbd>{query&&<button onClick={()=>{setQuery('');setResults([])}}><X size={16}/></button>}</div>
   <button className="settingsBtn" onClick={()=>setSettingsOpen(true)} aria-label="Settings"><Settings size={19}/></button><span className="status"><i/> Online</span>
  </header>
  <main><aside className="sidebar"><p className="navLabel">LIBRARY</p><Nav icon={<Home/>} text="Home" active={page==='home'} click={()=>setPage('home')}/><Nav icon={<Heart/>} text="Favorites" active={page==='favorites'} count={favorites.length} click={()=>setPage('favorites')}/><Nav icon={<ListMusic/>} text="Queue" active={page==='queue'} count={queue.length} click={()=>setPage('queue')}/><div className="sideSpacer"/><p className="navLabel">APP</p><Nav icon={<Settings/>} text="Settings" click={()=>setSettingsOpen(true)}/><Nav icon={<Info/>} text="About" click={()=>setLegal('about')}/></aside>
   <section className="content"><div className="mobileNav"><button className={page==='home'?'on':''} onClick={()=>setPage('home')}><Home size={17}/>Home</button><button className={page==='favorites'?'on':''} onClick={()=>setPage('favorites')}><Heart size={17}/>Liked</button><button className={page==='queue'?'on':''} onClick={()=>setPage('queue')}><ListMusic size={17}/>Queue</button></div>
    <div className="hero"><div><p className="eyebrow">A SIMPLE MUSIC SPACE</p><h1>Play what<br/><span>feels right.</span></h1><p className="heroCopy">Search, save, queue and listen without getting in the way. Your library stays on this device.</p></div><div className="heroActions"><button className="outlineBtn" onClick={()=>setSettingsOpen(true)}><SlidersHorizontal size={16}/> Preferences</button>{current&&<button className="heroPlay" onClick={togglePlay}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button>}</div></div>
    <div className="sectionHead"><div><p className="eyebrow">{page==='home'?'DISCOVER':'YOUR LIBRARY'}</p><h2>{title}</h2></div>{loading&&<LoaderCircle className="spin" size={20}/>}</div>
    {error&&<div className="error"><AlertCircle size={18}/><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
    {visible.length?<div className="songList">{visible.map((song,i)=><SongRow key={song.id||i} song={song} current={current} playing={playing} favorite={favorites.some(x=>x.id===song.id)} queued={queue.some(x=>x.id===song.id)} onPlay={playSong} onFav={toggleFavorite} onQueue={addQueue}/>)}</div>:<div className="empty"><Music2 size={34}/><h3>{loading?'Searching…':page==='favorites'?'No favorites yet':page==='queue'?'Your queue is empty':'Nothing found'}</h3><p>{page==='home'?'Search for an artist or song to get started.':'Songs you add will appear here.'}</p></div>}
    <footer className="appFooter"><span>OB Tunes</span><button onClick={()=>setLegal('privacy')}>Privacy</button><button onClick={()=>setLegal('terms')}>Terms</button><button onClick={()=>setLegal('about')}>About</button><a href="https://bibekbista.vercel.app/" target="_blank" rel="noreferrer">Developer <ExternalLink size={12}/></a></footer>
   </section>
  </main>
  <audio ref={audio} onTimeUpdate={()=>{if(audio.current){setProgress(audio.current.currentTime);setDuration(audio.current.duration||current?.duration||0)}}} onLoadedMetadata={()=>setDuration(audio.current?.duration||current?.duration||0)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={ended}/>
  {current&&<Player current={current} playing={playing} loading={streamLoading} shuffle={shuffle} repeat={repeat} volume={volume} progress={progress} duration={duration} onOpen={()=>setPlayerOpen(true)} onToggle={togglePlay} onPrev={prevSong} onNext={nextSong} onShuffle={()=>setShuffle(x=>!x)} onRepeat={()=>setRepeat(x=>!x)} onVolume={setVolume} onSeek={v=>{audio.current.currentTime=v;setProgress(v)}}/>}
  {playerOpen&&current&&<FullPlayer current={current} playing={playing} loading={streamLoading} favorite={favorites.some(x=>x.id===current.id)} onClose={()=>setPlayerOpen(false)} onToggle={togglePlay} onPrev={prevSong} onNext={nextSong} onFav={()=>toggleFavorite(current)} onSeek={v=>{audio.current.currentTime=v;setProgress(v)}} progress={progress} duration={duration} shuffle={shuffle} repeat={repeat} onShuffle={()=>setShuffle(x=>!x)} onRepeat={()=>setRepeat(x=>!x)}/>} 
  {settingsOpen&&<SettingsModal settings={settings} update={updateSettings} volume={volume} setVolume={setVolume} clearData={clearData} close={()=>setSettingsOpen(false)} openLegal={setLegal}/>} 
  {legal&&<LegalModal type={legal} close={()=>setLegal(null)}/>} {toast&&<div className="toast"><Check size={15}/>{toast}</div>}
 </div>
}
function Nav({icon,text,active,count,click}){return <button className={active?'active':''} onClick={click}>{icon}<span>{text}</span>{count>0&&<em>{count}</em>}</button>}
function SongRow({song,current,playing,favorite,queued,onPlay,onFav,onQueue}){const active=current?.id===song.id;return <div className={`song ${active?'active':''}`}><button className="cover" onClick={()=>onPlay(song)}><img src={song.artwork} onError={e=>e.currentTarget.src=`https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}/><span>{active&&playing?<Pause fill="white" size={18}/>:<Play fill="white" size={18}/>}</span></button><button className="songInfo" onClick={()=>onPlay(song)}><b>{song.title}</b><span>{song.artist}</span></button><span className="album">{song.album||'—'}</span><button className={`iconBtn ${favorite?'liked':''}`} onClick={()=>onFav(song)} title="Favorite"><Heart size={18} fill={favorite?'currentColor':'none'}/></button><button className={`iconBtn ${queued?'liked':''}`} onClick={()=>onQueue(song)} title="Add to queue"><ListPlus size={18}/></button></div>}
function Player(p){return <div className="player show"><img src={p.current.artwork}/><button className="trackMeta" onClick={p.onOpen}><b>{p.current.title}</b><span>{p.current.artist}</span></button><div className="controls"><button onClick={p.onShuffle} className={p.shuffle?'on':''}><Shuffle size={17}/></button><button onClick={p.onPrev}><SkipBack size={19}/></button><button className="mainPlay" disabled={p.loading} onClick={p.onToggle}>{p.loading?<LoaderCircle className="spin"/>:p.playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button onClick={p.onNext}><SkipForward size={19}/></button><button onClick={p.onRepeat} className={p.repeat?'on':''}><Repeat size={17}/></button></div><div className="volume"><button onClick={()=>p.onVolume(p.volume?0:.9)}>{p.volume?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><input type="range" min="0" max="1" step=".01" value={p.volume} onChange={e=>p.onVolume(+e.target.value)}/></div><div className="progress"><div style={{width:`${p.duration?(p.progress/p.duration)*100:0}%`}}/><input aria-label="seek" type="range" min="0" max={p.duration||1} value={Math.min(p.progress,p.duration||1)} onChange={e=>p.onSeek(+e.target.value)}/></div></div>}
function FullPlayer({current,playing,loading,favorite,onClose,onToggle,onPrev,onNext,onFav,onSeek,progress,duration,shuffle,repeat,onShuffle,onRepeat}){return <div className="playerOverlay"><div className="fullPlayer"><button className="closeFull" onClick={onClose}><ChevronDown/></button><p className="eyebrow">NOW PLAYING</p><img className="fullArt" src={current.artwork}/><h2>{current.title}</h2><p>{current.artist}</p><div className="fullProgress"><input type="range" min="0" max={duration||1} value={Math.min(progress,duration||1)} onChange={e=>onSeek(+e.target.value)}/><div><span>{fmt(progress)}</span><span>{fmt(duration)}</span></div></div><div className="fullControls"><button onClick={onShuffle} className={shuffle?'on':''}><Shuffle/></button><button onClick={onPrev}><SkipBack/></button><button className="fullPlay" onClick={onToggle}>{loading?<LoaderCircle className="spin"/>:playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button onClick={onNext}><SkipForward/></button><button onClick={onRepeat} className={repeat?'on':''}><Repeat/></button></div><button className={`favoriteBig ${favorite?'on':''}`} onClick={onFav}><Heart size={19} fill={favorite?'currentColor':'none'}/> {favorite?'Liked':'Add to favorites'}</button></div></div>}
function SettingsModal({settings,update,volume,setVolume,clearData,close,openLegal}){return <Modal title="Settings" close={close}><div className="settingsSections"><SettingSection icon={<SlidersHorizontal/>} title="Playback"><Toggle label="Autoplay next track" value={settings.autoplay} set={v=>update({autoplay:v})}/><Toggle label="Gapless playback" value={settings.gapless} set={v=>update({gapless:v})}/><Toggle label="Remember volume" value={settings.rememberVolume} set={v=>update({rememberVolume:v})}/></SettingSection><SettingSection icon={<Monitor/>} title="Appearance"><div className="choiceRow"><span>Theme</span><div className="seg"><button className={settings.theme==='dark'?'sel':''} onClick={()=>update({theme:'dark'})}><Moon size={14}/>Dark</button><button className={settings.theme==='light'?'sel':''} onClick={()=>update({theme:'light'})}><Sun size={14}/>Light</button></div></div><Toggle label="Reduce motion" value={settings.reduceMotion} set={v=>update({reduceMotion:v})}/></SettingSection><SettingSection icon={<Volume2/>} title="Audio"><div className="rangeSetting"><span>Default volume</span><input type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(+e.target.value)}/><b>{Math.round(volume*100)}%</b></div></SettingSection><SettingSection icon={<Shield/>} title="Privacy & data"><p className="settingNote">Favorites, queue and preferences are stored locally in your browser. Searches and playback requests are sent to the configured OB Tunes backend.</p><button className="dangerBtn" onClick={clearData}><Trash2 size={15}/>Clear local library</button></SettingSection><SettingSection icon={<FileText/>} title="Legal"><button className="linkRow" onClick={()=>openLegal('privacy')}>Privacy Policy <ChevronRight/></button><button className="linkRow" onClick={()=>openLegal('terms')}>Terms & Conditions <ChevronRight/></button><button className="linkRow" onClick={()=>openLegal('about')}>About & Credits <ChevronRight/></button></SettingSection></div><div className="modalBottom"><button className="primaryBtn" onClick={close}>Done</button></div></Modal>}
function SettingSection({icon,title,children}){return <section className="settingSection"><div className="settingTitle">{icon}<h3>{title}</h3></div>{children}</section>}
function Toggle({label,value,set}){return <button className="toggleRow" onClick={()=>set(!value)}><span>{label}</span><i className={value?'checked':''}>{value?<Check size={12}/>:null}</i></button>}
function Modal({title,close,children}){return <div className="modalBackdrop"><div className="modal"><div className="modalHead"><h2>{title}</h2><button onClick={close}><X/></button></div>{children}</div></div>}
function LegalModal({type,close}){let content;if(type==='privacy')content=<><h2>Privacy Policy</h2><p>OB Tunes is designed to keep personal library data on your device. Favorites, queue items and app preferences are stored in local browser storage and are not intentionally uploaded by this client.</p><p>When you search or start playback, the app sends the requested query or track identifier to the OB Tunes backend configured by the deployment. The backend may contact third-party music/search/stream providers to fulfill those requests. Their handling of data is governed by their own policies.</p><p>OB Tunes does not ask for an account in this version. Do not enter passwords, payment details, or other sensitive information into search fields.</p><p>You can clear locally stored favorites, queue and preferences from Settings. Browser storage can also be cleared through your browser controls.</p><h3>Changes</h3><p>This policy may be updated as the app gains accounts, analytics, downloads, or other services. The version shown in the app is the current policy for this build.</p></>;else if(type==='terms')content=<><h2>Terms & Conditions</h2><p>By using OB Tunes, you agree to use the application lawfully and responsibly. The app is provided as a music discovery and playback interface and does not guarantee that every search result or stream will always be available.</p><p>Availability depends on third-party services, network conditions, regional restrictions, content availability, and provider changes. OB Tunes does not claim ownership of third-party music, artwork, trademarks, or recordings.</p><p>You are responsible for ensuring that your use of any content complies with applicable law and the rights of the relevant copyright holders. Do not use the app to bypass access controls, download restricted content, or infringe copyright.</p><p>The software is provided on an “as available” basis. Features may change, break, or be removed as upstream services change.</p><h3>Acceptable use</h3><p>Do not abuse the backend, overload providers, attempt unauthorized access, or use the service for unlawful activity.</p></>;else content=<><h2>About OB Tunes</h2><p>A lightweight music web app focused on search, playback, favorites and queue management. This build uses the OB Tunes backend to resolve searchable tracks and available audio streams.</p><div className="aboutCard"><div className="devAvatar">BB</div><div><b>Developed by Bibek Bista</b><span>Student Developer · Full-Stack · Cybersecurity Learner</span><a href="https://bibekbista.vercel.app/" target="_blank" rel="noreferrer">Visit portfolio <ExternalLink size={13}/></a></div></div><p className="legalSmall">Third-party names, artwork and music remain the property of their respective owners. OB Tunes is not affiliated with YouTube, YouTube Music, Invidious, Piped, or the artists and labels whose content may appear in search results.</p><h3>Credits & notices</h3><p>This client is open about its dependency on external providers: when providers stop returning a stream, playback can become temporarily unavailable. No guarantee of catalog completeness is made.</p></>;return <div className="modalBackdrop"><div className="modal legalModal"><div className="modalHead"><span className="eyebrow">OB TUNES · {type.toUpperCase()}</span><button onClick={close}><X/></button></div><div className="legalBody">{content}</div></div></div>}

createRoot(document.getElementById('root')).render(<App/>);
