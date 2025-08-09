// DIY Motion v5 – Inbox + Auto-Replan + Drag&Drop + Priority colors + Hard deadlines
const $ = (sel) => document.querySelector(sel);
let deferredPrompt;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#installBtn');
  if (btn) btn.hidden = false;
});
$('#installBtn')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBtn').hidden = true;
});

const KEYS = { TASKS: 'dm_tasks', SETTINGS: 'dm_settings', EVENTS: 'dm_events', BUSY: 'dm_busy', CAL: 'dm_cal_state', AUTOREPLAN:'dm_auto' };
const read = (k, def) => JSON.parse(localStorage.getItem(k) || JSON.stringify(def));
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function uuid(){ try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2); } }
function pad(n){ return (n<10?'0':'') + n; }
function fmtDate(d){ return new Date(d).toLocaleString([],{ dateStyle:'medium', timeStyle:'short'}); }
function toMinutes(hhmm){ const [h,m] = hhmm.split(':').map(Number); return h*60 + m; }

// Calendar state
let calState = read(KEYS.CAL, null) || { view: 'day', date: new Date().toISOString(), showBusy: true };
function saveCal(){ write(KEYS.CAL, { view: calState.view, date: calState.date, showBusy: calState.showBusy }); }

// Auto replan toggle
const autoDefault = read(KEYS.AUTOREPLAN, false);
$('#autoReplan').checked = !!autoDefault;
let autoTimer = null;
function setAutoReplan(on){
  write(KEYS.AUTOREPLAN, !!on);
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (on){
    autoTimer = setInterval(async ()=>{
      // Re-sync Google (if initialized) and replan
      if (gapi.client?.calendar) await listGoogleEvents(true);
    }, 5*60*1000); // every 5 min
  }
}
$('#autoReplan').addEventListener('change', (e)=> setAutoReplan(e.target.checked));
setAutoReplan(!!autoDefault);

// Settings
function loadSettingsUI(){
  const s = read(KEYS.SETTINGS, {});
  if (!s.workStart) s.workStart='09:00';
  if (!s.workEnd) s.workEnd='18:00';
  if (!s.breakStart) s.breakStart='12:00';
  if (!s.breakEnd) s.breakEnd='13:00';
  if (!s.maxBlock) s.maxBlock=50;
  if (!s.buffer) s.buffer=10;
  if (!s.horizon) s.horizon=14;
  if (!s.weekends) s.weekends='no';
  write(KEYS.SETTINGS, s);
  $('#workStart')?.value = s.workStart;
  $('#workEnd')?.value = s.workEnd;
  $('#breakStart')?.value = s.breakStart;
  $('#breakEnd')?.value = s.breakEnd;
  $('#maxBlock')?.value = s.maxBlock;
  $('#buffer')?.value = s.buffer;
  $('#horizon')?.value = s.horizon;
  $('#weekends')?.value = s.weekends;
}
function saveSettingsFromUI(){
  write(KEYS.SETTINGS, {
    workStart: $('#workStart')?.value || '09:00',
    workEnd: $('#workEnd')?.value || '18:00',
    breakStart: $('#breakStart')?.value || '12:00',
    breakEnd: $('#breakEnd')?.value || '13:00',
    maxBlock: parseInt($('#maxBlock')?.value||'50',10),
    buffer: parseInt($('#buffer')?.value||'10',10),
    horizon: parseInt($('#horizon')?.value||'14',10),
    weekends: $('#weekends')?.value || 'no'
  });
}

// Options for dependencies
function refreshDependencyOptions(){
  const tasks = read(KEYS.TASKS, []);
  const busy = read(KEYS.BUSY, []);
  const after = $('#afterSelect'); const before = $('#beforeSelect');
  if (!after || !before) return;
  function opt(label, value){ const o=document.createElement('option'); o.textContent=label; o.value=value; return o; }
  after.innerHTML=''; before.innerHTML='';
  const ogT1 = document.createElement('optgroup'); ogT1.label='Tasks';
  const ogT2 = document.createElement('optgroup'); ogT2.label='Tasks';
  tasks.forEach(t=>{
    ogT1.appendChild(opt('Task: '+t.title, 'task:'+t.id));
    ogT2.appendChild(opt('Task: '+t.title, 'task:'+t.id));
  });
  const ogB1 = document.createElement('optgroup'); ogB1.label='Kalender';
  const ogB2 = document.createElement('optgroup'); ogB2.label='Kalender';
  busy.forEach(b=>{
    const s=new Date(b.startISO), e=new Date(b.endISO);
    const label=`${b.title||'Kalender'} (${s.toLocaleDateString()} ${pad(s.getHours())}:${pad(s.getMinutes())}-${pad(e.getHours())}:${pad(e.getMinutes())})`;
    ogB1.appendChild(opt(label, 'busy:'+b.id));
    ogB2.appendChild(opt(label, 'busy:'+b.id));
  });
  after.appendChild(ogT1); after.appendChild(ogB1);
  before.appendChild(ogT2); before.appendChild(ogB2);
}

