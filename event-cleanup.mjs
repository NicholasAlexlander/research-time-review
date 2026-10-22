// One-time cleanup of the contaminated event recorded before this request.
// A newly created event with the same name has a later recordedAt and stays.
const name='办理党员证明材料';
const cutoff=Date.parse('2026-10-15T08:21:56.000Z');

export function removeContaminatedEvent(state){
  const events=state?.events;
  if(!Array.isArray(events))return {state,removedIds:[]};
  const removed=events.filter(event=>{
    if(typeof event?.name!=='string'||event.name.trim()!==name)return false;
    const recorded=Date.parse(event.recordedAt||event.createdAt);
    return Number.isFinite(recorded)&&recorded<=cutoff;
  });
  if(!removed.length)return {state,removedIds:[]};
  const removedIds=new Set(removed.map(event=>event.id));
  const eventDays=Object.fromEntries(Object.entries(state.eventDays||{}).map(([date,day])=>{
    const cleaned={...day};
    for(const key of ['plannedEventIds','initialPlanEventIds'])
      if(Array.isArray(cleaned[key]))cleaned[key]=cleaned[key].filter(id=>!removedIds.has(id));
    if(Array.isArray(cleaned.planChanges))cleaned.planChanges=cleaned.planChanges.filter(change=>!removedIds.has(change.eventId));
    return [date,cleaned];
  }));
  return {state:{...state,events:events.filter(event=>!removed.includes(event)),eventDays},removedIds:[...removedIds]};
}
