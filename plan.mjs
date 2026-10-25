import {currentPressure,pressureBand} from './events.mjs';

export function analyzeDailyPlan(events,selectedIds,pressureRow,{energy='',lateNight=false,candidateIds=[]}={}){
  const byId=new Map(events.map(event=>[event.id,event]));
  const selected=[...new Set(selectedIds||[])].map(id=>byId.get(id)).filter(Boolean);
  const candidateSet=new Set(candidateIds||[]);
  const candidates=selected.filter(event=>event.status!=='ended'&&candidateSet.has(event.id));
  const active=selected.filter(event=>event.status!=='ended'&&!candidateSet.has(event.id));
  const missing=(selectedIds||[]).filter(id=>!byId.has(id));
  const selectedPressure=active.reduce((sum,event)=>sum+Number(event.pressure||0),0);
  const candidatePressure=candidates.reduce((sum,event)=>sum+Number(event.pressure||0),0);
  const selectedChronic=(pressureRow?.chronicSources||[]).filter(source=>active.some(event=>event.id===source.eventId))
    .reduce((sum,source)=>sum+source.bonus,0);
  const allPressure=pressureRow?.recorded?pressureRow.end:events.length?currentPressure(events):null;
  const residual=pressureRow?.residual??null;
  const chronic=pressureRow?.chronic??0;
  const overallLoad=allPressure===null||residual===null?null:Math.round((allPressure+residual+chronic)*10)/10;
  const planLoad=residual===null?null:Math.round((selectedPressure+residual+selectedChronic)*10)/10;
  const unselectedPressure=allPressure===null?null:Math.max(0,allPressure-selectedPressure);
  const blocked=active.filter(event=>event.status==='waiting'||event.status==='paused'||!event.currentStep?.trim());
  const hard=active.filter(event=>event.cognitive==='high');
  const urgent=active.filter(event=>event.priority==='P0'||event.deadline&&event.deadline<=pressureRow?.date);
  const reasons=[];
  if(overallLoad!==null&&overallLoad>=6)reasons.push('整体事务负荷已处于警戒区，未选事件仍会占用注意力');
  else if(overallLoad!==null&&overallLoad>=4)reasons.push('整体事务负荷较高');
  if(planLoad!==null&&planLoad>=6)reasons.push('所选事件加上近期压力残留已进入警戒区');
  else if(planLoad!==null&&planLoad>=4)reasons.push('所选事件加上近期压力残留较高');
  if(blocked.length)reasons.push(`${blocked.length} 项仍在等待、暂缓或缺少可执行的下一步`);
  if(energy==='exhausted')reasons.push('当前自评明显疲惫，应收窄今日安排');
  else if(energy==='tired'&&hard.length)reasons.push('疲劳状态下安排了高认知任务');
  else if(energy==='tired')reasons.push('当前自评疲劳，建议控制任务数量');
  if(hard.length>=2)reasons.push('同时安排了多项高认知任务，可能需要频繁切换');
  if(lateNight)reasons.push('近期深夜工作提示需要留出恢复空间');
  if(missing.length)reasons.push(`${missing.length} 项计划事件在该日期尚未生效`);
  if(candidates.some(event=>event.priority==='P0'||event.deadline&&event.deadline<=pressureRow?.date))reasons.push('候补中有紧急或已到期事项，候补标记不会消除其期限风险');
  const severe=(overallLoad!==null&&overallLoad>=6)||(planLoad!==null&&planLoad>=6)||energy==='exhausted';
  const cautious=reasons.length>0||(overallLoad!==null&&overallLoad>=4)||(planLoad!==null&&planLoad>=4);
  const label=!selectedIds?.length?'尚未安排事件':!active.length&&candidates.length?'仅有候补任务':severe?'建议减量':cautious?'建议谨慎安排':planLoad===null?'历史不足，暂作参考':'压力条件下较适合';
  let action='按已知压力与精力看可以推进，结合实际进展安排工作。';
  if(!selectedIds?.length)action='从推荐中选择准备处理的事件，系统会即时评估。';
  else if(!active.length&&candidates.length)action=severe?'候补任务不要求今天全部完成；整体负荷仍较高，先安排恢复或处理必要事务。':'候补任务只在等待间隙或有余力时推进，不视为今日必做。';
  else if(blocked.length)action='先确认等待或暂缓事项是否有明确可执行动作，再安排实际工作。';
  else if(candidates.length&&planLoad!==null&&planLoad<4&&overallLoad!==null&&overallLoad>=4)
    action='正式计划相对较轻，候补不要求今天完成；整体事务仍有压力，请给恢复或必要协调留出空间。';
  else if(severe)action=urgent.length?'优先保留临期必要交付，协调或减少其他可调整事务。':'考虑移除或协调非紧急事务，为恢复留出空间。';
  else if(cautious)action='保留最明确的一步，避免同时安排过多高认知事务。';
  if(planLoad===null&&selectedIds?.length)reasons.push('前三天压力历史不足，计划压力暂不计算为零');
  return {selectedIds:[...new Set(selectedIds||[])],formalIds:active.map(event=>event.id),candidateIds:candidates.map(event=>event.id),candidatePressure,
    selectedPressure,selectedChronic,allPressure,unselectedPressure,residual,chronic,
    overallLoad,planLoad,band:pressureBand(planLoad).label,label,reasons,action,
    blockedIds:blocked.map(event=>event.id),energy,lateNight};
}