// Tasks UI (Inbox + slider)
function renderTasks(){
  const wrap = $('#tasks');
  const tasks = read(KEYS.TASKS, []);
  if (!tasks.length){ wrap.innerHTML = '<p class="muted">Noch keine Aufgaben.</p>'; return; }
  wrap.innerHTML = '';
  tasks.sort((a,b)=>{
    // Inbox first
    if (!!a.active !== !!b.active) return a.active ? 1 : -1;
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (ad!==bd) return ad-bd;
    return (b.priority||3) - (a.priority||3);
  });
  const byId = Object.fromEntries(tasks.map(t=>[t.id, t]));
  tasks.forEach(t => {
    const el = document.createElement('div');
    el.className = 'task';
    const afterL = (t.after||[]).map(x=> x.startsWith('task:') ? (byId[x.split(':')[1]]?.title||'Task') : 'Kalender').join(', ');
    const beforeL = (t.before||[]).map(x=> x.startsWith('task:') ? (byId[x.split(':')[1]]?.title||'Task') : 'Kalender').join(', ');
    const warn = t.hardDeadline && t.deadline && new Date(t.deadline) < new Date() ? ' <span class="crit">• überfällig</span>' : '';
    el.innerHTML = `<div>
        <div><strong>${t.title}</strong> ${t.active?'<span class="pill">aktiv</span>':'<span class="pill">Inbox</span>'} ${(t.unscheduled?'<span class="pill warn">nicht eingeplant</span>':'')}${warn}</div>
        <div class="muted">Dauer: ${t.duration} Min · Prio ${t.priority}${t.deadline ? ' · DL: '+fmtDate(t.deadline):''}${t.hardDeadline?' (hart)':''}</div>
        ${(t.after?.length||t.before?.length) ? `<div class="muted">Abh.: ${t.after?.length?('nach '+afterL):''}${(t.after?.length&&t.before?.length)?' · ':''}${t.before?.length?('vor '+beforeL):''}</div>`:''}
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <label class="switchrow muted"><input type="checkbox" class="actSwitch" data-id="${t.id}" ${t.active?'checked':''}> aktiv</label>
        <button data-id="${t.id}" class="secondary del">Löschen</button>
      </div>`;
    wrap.appendChild(el);
  });
  wrap.querySelectorAll('.del').forEach(btn=>btn.addEventListener('click', (e)=>{
    const id = e.currentTarget.getAttribute('data-id');
    const next = read(KEYS.TASKS, []).filter(x=>x.id!==id);
    // remove planned events for this task
    const evs = read(KEYS.EVENTS, []).filter(ev=>ev.taskId!==id);
    write(KEYS.TASKS, next); write(KEYS.EVENTS, evs);
    renderTasks(); refreshDependencyOptions(); renderCalendar(); renderSchedule();
  }));
  wrap.querySelectorAll('.actSwitch').forEach(sw=>sw.addEventListener('change', (e)=>{
    const id = e.currentTarget.getAttribute('data-id');
    const tasks = read(KEYS.TASKS, []);
    const t = tasks.find(x=>x.id===id);
    if (!t) return;
    t.active = e.currentTarget.checked;
    // turning off: remove its events
    if (!t.active){
      const remain = read(KEYS.EVENTS, []).filter(ev=>ev.taskId!==id);
      write(KEYS.EVENTS, remain);
      t.unscheduled = true;
    }
    write(KEYS.TASKS, tasks);
    renderTasks();
    if (t.active){ plan(); } else { renderCalendar(); renderSchedule(); }
  }));
}

$('#addTask').addEventListener('click', () => {
  const title = $('#title').value.trim();
  const dur = parseInt($('#duration').value,10);
  const deadline = $('#deadline').value || null;
  const hardDeadline = $('#hardDeadline').checked;
  const priority = parseInt($('#priority').value,10);
  const after = Array.from($('#afterSelect').selectedOptions).map(o=>o.value);
  const before = Array.from($('#beforeSelect').selectedOptions).map(o=>o.value);
  if (!title || !dur || dur<=0) { alert('Bitte Titel & Dauer prüfen.'); return; }
  const tasks = read(KEYS.TASKS, []);
  tasks.push({ id: uuid(), title, duration: dur, deadline, hardDeadline, priority, after, before, active: false, remaining: dur, unscheduled: true });
  write(KEYS.TASKS, tasks);
  $('#title').value=''; $('#duration').value = 60; $('#deadline').value=''; $('#priority').value='3'; $('#hardDeadline').checked=false;
  $('#afterSelect').selectedIndex=-1; $('#beforeSelect').selectedIndex=-1;
  renderTasks(); refreshDependencyOptions();
});

