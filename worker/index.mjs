const schema = `CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Keep this narrow cleanup in sync with event-cleanup.mjs on the client.
// The recordedAt cutoff keeps a new, identically named event safe.
const cleanupName='办理党员证明材料';
const cleanupCutoff=Date.parse('2026-10-15T08:21:56.000Z');
function removeContaminatedEvent(state){
  if(!Array.isArray(state?.events))return {state,changed:false};
  const removed=state.events.filter(event=>typeof event?.name==='string'&&event.name.trim()===cleanupName&&
    Number.isFinite(Date.parse(event.recordedAt||event.createdAt))&&Date.parse(event.recordedAt||event.createdAt)<=cleanupCutoff);
  if(!removed.length)return {state,changed:false};
  const ids=new Set(removed.map(event=>event.id));
  const eventDays=Object.fromEntries(Object.entries(state.eventDays||{}).map(([date,day])=>{
    const cleaned={...day};
    for(const key of ['plannedEventIds','initialPlanEventIds'])
      if(Array.isArray(cleaned[key]))cleaned[key]=cleaned[key].filter(id=>!ids.has(id));
    if(Array.isArray(cleaned.planChanges))cleaned.planChanges=cleaned.planChanges.filter(change=>!ids.has(change.eventId));
    return [date,cleaned];
  }));
  return {state:{...state,events:state.events.filter(event=>!removed.includes(event)),eventDays},changed:true};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/state') {
      if (!env.ASSETS) return new Response('Assets unavailable', { status: 503 });
      return env.ASSETS.fetch(request);
    }
    if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    // Sites injects this header after authentication; a browser cannot choose a database identity.
    const userId = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    if (!userId) return json({ error: 'authentication_required' }, 401);
    if (!env.DB) return json({ error: 'database_unavailable' }, 503);

    try {
      await env.DB.prepare(schema).run();
      if (request.method === 'GET') {
        for(let attempt=0;attempt<3;attempt++){
          const row=await env.DB.prepare('SELECT payload, revision, updated_at FROM user_state WHERE user_id = ?').bind(userId).first();
          if(!row)return json({state:null,revision:0});
          const {state,changed}=removeContaminatedEvent(JSON.parse(row.payload));
          if(!changed)return json({state,revision:row.revision,updatedAt:row.updated_at});
          const saved=await env.DB.prepare('UPDATE user_state SET payload = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revision = ?')
            .bind(JSON.stringify(state),userId,row.revision).run();
          if(saved.meta?.changes===1)return json({state,revision:row.revision+1,updatedAt:new Date().toISOString()});
        }
        return json({error:'revision_conflict'},409);
      }

      const source = await request.text();
      if (source.length > 500_000) return json({ error: 'too_large' }, 413);
      let body;
      try { body = JSON.parse(source); } catch { return json({ error: 'invalid_json' }, 400); }
      if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
          body.state?.schema !== 1 || !body.state.days || Array.isArray(body.state.days) ||
          typeof body.state.days !== 'object' || !body.state.weeks || typeof body.state.weeks !== 'object' ||
          !body.state.rules || typeof body.state.rules !== 'object') return json({ error: 'invalid_state' }, 400);
      const payload = JSON.stringify(removeContaminatedEvent(body.state).state);
      let result;
      if (body.expectedRevision === 0) {
        result = await env.DB.prepare('INSERT OR IGNORE INTO user_state (user_id, payload, revision) VALUES (?, ?, 1)').bind(userId, payload).run();
      } else {
        result = await env.DB.prepare('UPDATE user_state SET payload = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revision = ?').bind(payload, userId, body.expectedRevision).run();
      }
      if (result.meta?.changes !== 1) return json({ error: 'revision_conflict' }, 409);
      return json({ revision: body.expectedRevision + 1, synced: true });
    } catch {
      return json({ error: 'database_error' }, 503);
    }
  },
};
