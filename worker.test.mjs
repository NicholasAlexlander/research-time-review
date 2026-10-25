import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker/index.mjs';
import {removeContaminatedEvent} from './event-cleanup.mjs';
import {createEvent,advanceEvent,eventsAtDate,pressureAt} from './events.mjs';

function environment(){
  const sqlite = new DatabaseSync(':memory:');
  return {
    DB:{ prepare(sql){let args=[];return {bind(...values){args=values;return this},run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}}},first(){return sqlite.prepare(sql).get(...args)||null}}} },
    ASSETS:{fetch:async()=>new Response('page', {status:200})},
  };
}
function request(method='GET', body, auth=true){return new Request('https://example.test/api/state',{method,headers:{...(auth?{'oai-authenticated-user-email':'Owner@example.com'}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
const sample={schema:1,days:{'2026-09-24':{times:{R:120,E:60}}},weeks:{},rules:{},openingRest:0,openingPoints:0};

test('owner records persist across requests with a checked revision',async()=>{
  const env=environment();
  const empty=await (await worker.fetch(request(),env)).json();
  assert.deepEqual(empty,{state:null,revision:0});
  const save=await (await worker.fetch(request('PUT',{state:sample,expectedRevision:0}),env)).json();
  assert.equal(save.revision,1);
  const loaded=await (await worker.fetch(request(),env)).json();
  assert.equal(loaded.state.days['2026-09-24'].times.R,120);
  assert.equal(loaded.revision,1);
  const conflict=await worker.fetch(request('PUT',{state:sample,expectedRevision:0}),env);
  assert.equal(conflict.status,409);
});

test('API rejects unauthenticated requests and leaves static assets available',async()=>{
  const env=environment();
  assert.equal((await worker.fetch(request('GET',undefined,false),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://example.test/'),env)).status,200);
});

test('event state persists alongside existing work logs without changing old fields',async()=>{
  const env=environment();
  const enriched={...sample,events:[{id:'e1',name:'实验协调',pressure:2,createdOn:'2026-10-12',createdAt:'2026-10-11T16:00:00Z',recordedAt:'2026-10-15T03:00:00Z',history:[{at:'2026-10-11T16:00:00Z',kind:'create'}]}],
    eventDays:{'2026-10-14':{energy:'tired',adjustments:[{original:'实验',deferred:'汇报'}],initialPlanEventIds:['e1'],plannedEventIds:['e1'],planChanges:[{action:'add',eventId:'e1'}]}}};
  const save=await worker.fetch(request('PUT',{state:enriched,expectedRevision:0}),env);
  assert.equal(save.status,200);
  const loaded=(await (await worker.fetch(request(),env)).json()).state;
  assert.deepEqual(loaded.events,enriched.events);
  assert.deepEqual(loaded.eventDays,enriched.eventDays);
  assert.deepEqual(loaded.days,sample.days);
});

test('backfilled chain survives API persistence and a fresh read without changing work logs',async()=>{
  const env=environment(),recorded='2026-10-20T04:00:00.000Z';
  let event=createEvent({name:'工程链',category:'E',createdOn:'2026-10-12',pressure:1,status:'doing',currentStep:'A'},recorded);
  event=advanceEvent(event,'B',{effectiveOn:'2026-10-14',pressure:2},recorded);
  event=advanceEvent(event,'C',{effectiveOn:'2026-10-15',pressure:2},recorded);
  event=advanceEvent(event,'D',{effectiveOn:'2026-10-13',pressure:3},recorded);
  const state={...sample,events:[event],eventDays:{'2026-10-13':{energy:'tired'}}};
  const saved=await worker.fetch(request('PUT',{state,expectedRevision:0}),env);
  assert.equal(saved.status,200);
  const fresh=(await (await worker.fetch(request(),env)).json()).state;
  assert.deepEqual(fresh.days,sample.days);
  assert.deepEqual(fresh.eventDays,state.eventDays);
  assert.deepEqual(fresh.events[0].nodes.map(node=>node.text),['A','D','B']);
  assert.deepEqual(['2026-10-12','2026-10-13','2026-10-14','2026-10-15'].map(date=>eventsAtDate(fresh.events,date)[0].currentStep),['A','D','B','C']);
  assert.equal(pressureAt(fresh.events,'2026-10-15','2026-10-20').end,2);
});

test('the exact contaminated old event is removed from cloud state and cannot return from a stale save',async()=>{
  const env=environment();
  const affected={id:'bad',name:'办理党员证明材料',recordedAt:'2026-10-15T07:00:00.000Z'};
  const newOne={id:'new',name:'办理党员证明材料',recordedAt:'2026-10-15T09:00:00.000Z'};
  const keep={id:'other',name:'其他材料',recordedAt:'2026-10-12T02:00:00.000Z'};
  const old={...sample,events:[affected,newOne,keep],eventDays:{'2026-10-15':{energy:'tired',
    plannedEventIds:['bad','new','other'],initialPlanEventIds:['bad','other'],
    planChanges:[{eventId:'bad',action:'add'},{eventId:'new',action:'add'}]}}};
  const first=await worker.fetch(request('PUT',{state:old,expectedRevision:0}),env);
  assert.equal(first.status,200);
  const loaded=(await (await worker.fetch(request(),env)).json());
  assert.deepEqual(removeContaminatedEvent(old).state,loaded.state);
  assert.deepEqual(loaded.state.events.map(event=>event.id),['new','other']);
  assert.deepEqual(loaded.state.eventDays['2026-10-15'].plannedEventIds,['new','other']);
  assert.deepEqual(loaded.state.eventDays['2026-10-15'].initialPlanEventIds,['other']);
  assert.deepEqual(loaded.state.eventDays['2026-10-15'].planChanges,[{eventId:'new',action:'add'}]);
  assert.deepEqual(loaded.state.days,sample.days);
  const stale=await worker.fetch(request('PUT',{state:old,expectedRevision:loaded.revision}),env);
  assert.equal(stale.status,200);
  const again=(await (await worker.fetch(request(),env)).json()).state;
  assert.deepEqual(again.events.map(event=>event.id),['new','other']);
});

test('first read migrates an already saved event with a revision checked database write',async()=>{
  const env=environment();
  const contaminated={...sample,events:[{id:'bad',name:'办理党员证明材料',createdAt:'2026-10-12T00:00:00.000Z'}]};
  await env.DB.prepare('CREATE TABLE user_state (user_id TEXT PRIMARY KEY,payload TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await env.DB.prepare('INSERT INTO user_state (user_id,payload,revision) VALUES (?,?,?)')
    .bind('owner@example.com',JSON.stringify(contaminated),5).run();
  const loaded=await (await worker.fetch(request(),env)).json();
  assert.equal(loaded.revision,6);
  assert.deepEqual(loaded.state.events,[]);
  const reread=await (await worker.fetch(request(),env)).json();
  assert.equal(reread.revision,6);
  assert.deepEqual(reread.state.days,contaminated.days);
});