// Busy (Calendar) Handling
function summarizeBusy(){
  const busy = read(KEYS.BUSY, []);
  $('#busyInfo').textContent = `Busy: ${busy.length}`;
  const now = new Date();
  const horizon = 3;
  const days = [];
  for (let i=0;i<horizon;i++){
    const d = new Date(now); d.setDate(now.getDate()+i);
    const dayStr = d.toDateString();
    const list = busy.filter(ev => new Date(ev.startISO).toDateString()===dayStr);
    days.push({day: dayStr, count: list.length});
  }
  $('#busyPreview').innerHTML = days.map(x => `${x.day}: ${x.count} Ereignisse`).join('<br>');
}
function addBusyEvents(events){
  const existing = read(KEYS.BUSY, []);
  const merged = existing.concat(events.map(e=>({...e, id: e.id || uuid()})));
  write(KEYS.BUSY, merged);
  summarizeBusy(); refreshDependencyOptions(); renderCalendar();
}

$('#icsFile').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const events = parseICS(text).map(x => ({...x, source: 'ics:'+file.name}));
  addBusyEvents(events);
  if (read(KEYS.AUTOREPLAN,false)) plan();
});

function parseICS(text){
  const lines = text.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (let raw of lines){
    const line = raw.trim();
    if (line==='BEGIN:VEVENT'){ cur = {}; continue; }
    if (line==='END:VEVENT'){ 
      if (cur.DTSTART && cur.DTEND){
        const s = parseICSDate(cur.DTSTART);
        const e = parseICSDate(cur.DTEND);
        if (s && e) events.push({ id: uuid(), title: cur.SUMMARY || 'Kalender', startISO: s.toISOString(), endISO: e.toISOString() });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx+1);
    const baseKey = key.split(';')[0];
    cur[baseKey] = val;
    if (baseKey==='SUMMARY'){ cur.SUMMARY = val; }
  }
  return events;
}
function parseICSDate(v){
  let value = v;
  const tzIdx = v.indexOf(':');
  if (tzIdx !== -1 && v.includes('TZID=')){
    value = v.slice(tzIdx+1);
  }
  if (/Z$/.test(value)){
    return new Date(value);
  } else {
    const s = value.replace(/-/g,'').replace(/:/g,'');
    const y = parseInt(s.slice(0,4),10);
    const m = parseInt(s.slice(4,6),10)-1;
    const d = parseInt(s.slice(6,8),10);
    const hh = parseInt(s.slice(9,11)||'0',10);
    const mm = parseInt(s.slice(11,13)||'0',10);
    const ss = parseInt(s.slice(13,15)||'0',10);
    return new Date(y,m,d,hh,mm,ss);
  }
}

// Google Calendar (read-only, optional)
const GOOGLE_CONFIG = {
  clientId: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
  apiKey: 'YOUR_GOOGLE_API_KEY',
  discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
  scope: 'https://www.googleapis.com/auth/calendar.readonly'
};
let gisTokenClient = null;
$('#gcAuth').addEventListener('click', initGoogleAuth);
$('#gcSync').addEventListener('click', ()=>listGoogleEvents(false));

function initGoogleAuth(){
  Promise.all([waitForGapi(), waitForGIS()]).then(async ()=>{
    gapi.load('client', async ()=>{
      try{
        await gapi.client.init({ apiKey: GOOGLE_CONFIG.apiKey, discoveryDocs: GOOGLE_CONFIG.discoveryDocs });
        gisTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CONFIG.clientId,
          scope: GOOGLE_CONFIG.scope,
          callback: async (resp)=>{
            if (resp.error) { console.error(resp); alert('Google Login fehlgeschlagen.'); return; }
            await listGoogleEvents(false);
          }
        });
        gisTokenClient.requestAccessToken({prompt: 'consent'});
      }catch(err){
        console.error(err);
        alert('Google Init fehlgeschlagen. Bitte CLIENT_ID/API_KEY in app.js setzen.');
      }
    });
  });
}
async function listGoogleEvents(silent){
  if (!gapi.client?.calendar){ 
    if (!silent) initGoogleAuth();
    return;
  }
  try{
    const settings = read(KEYS.SETTINGS, {});
    const horizon = settings.horizon || 14;
    const timeMin = new Date(); timeMin.setSeconds(0,0);
    const timeMax = new Date(timeMin); timeMax.setDate(timeMax.getDate()+horizon);
    const resp = await gapi.client.calendar.events.list({
      calendarId: 'primary', singleEvents: true, orderBy: 'startTime',
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), showDeleted: false
    });
    const items = resp.result.items || [];
    const events = items.filter(x=>x.status!=='cancelled').map(ev => {
      const s = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date + 'T00:00:00');
      const e = ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(ev.end.date + 'T23:59:59');
      return { id: uuid(), title: ev.summary || 'Kalender', startISO: s.toISOString(), endISO: e.toISOString(), source: 'google' };
    });
    const existing = read(KEYS.BUSY, []);
    const others = existing.filter(x=>x.source!=='google');
    write(KEYS.BUSY, others.concat(events));
    summarizeBusy(); refreshDependencyOptions(); renderCalendar();
    if (!silent) alert(`Google: ${events.length} Busy-Ereignisse geladen.`);
    if (read(KEYS.AUTOREPLAN,false)) plan(); // auto-replan after sync
  }catch(err){
    console.error(err);
    if (!silent) alert('Google Sync fehlgeschlagen. Prüfe Berechtigungen & Keys.');
  }
}
function waitForGapi(){ return new Promise(res=>{ if (window.gapi) return res(); const iv = setInterval(()=>{ if (window.gapi){ clearInterval(iv); res(); } }, 100); });}
function waitForGIS(){ return new Promise(res=>{ if (window.google && window.google.accounts) return res(); const iv = setInterval(()=>{ if (window.google && window.google.accounts){ clearInterval(iv); res(); } }, 100); });}

// Scheduling with precedence + hard deadlines + 'locked' events
function plan(){
  saveSettingsFromUI();
  const s = read(KEYS.SETTINGS, {});
  let tasks = read(KEYS.TASKS, [])
    .filter(t=>t.active) // only active tasks planned
    .map(t=>({...t, remaining: (t.remaining ?? t.duration)}));
  if (!tasks.length){ renderCalendar(); renderSchedule(); return; }

  // Keep locked events (manual drags) and block their times
  const locked = read(KEYS.EVENTS, []).filter(e=>e.locked);
  // Remove all auto events; we'll recompute
  write(KEYS.EVENTS, locked.slice());

  // Build graph edges for tasks (after/before on tasks)
  const idToTask = Object.fromEntries(tasks.map(t=>[t.id, t]));
  const edges = {}; const indeg = {}; tasks.forEach(t=>{ edges[t.id]=[]; indeg[t.id]=0; });
  tasks.forEach(t=>{
    (t.after||[]).forEach(tag=>{ if (tag.startsWith('task:')){ const a=tag.split(':')[1]; if (edges[a]){ edges[a].push(t.id); indeg[t.id]++; } } });
    (t.before||[]).forEach(tag=>{ if (tag.startsWith('task:')){ const b=tag.split(':')[1]; if (edges[t.id]){ edges[t.id].push(b); indeg[b]++; } } });
  });
  const q = tasks.filter(t=>indeg[t.id]===0).map(t=>t.id);
  const orderedIds = [];
  while(q.length){ const x=q.shift(); orderedIds.push(x); for(const y of edges[x]){ indeg[y]--; if (indeg[y]===0) q.push(y); } }
  if (orderedIds.length !== tasks.length){
    alert('Abhängigkeits-Zyklus entdeckt. Bitte prüfe die „vor/nach“-Einstellungen.');
    return;
  }
  tasks = orderedIds.map(id=>idToTask[id]);

  const horizonDays = s.horizon || 14;
  const maxBlock = s.maxBlock || 50;
  const buffer = s.buffer || 10;

  const events = read(KEYS.EVENTS, []); // currently only locked
  const today = new Date(); today.setSeconds(0,0);

  // Busy + locked-as-busy by day
  const busy = read(KEYS.BUSY, []).concat(events.map(e=>({startISO:e.startISO, endISO:e.endISO, title: 'Task (fixiert)'})));
  const busyByDay = {};
  for (const b of busy){
    const start = new Date(b.startISO);
    const end = new Date(b.endISO);
    for (let d=0; d<horizonDays; d++){
      const day = new Date(today); day.setDate(today.getDate()+d);
      const dayStr = day.toDateString();
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0,0,0,0);
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23,59,59,999);
      if (end < dayStart || start > dayEnd) continue;
      const st = new Date(Math.max(start, dayStart));
      const en = new Date(Math.min(end, dayEnd));
      if (st < en){
        if (!busyByDay[dayStr]) busyByDay[dayStr] = [];
        busyByDay[dayStr].push([st, en]);
      }
    }
  }
  for (const k of Object.keys(busyByDay)){ busyByDay[k] = mergeIntervals(busyByDay[k]); }

  function lastEventEndForTask(taskId, evts){
    const list = evts.filter(e=>e.taskId===taskId);
    if (!list.length) return null;
    return new Date(Math.max(...list.map(x=>new Date(x.endISO).getTime())));
  }
  function firstEventStartForTask(taskId, evts){
    const list = evts.filter(e=>e.taskId===taskId);
    if (!list.length) return null;
    return new Date(Math.min(...list.map(x=>new Date(x.startISO).getTime())));
  }

  function earliestAfterConstraints(t, day){
    const afterBusy = (t.after||[]).filter(x=>x.startsWith('busy:')).map(x=>x.split(':')[1]);
    let ea = new Date(day); ea.setHours(0,0,0,0);
    const busyAll = read(KEYS.BUSY, []);
    for (const b of busyAll){
      if (afterBusy.includes(b.id)){
        const end = new Date(b.endISO);
        if (end > ea) ea = end;
      }
    }
    for (const a of (t.after||[])){
      if (a.startsWith('task:')){
        const at = idToTask[a.split(':')[1]];
        const last = lastEventEndForTask(at?.id, events);
        if (last && last > ea) ea = last;
      }
    }
    return ea;
  }
  function latestBeforeConstraints(t){
    const beforeBusy = (t.before||[]).filter(x=>x.startsWith('busy:')).map(x=>x.split(':')[1]);
    let lf = t.hardDeadline && t.deadline ? new Date(t.deadline) : null; // hard deadline caps latest finish
    const busyAll = read(KEYS.BUSY, []);
    for (const b of busyAll){
      if (beforeBusy.includes(b.id)){
        const st = new Date(b.startISO);
        lf = lf ? (st < lf ? st : lf) : st;
      }
    }
    for (const a of (t.before||[])){
      if (a.startsWith('task:')){
        const bt = idToTask[a.split(':')[1]];
        const first = firstEventStartForTask(bt?.id, events);
        lf = (lf && first) ? (first<lf?first:lf) : (lf||first||null);
      }
    }
    return lf;
  }

  // plan per task
  for (let tIndex=0; tIndex<tasks.length; tIndex++){
    const t = tasks[tIndex];
    let remaining = t.remaining;

    for (let d=0; d<horizonDays && remaining>0; d++){
      const day = new Date(today); day.setDate(today.getDate()+d);
      const wd = day.getDay();
      if (s.weekends!=='yes' && (wd===0 || wd===6)) continue;

      const startMin = toMinutes(s.workStart || '09:00');
      const endMin = toMinutes(s.workEnd || '18:00');
      const bS = toMinutes(s.breakStart || '12:00');
      const bE = toMinutes(s.breakEnd || '13:00');

      let slots = [];
      function pushSlot(a,b){ if (b>a) slots.push([a,b]); }
      pushSlot(startMin, Math.min(bS, endMin));
      pushSlot(Math.max(bE, startMin), endMin);

      const dayStr = day.toDateString();
      const dayBusy = (busyByDay[dayStr] || []).map(([sdt, edt])=>[sdt.getHours()*60 + sdt.getMinutes(), edt.getHours()*60 + edt.getMinutes()]);
      slots = subtractBusy(slots, dayBusy);

      const isToday = new Date().toDateString() === day.toDateString();
      if (isToday){
        const now = new Date();
        const curMin = now.getHours()*60 + now.getMinutes();
        slots = slots.map(([a,b]) => [Math.max(a, curMin + 5), b]).filter(([a,b])=>b>a);
      }

      const ea = earliestAfterConstraints(t, day);
      const lf = latestBeforeConstraints(t);
      const eaMin = ea > day ? (ea.getHours()*60 + ea.getMinutes()) : 0;
      const lfMin = lf && lf.toDateString()===day.toDateString() ? (lf.getHours()*60 + lf.getMinutes()) : null;

      slots = slots.map(([a,b])=>[Math.max(a, eaMin), b]).filter(([a,b])=>b>a);
      if (lfMin!==null){
        slots = slots.map(([a,b])=>[a, Math.min(b, lfMin)]).filter(([a,b])=>b>a);
      }

      for (let sIdx=0; sIdx<slots.length && remaining>0; sIdx++){
        let [slotA, slotB] = slots[sIdx];
        let cursor = slotA;

        while (cursor < slotB && remaining>0){
          const free = slotB - cursor;
          if (free <= 0) break;
          const block = Math.min(maxBlock, remaining, free);
          const start = minutesToDate(day, cursor);
          const end = minutesToDate(day, cursor + block);

          // If hard deadline exists as absolute time and end exceeds it, cap
          if (t.hardDeadline && t.deadline){
            const ddl = new Date(t.deadline);
            if (end > ddl){
              // try to shrink within deadline window
              if (start >= ddl) { cursor = slotB; break; }
              const allowed = Math.floor((ddl - start)/60000);
              if (allowed <= 0) { cursor = slotB; break; }
              const blk2 = Math.min(block, allowed);
              events.push(newEvent(t, start, minutesToDate(day, cursor + blk2)));
              remaining -= blk2;
              cursor += blk2 + buffer;
              continue;
            }
          }

          events.push(newEvent(t, start, end));
          remaining -= block;
          cursor += block + buffer;
        }
      }
    }

    t.unscheduled = remaining>0;
    t.remaining = remaining;
  }

  // Save tasks and events
  const allTasks = read(KEYS.TASKS, []);
  const byId = Object.fromEntries(allTasks.map(x=>[x.id,x]));
  for (const t of tasks){ if (byId[t.id]) byId[t.id] = { ...byId[t.id], unscheduled: t.unscheduled, remaining: t.remaining }; }
  write(KEYS.TASKS, Object.values(byId));
  write(KEYS.EVENTS, events);
  renderTasks(); renderSchedule(); renderCalendar();
}

function newEvent(t, start, end){
  return { id: uuid(), taskId: t.id, title: t.title, startISO: start.toISOString(), endISO: end.toISOString(), meta: { priority: t.priority||3 }, locked:false };
}

function minutesToDate(day, minutes){
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  const h = Math.floor(minutes/60), min = minutes%60;
  return new Date(y, m, d, h, min, 0, 0);
}
function mergeIntervals(arr){
  if (!arr.length) return [];
  const a = arr.slice().sort((x,y)=> x[0]-y[0]);
  const res = [a[0]];
  for (let i=1;i<a.length;i++){
    const [s,e] = a[i];
    const last = res[res.length-1];
    if (s <= last[1]){ if (e > last[1]) last[1] = e; }
    else res.push([s,e]);
  }
  return res;
}
function subtractBusy(slots, busy){
  if (!busy.length) return slots;
  busy.sort((u,v)=>u[0]-v[0]);
  const merged = [];
  for (const it of busy){
    if (!merged.length || it[0] > merged[merged.length-1][1]) merged.push(it.slice());
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], it[1]);
  }
  let res = [];
  for (const [a,b] of slots){
    let curStart = a;
    for (const [x,y] of merged){
      if (y <= curStart || x >= b) continue;
      if (x > curStart) res.push([curStart, Math.min(x,b)]);
      curStart = Math.max(curStart, y);
      if (curStart >= b) break;
    }
    if (curStart < b) res.push([curStart,b]);
  }
  return res;
}

// Text schedule
function renderSchedule(){
  const container = $('#schedule');
  const events = read(KEYS.EVENTS, []);
  if (!events.length){ container.innerHTML = '<p class="muted">Noch kein Plan. Aktiviere Tasks (Slider) und klicke „Jetzt einplanen“.</p>'; return; }
  const byDay = {};
  for (const ev of events){
    const day = new Date(ev.startISO).toDateString();
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(ev);
  }
  Object.values(byDay).forEach(arr=>arr.sort((a,b)=>new Date(a.startISO)-new Date(b.startISO)));
  container.innerHTML = '';
  Object.keys(byDay).sort((a,b)=> new Date(a) - new Date(b)).forEach(day => {
    const sec = document.createElement('div');
    sec.style.borderLeft = '3px solid #1e3a8a';
    sec.style.paddingLeft = '12px';
    sec.style.marginTop = '8px';
    sec.innerHTML = `<h3 style="margin:6px 0">${day}</h3>`;
    byDay[day].forEach(ev => {
      const s = new Date(ev.startISO), e = new Date(ev.endISO);
      const tm = `${pad(s.getHours())}:${pad(s.getMinutes())} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
      const el = document.createElement('div');
      el.style.padding = '8px'; el.style.border = '1px solid #334155'; el.style.borderRadius = '10px'; el.style.margin = '6px 0';
      el.innerHTML = `<div><strong>${ev.title}</strong> ${ev.locked?'<span class="pill">fixiert</span>':''}</div><div class="muted">${tm}</div>`;
      sec.appendChild(el);
    });
    container.appendChild(sec);
  });
}

// Calendar view (day/week) + backlog chips + drag&drop
const HOUR_HEIGHT = 60; const DAY_START = 0; const DAY_END = 24;

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d){
  const x = startOfDay(d);
  const day = x.getDay(); const diff = (day===0 ? -6 : 1 - day); x.setDate(x.getDate()+diff); return x;
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function minutesFromStart(d){ return d.getHours()*60 + d.getMinutes(); }

function renderCalendar(){
  const stateDate = new Date(calState.date);
  const view = calState.view;
  const showBusy = calState.showBusy;
  $('#toggleBusy').checked = !!showBusy;

  const hoursEl = $('#hours'); hoursEl.innerHTML = '';
  for (let h=DAY_START; h<DAY_END; h++){ const hour = document.createElement('div'); hour.style.height = HOUR_HEIGHT + 'px'; hour.textContent = pad(h)+':00'; hoursEl.appendChild(hour); }

  const colsEl = $('#cols'); const calEl = $('#calendar'); const weekdayRow = $('#weekday'); const backlogEl = $('#backlog');
  colsEl.innerHTML = ''; backlogEl.innerHTML = '';
  const events = read(KEYS.EVENTS, []);
  const busy = read(KEYS.BUSY, []);
  const tasks = read(KEYS.TASKS, []);
  const unscheduled = tasks.filter(t=>t.active && t.unscheduled);

  document.querySelectorAll('.gridline').forEach(n=>n.remove());
  for (let h=1; h<DAY_END; h++){ const gl = document.createElement('div'); gl.className = 'gridline'; gl.style.top = (h * HOUR_HEIGHT) + 'px'; $('#calendar').appendChild(gl); }

  if (view==='day'){
    unscheduled.slice(0,12).forEach(t=>{ const c=document.createElement('span'); c.className='chip'; c.textContent = t.title + ` • ${t.duration}m`; backlogEl.appendChild(c); });
    if (unscheduled.length>12){ const more=document.createElement('span'); more.className='chip'; more.textContent = `+${unscheduled.length-12} weitere`; backlogEl.appendChild(more); }
  }

  if (view==='day'){
    weekdayRow.style.display = 'none'; calEl.className = 'cal-day'; colsEl.className = 'cols day';
    $('#kTitle').textContent = stateDate.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'short', year:'numeric' });
    const col = document.createElement('div'); col.className = 'col'; col.style.height = (HOUR_HEIGHT*(DAY_END-DAY_START)) + 'px'; colsEl.appendChild(col);
    placeEventsInCol(col, events, stateDate, showBusy ? busy : []);
  } else {
    weekdayRow.style.display = 'grid'; const weekStart = startOfWeek(stateDate); const weekEnd = addDays(weekStart, 6);
    $('#kTitle').textContent = `${weekStart.toLocaleDateString(undefined,{day:'2-digit',month:'short'})} – ${weekEnd.toLocaleDateString(undefined,{day:'2-digit',month:'short', year:'numeric'})}`;
    const names = ['Mo','Di','Mi','Do','Fr','Sa','So']; weekdayRow.innerHTML = `<div class="sp">Zeit</div>`;
    for (let i=0;i<7;i++){ const d = addDays(weekStart, i); weekdayRow.innerHTML += `<div>${names[i]} ${d.getDate()}.${d.getMonth()+1}.</div>`; }
    calEl.className = 'cal-week'; colsEl.className = 'cols week';
    for (let i=0;i<7;i++){ const col = document.createElement('div'); col.className = 'col'; col.style.height = (HOUR_HEIGHT*(DAY_END-DAY_START)) + 'px'; colsEl.appendChild(col); const day = addDays(weekStart, i); placeEventsInCol(col, events, day, showBusy ? busy : []); }
  }
}

function placeEventsInCol(col, events, day, busy){
  const d0 = startOfDay(day), d1 = addDays(d0, 1);
  const dayEvents = events.filter(ev => { const s = new Date(ev.startISO), e = new Date(ev.endISO); return e > d0 && s < d1; });
  const dayBusy = busy.filter(ev => { const s = new Date(ev.startISO), e = new Date(ev.endISO); return e > d0 && s < d1; });

  const items = dayEvents.map(ev => ({ 
    type:'plan', s: new Date(ev.startISO), e: new Date(ev.endISO), title: ev.title, prio:(ev.meta?.priority||3), id:ev.id, locked:!!ev.locked 
  }));
  const bitems = dayBusy.map(ev => ({ type:'busy', s:new Date(ev.startISO), e:new Date(ev.endISO), title: ev.title }));

  layoutEvents(col, bitems, 'event busy'); // busy behind
  layoutEvents(col, items, 'event'); // tasks above

  // Make draggable
  Array.from(col.querySelectorAll('.event')).forEach(el=>{
    if (el.classList.contains('busy')) return;
    const id = el.dataset.eid;
    if (!id) return;
    enableDrag(el, id, day, bitems);
  });
}

function layoutEvents(col, list, cls){
  list.sort((a,b)=> a.s - b.s || a.e - b.e);
  const lanes = []; const assignments = [];
  list.forEach(it=>{
    let lane = lanes.findIndex(end => it.s >= end);
    if (lane === -1){ lanes.push(it.e); lane = lanes.length-1; } else { lanes[lane] = it.e; }
    assignments.push(lane);
  });
  const totalLanes = Math.max(1, lanes.length);
  list.forEach((it, idx)=>{
    const top = minutesFromStart(it.s) * (HOUR_HEIGHT/60);
    const height = Math.max(24, ( (it.e - it.s)/60000 ) * (HOUR_HEIGHT/60) );
    const div = document.createElement('div'); 
    div.className = cls + (it.prio?(' prio-'+it.prio):'') + (it.locked?' locked':'');
    div.style.top = top + 'px';
    const lane = assignments[idx]; const gap = 4; const widthPercent = (100/totalLanes);
    div.style.left = `calc(${lane*widthPercent}% + 6px + ${gap*lane}px)`;
    div.style.width = `calc(${widthPercent}% - ${gap*(totalLanes-1)}px - 12px)`;
    div.style.height = height + 'px';
    const ts = `${pad(it.s.getHours())}:${pad(it.s.getMinutes())}–${pad(it.e.getHours())}:${pad(it.e.getMinutes())}`;
    div.innerHTML = `<div class="t">${it.title}</div><div class="muted">${ts}</div>`;
    if (it.id) div.dataset.eid = it.id;
    col.appendChild(div);
  });
}

// Drag & Drop
function enableDrag(el, eventId, day, dayBusy){
  let startY=0, origTop=0, dragging=false;
  const grid = 15; // minutes
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('mousedown', start);
  function start(e){
    if (el.classList.contains('busy')) return;
    dragging = true;
    startY = (e.touches?e.touches[0].clientY:e.clientY);
    origTop = parseFloat(el.style.top);
    el.style.cursor = 'grabbing';
    window.addEventListener('touchmove', move, {passive:false});
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', end);
    window.addEventListener('mouseup', end);
  }
  function move(e){
    if (!dragging) return;
    e.preventDefault?.();
    const y = (e.touches?e.touches[0].clientY:e.clientY);
    let dy = y - startY;
    let newTop = Math.max(0, origTop + dy);
    // snap to grid
    const minutes = Math.round(newTop / (HOUR_HEIGHT/60) / grid) * grid;
    newTop = minutes * (HOUR_HEIGHT/60);
    el.style.top = newTop + 'px';
  }
  function overlapsBusy(startMin, endMin){
    for (const b of dayBusy){
      const bs = minutesFromStart(b.s), be = minutesFromStart(b.e);
      if (Math.max(bs, startMin) < Math.min(be, endMin)) return true;
    }
    return false;
  }
  function end(){
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    window.removeEventListener('touchmove', move);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('touchend', end);
    window.removeEventListener('mouseup', end);

    const events = read(KEYS.EVENTS, []);
    const ev = events.find(x=>x.id===eventId);
    if (!ev) return;
    const durMin = Math.round((new Date(ev.endISO) - new Date(ev.startISO))/60000);

    const topPx = parseFloat(el.style.top);
    const startMin = Math.round(topPx / (HOUR_HEIGHT/60));
    const endMin = startMin + durMin;

    if (overlapsBusy(startMin, endMin)){
      // revert
      el.style.top = origTop + 'px';
      return;
    }

    const newStart = new Date(day); newStart.setHours(0,0,0,0); newStart.setMinutes(startMin);
    const newEnd = new Date(newStart.getTime() + durMin*60000);
    ev.startISO = newStart.toISOString();
    ev.endISO = newEnd.toISOString();
    ev.locked = true; // manual change locks it
    write(KEYS.EVENTS, events);
    renderSchedule();
  }
}

// Controls
$('#vDay').addEventListener('click', ()=>{ calState.view='day'; saveCal(); $('#vDay').classList.remove('secondary'); $('#vWeek').classList.add('secondary'); renderCalendar(); });
$('#vWeek').addEventListener('click', ()=>{ calState.view='week'; saveCal(); $('#vWeek').classList.remove('secondary'); $('#vDay').classList.add('secondary'); renderCalendar(); });
$('#today').addEventListener('click', ()=>{ calState.date = new Date().toISOString(); saveCal(); renderCalendar(); });
$('#prev').addEventListener('click', ()=>{ const d = new Date(calState.date); calState.date = (calState.view==='day' ? addDays(d,-1) : addDays(d,-7)).toISOString(); saveCal(); renderCalendar(); });
$('#next').addEventListener('click', ()=>{ const d = new Date(calState.date); calState.date = (calState.view==='day' ? addDays(d,1) : addDays(d,7)).toISOString(); saveCal(); renderCalendar(); });
$('#toggleBusy').addEventListener('change', (e)=>{ calState.showBusy = e.target.checked; saveCal(); renderCalendar(); });

// Export ICS
function exportICS(){
  const events = read(KEYS.EVENTS, []);
  if (!events.length){ alert('Kein Plan zum Export.'); return; }
  const tzid = 'Europe/Berlin';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DIY Motion//Time Blocker//DE','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for (const ev of events){
    const s = new Date(ev.startISO);
    const e = new Date(ev.endISO);
    const dtStart = formatICSDate(s);
    const dtEnd = formatICSDate(e);
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uuid() + '@diy-motion');
    lines.push('DTSTAMP:' + now);
    lines.push('DTSTART;TZID=' + tzid + ':' + dtStart);
    lines.push('DTEND;TZID=' + tzid + ':' + dtEnd);
    lines.push('SUMMARY:' + escapeICS(ev.title));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], {type:'text/calendar;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diy-motion.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function escapeICS(text){ return text.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function formatICSDate(d){
  const yyyy = d.getFullYear(); const mm = pad(d.getMonth()+1); const dd = pad(d.getDate());
  const hh = pad(d.getHours()); const mi = pad(d.getMinutes()); const ss = '00';
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}`;
}
$('#plan').addEventListener('click', plan);
$('#exportIcsBtn').addEventListener('click', exportICS);
$('#resetBtn').addEventListener('click', ()=>{
  localStorage.removeItem(KEYS.TASKS);
  localStorage.removeItem(KEYS.EVENTS);
  localStorage.removeItem(KEYS.BUSY);
  renderTasks(); renderSchedule(); summarizeBusy(); renderCalendar(); refreshDependencyOptions();
});

// Init
loadSettingsUI();
renderTasks();
renderSchedule();
summarizeBusy();
renderCalendar();
refreshDependencyOptions();
