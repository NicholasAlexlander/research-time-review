import {formatMinutes,shiftDate} from './calc.mjs';
import {categoryGuides,eventStatuses,coordinationLabels,energyLabels,conditionLabels,
  activeEvents,currentPressure,pressureAt,pressureBand,pressureHint,createEvent,changeEvent,updateEventInfo,
  advanceEvent,previewProgressInsertion,reviseStage,stageAtDate,progressForStage,correctNode,markCoordinated,recommendEvents,eventWeekSummary,
  eventsAtDate,eventListAtDate,eventStartDate} from './events.mjs';
import {analyzeDailyPlan} from './plan.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const localDate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateOf=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const short=date=>date?date.slice(5).replace('-','/'): '无';
const completedAt=iso=>iso?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'';
const number=value=>value===null?'记录不足':String(value);
const stageMeta=value=>`<span class="event-stage-meta">压力 ${value.pressure===undefined?'未记录':`H${esc(value.pressure)}`} · 状态 ${esc(eventStatuses[value.status]||'未记录')} · 可协调性 ${esc(coordinationLabels[value.coordinatable]||'未记录')}</span>`;
export function eventCardMarkup(e,{historical=false}={}){
  const ended=e.status==='ended';
  const nodes=e.nodes||[],older=nodes.slice(0,-3),recent=nodes.slice(-3);
  const nodeMarkup=node=>`<li class="event-chain-step completed"><span class="chain-marker">✓</span><div><small>已完成 · ${esc(completedAt(node.completedAt))}${node.recordedAt&&node.recordedAt!==node.completedAt?` · 录入于 ${esc(completedAt(node.recordedAt))}`:''}</small><span>${esc(node.text)}</span>${stageMeta(node)}</div></li>`;
  const current=e.history?.findLast(change=>change.kind==='create'||change.kind==='advance');
  const chain=`<div class="event-chain" aria-label="${esc(e.name)}的链式进展">
    <div class="event-chain-title"><strong>链式进展</strong><span>${ended?`已结束 · 共 ${nodes.length+1} 个阶段`:`已完成 ${nodes.length} 个阶段`}</span></div>
    ${older.length?`<details class="event-chain-older"><summary>查看较早的 ${older.length} 个节点</summary><ol class="event-chain-list">${older.map(nodeMarkup).join('')}</ol></details>`:''}
    <ol class="event-chain-list">${recent.map(nodeMarkup).join('')}
      <li class="event-chain-step ${ended?'ended':'current'}"><span class="chain-marker">${ended?'✓':'●'}</span><div><small>${ended?'已结束':'当前进展'}</small><strong>${esc(e.currentStep||'待明确')}</strong>${current?.recordedAt&&current.recordedAt!==current.at?`<small>生效于 ${esc(completedAt(current.at))} · 录入于 ${esc(completedAt(current.recordedAt))}</small>`:''}${stageMeta(e)}</div></li>
      ${ended?'':'<li class="event-chain-step next"><span class="chain-marker">→</span><div><small>下一步行动（留空）</small><span>—</span></div></li>'}
    </ol>
    <div class="event-card-actions">${ended?`<button type="button" class="button-secondary" data-action="history" data-id="${esc(e.id)}">补录历史进展</button>`:`<button type="button" class="button-primary" data-action="progress" data-id="${esc(e.id)}">新增／补录进展</button>`}<button type="button" class="button-secondary" data-action="stage" data-id="${esc(e.id)}">更正节点内容与状态</button><button type="button" class="button-secondary" data-action="edit" data-id="${esc(e.id)}">编辑事件信息</button></div>
  </div>`;
  return `<article class="event-card ${Number(e.pressure)===3&&e.status!=='ended'?'event-h3':''}" data-id="${esc(e.id)}">
    <div class="event-card-head"><button type="button" data-action="edit" data-id="${esc(e.id)}">${esc(e.name)}</button><span>${esc(e.category)} · ${esc(e.priority)}</span></div>
    <p>${esc(eventStatuses[e.status]||e.status)} · ${esc(coordinationLabels[e.coordinatable]||'暂不确定')} · 发生 ${esc(eventStartDate(e))} · 截止 ${esc(short(e.deadline))}</p>
    ${chain}
    ${historical?'<p class="event-history-hint">这里显示截至所选日期生效的节点；之后的变化不会回写到这一天。</p>':''}
  </article>`;
}

export function initEventApp({getState,onPersist,getSelected,getWeek,getLedger}){
  let editingId=null,progressId=null,stageEditingId=null,progressBusy=false,stageBusy=false,editorDirty=false,commitQueue=Promise.resolve();
  const state=()=>getState();
  const events=()=>state().events||[];
  const find=id=>events().find(e=>e.id===id);
  const visibleOnDate=()=>getSelected()>localDate()?[]:eventsAtDate(events(),getSelected());
  const form=$('eventForm');
  const fields=name=>form.elements.namedItem(name);
  const selectedDay=()=>state().eventDays?.[getSelected()]||{};
  const showStatus=(id,message)=>{$(id).textContent=message};
  function commit(change,messageTarget='eventActionState'){
    const operation=commitQueue.then(async()=>{
      try{
        change();
        const synced=await onPersist();
        render();
        showStatus(messageTarget,synced?'已保存并同步':'已保存在本地，等待云端同步');
        return true;
      }catch(error){showStatus(messageTarget,error.message||'保存失败');return false}
    });
    commitQueue=operation.then(()=>{});
    return operation;
  }
  function updateEvent(id,updater,target){
    return commit(()=>{
      const index=events().findIndex(e=>e.id===id);
      if(index<0)throw Error('事件不存在，请刷新');
      state().events[index]=updater(state().events[index]);
    },target);
  }
  function renderOverview(){
    const active=activeEvents(events()),date=localDate(),history=pressureAt(events(),date);
    const now=history.recorded?history.end:currentPressure(events()),residual=history.residual,load=history.load;
    const band=pressureBand(load),h3=active.filter(e=>Number(e.pressure)===3);
    const focus=[...active].sort((a,b)=>{
      const score=e=>(4-Number(e.priority?.slice(1)||3))*3+Number(e.pressure)+(e.deadline&&e.deadline<=shiftDate(date,3)?4:0);
      return score(b)-score(a);
    })[0];
    $('pressureNow').textContent=String(now);
    $('pressureResidual').textContent=number(residual);
    $('pressureChronic').textContent=number(history.chronic);
    $('pressureLoad').textContent=number(load);
    $('eventOverviewText').textContent=`${band.label} · 未结束 ${active.length} 项 · H3 ${h3.length} 项${focus?` · 关注：${focus.name}`:''}`;
    $('pressureOverviewNote').textContent=`${band.advice}${residual!==null&&residual>=1.5?' 此前高负荷仍有残留，可关注恢复。':''}`;
  }
  function renderCards(){
    const date=getSelected(),historical=date!==localDate();
    const filters={category:$('filterCategory').value,priority:$('filterPriority').value,pressure:$('filterPressure').value,status:$('filterStatus').value,coordinatable:$('filterCoordination').value};
    const available=eventListAtDate(events(),date);
    const visible=available.filter(e=>Object.entries(filters).every(([key,value])=>!value||String(e[key])===value))
      .sort((a,b)=>(a.status==='ended')-(b.status==='ended')||a.priority.localeCompare(b.priority)||b.updatedAt.localeCompare(a.updatedAt));
    $('eventListDate').textContent=date>localDate()?'未来日期尚无历史记录':`${date} · 显示未结束、本周有变化或仍贡献残留压力的事件；更早记录可切换到对应日期查看`;
    $('eventCount').textContent=`${visible.length} 项（相关事件 ${available.length} 项）`;
    $('eventCards').innerHTML=visible.length?visible.map(event=>eventCardMarkup(event,{historical})).join(''):
      `<p class="empty-days">${date>localDate()?'未来日期尚无已发生的事件。':'该日期尚无事件或没有符合筛选条件的事件。可用“新增事件”补录当天发生的事务。'}</p>`;
  }
  function renderArchive(){
    const today=localDate(),shown=new Set(eventListAtDate(events(),today).map(event=>event.id));
    const archived=eventsAtDate(events(),today).filter(event=>event.status==='ended'&&!shown.has(event.id));
    $('archiveCount').textContent=`${archived.length} 项`;
    const query=$('archiveQuery').value.trim().toLocaleLowerCase(),from=$('archiveFrom').value,to=$('archiveTo').value;
    const matches=archived.filter(event=>{
      const closed=event.closedAt?dateOf(event.closedAt):'';
      const search=[event.name,event.currentStep,event.notes,...(event.nodes||[]).map(node=>node.text)].join(' ').toLocaleLowerCase();
      return (!query||search.includes(query))&&(!from||closed>=from)&&(!to||closed<=to);
    }).sort((a,b)=>(b.closedAt||'').localeCompare(a.closedAt||''));
    $('archiveCards').innerHTML=matches.length?`${matches.slice(0,20).map(event=>eventCardMarkup(event)).join('')}${matches.length>20?`<p class="fineprint">显示前 20 项，共 ${matches.length} 项；可缩小日期或关键词范围。</p>`:''}`:
      '<p class="empty-days">没有符合条件的归档事件。</p>';
  }
  function context(){
    const day=selectedDay(),date=getSelected(),row=pressureAt(events(),date),available=visibleOnDate();
    const load=row.load;
    const lateNight=[date,shiftDate(date,-1)].some(d=>{const end=state().days[d]?.endTime;return end&&(end>='23:30'||end>='00:00'&&end<'06:00')});
    return {date,load,residual:row.residual,row,chronicSources:row.chronicSources||[],available,energy:day.energy||'normal',lateNight,day};
  }
  function renderRecommendations(){
    const ctx=context(),recs=recommendEvents(ctx.available,ctx),planned=new Set(ctx.day.plannedEventIds||[]),candidates=new Set(ctx.day.candidateEventIds||[]),future=ctx.date>localDate();
    const assessment=analyzeDailyPlan(ctx.available,[...planned],ctx.row,{energy:ctx.day.energy,lateNight:ctx.lateNight,candidateIds:[...candidates]});
    $('recommendTitle').textContent=ctx.date===localDate()?'现在怎么安排':`${ctx.date} 的事务安排`;
    $('recommendContext').textContent=`${ctx.date} · 整体负荷 ${number(ctx.load)} · 当前计划压力 ${number(assessment.planLoad)}（${assessment.label}） · 精力 ${ctx.day.energy?energyLabels[ctx.energy]:'未记录'}${ctx.lateNight?' · 近期有深夜工作':''}${future?' · 未来日期不提供压力估计':''}`;
    const tiers=['优先推进','先处理阻塞','近期推进','按状态推进','建议暂缓','等待与暂缓'];
    $('recommendContent').innerHTML=recs.ranked.length?`<div class="recommend-list-intro">依照期限、优先级和当前进展排列；排名只是安排参考，不代表必须全部完成。${esc(assessment.action)}</div><ol class="ranked-events">${recs.ranked.map((item,index)=>`
      <li class="recommend-item"><div class="recommend-heading"><span class="recommend-rank">${index+1}</span><div><strong>${esc(item.name)}</strong><span class="recommend-tier">${esc(tiers[item.tier])} · ${esc(item.priority)} / H${item.pressure}${planned.has(item.eventId)?candidates.has(item.eventId)?' · 候补':' · 正式计划':''}</span></div></div>
        <p class="recommend-reasons">依据：${esc(item.reasons.join(' · '))}</p><p>当前进展：${esc(item.step||'待明确')}</p><p class="recommend-action">建议：${esc(item.action)}</p>
        <button type="button" class="button-secondary" data-plan-toggle="${planned.has(item.eventId)?'remove':'add'}" data-event-id="${esc(item.eventId)}" ${future?'disabled':''}>${planned.has(item.eventId)?'取消所选日期计划':'加入所选日期计划'}</button>${planned.has(item.eventId)?` <button type="button" class="button-secondary" data-plan-toggle="${candidates.has(item.eventId)?'formal':'candidate'}" data-event-id="${esc(item.eventId)}" ${future?'disabled':''}>${candidates.has(item.eventId)?'转为正式计划':'设为候补'}</button>`:''}</li>`).join('')}</ol>`:'<p class="empty-days">所选日期没有未结束的事件。</p>';
    const represented=new Set(recs.ranked.map(item=>item.eventId));
    const stale=[...planned].filter(id=>!represented.has(id));
    if(stale.length)$('recommendContent').insertAdjacentHTML('beforeend',`<div class="recommend-group"><h4>计划中但当前不再推荐</h4>${stale.map(id=>`<div class="recommend-item"><strong>${esc(ctx.available.find(event=>event.id===id)?.name||find(id)?.name||'已结束的事件')}</strong><p>事件已结束或该日期尚未生效，可从计划中移出。</p><button type="button" class="button-secondary" data-plan-toggle="remove" data-event-id="${esc(id)}" ${future?'disabled':''}>取消所选日期计划</button></div>`).join('')}</div>`);
    $('confirmOriginalPlan').hidden=!!ctx.day.initialPlanEventIds||future;
    $('confirmOriginalPlan').disabled=!planned.size;
    $('recommendRecovery').textContent=recs.recovery||((ctx.residual!==null&&ctx.residual>=1.5)?'此前高负荷仍有残留，可安排恢复或主动调休。':'');
  }
  function renderDay(){
    const date=getSelected(),day=selectedDay(),available=visibleOnDate(),ctx=context();
    const candidates=new Set(day.candidateEventIds||[]);
    const assessment=analyzeDailyPlan(available,day.plannedEventIds||[],ctx.row,{energy:day.energy,lateNight:ctx.lateNight,candidateIds:[...candidates]});
    $('todayPlanTitle').textContent=date===localDate()?'今日计划':`${date} 的计划`;
    $('eventDayDate').textContent=`${date} · 只根据本日已发生的事件与历史压力评估；不影响工时或积分`;
    $('eventEnergy').value=day.energy||'';
    $('eventEnergy').disabled=date>localDate();
    const eventName=id=>esc(available.find(event=>event.id===id)?.name||'当日未生效事件');
    $('originalPlan').innerHTML=day.initialPlanEventIds?day.initialPlanEventIds.length?day.initialPlanEventIds.map(id=>`<span class="plan-chip">${eventName(id)}${(day.initialCandidateEventIds||[]).includes(id)?' · 候补':''}</span>`).join(''):'<p class="empty-days">原计划为空</p>':'<p class="empty-days">尚未确认原计划；可在“现在怎么安排”选好事件后固定。</p>';
    $('plannedEvents').innerHTML=(day.plannedEventIds||[]).length?day.plannedEventIds.map(id=>`<span class="plan-chip">${eventName(id)} · ${candidates.has(id)?'候补':'正式'}</span>`).join(''):'<p class="empty-days">目前没有选择要处理的事件。</p>';
    $('planAssessment').innerHTML=`<div class="plan-assessment-head"><strong>${date>localDate()?'尚未到该日期':esc(assessment.label)}</strong><span>正式计划 H ${assessment.selectedPressure} · 候补 H ${assessment.candidatePressure} · 计划压力 ${number(assessment.planLoad)} · 整体负荷 ${number(assessment.overallLoad)}</span></div>
      <p>计划压力 = 压力残留 ${number(assessment.residual)} + 正式计划 H ${assessment.selectedPressure} + 正式计划持续负荷 ${assessment.selectedChronic}；候补仍计入整体事件压力，整体负荷 ${number(assessment.overallLoad)} 不因候补标记而改变。</p>
      ${assessment.reasons.length?`<ul>${assessment.reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}<p class="plan-action">${esc(assessment.action)}</p>`;
    $('planChanges').textContent=(day.planChanges||[]).length?`计划选择已变更 ${(day.planChanges||[]).length} 次。原计划与当前计划分开展示。`:'';
  }
  function renderWeek(){
    const ledger=getLedger(),summary=eventWeekSummary(state(),getWeek(),localDate(),ledger.results);
    $('eventWeekSummary').innerHTML=`<div class="event-metric-grid">
      <span>平均综合负荷 <strong>${number(summary.averageLoad)}</strong></span><span>最高综合负荷 <strong>${number(summary.maxLoad)}</strong></span>
      <span>较高 / 警戒天数 <strong>${summary.highLoadDays} / ${summary.alertDays}</strong></span><span>恢复提醒天数 <strong>${summary.recoveryDays}</strong></span>
      <span>新增 / 完成 / 未结束事件 <strong>${summary.newEvents} / ${summary.completedEvents} / ${summary.openEvents}</strong></span>
      <span>H3 事件 / 完成节点 <strong>${summary.highPressureEvents} / ${summary.advancedNodes}</strong></span>
      <span>计划选择变更 / 旧版延期 <strong>${summary.planChanges} / ${summary.deferred}</strong></span>
      <span>建议协调 / 实际已协调 <strong>${summary.suggestedCoordination} / ${summary.coordinatedEvents}</strong></span></div>
      <p>事件类别：${Object.entries(summary.distribution).filter(([,v])=>v).map(([k,v])=>`${k} ${v}`).join(' · ')||'暂无'}；主要压力来源：${summary.topEvents.map(x=>`${esc(x.name)} H${x.pressure}`).join('、')||'暂无'}。</p>
      <p>高负荷日期对应的 R+E / 加班 / 使用调休：${summary.highLoadWork.map(x=>`${short(x.date)} ${formatMinutes(x.effectiveMinutes)} / ${formatMinutes(x.overtimeMinutes)} / ${formatMinutes(x.usedRestMinutes)}`).join('；')||'暂无可比较记录'}。</p>
      <p>高负荷时选择的事件：${summary.highLoadPlans.filter(x=>x.plannedEventIds.length).map(x=>`${short(x.date)} ${x.plannedEventIds.map(id=>esc(eventsAtDate(events(),x.date).find(event=>event.id===id)?.name||'该日未生效事件')).join('、')}`).join('；')||'暂无'}。</p>`;
    $('eventWeekDays').innerHTML=`<div class="event-day-table"><div class="event-day-head"><span>日期</span><span>峰值</span><span>日末</span><span>残留</span><span>持续</span><span>综合</span></div>${summary.rows.map(r=>`<div><span>${short(r.date)}</span><span>${r.recorded?r.peak:'未记录'}</span><span>${r.recorded?r.end:'—'}</span><span>${r.recorded?number(r.residual):'—'}</span><span>${r.recorded?number(r.chronic):'—'}</span><span>${r.recorded?number(r.load):'—'}</span></div>`).join('')}</div>`;
  }
  function render(){renderOverview();renderCards();renderArchive();renderRecommendations();renderDay();renderWeek()}

  function readForm(){
    const conditions=Object.fromEntries(Object.keys(conditionLabels).map(k=>[k,!!form.querySelector(`[name="condition-${k}"]`)?.checked]));
    return {name:fields('name').value.trim(),createdOn:fields('createdOn').value,category:fields('category').value,priority:fields('priority').value,
      pressure:Number(fields('pressure').value),coordinatable:fields('coordinatable').value,status:fields('status').value,
      deadline:fields('deadline').value,currentStep:fields('currentStep').value.trim(),
      cognitive:fields('cognitive').value,notes:fields('notes').value.trim(),
      endDisposition:fields('status').value==='ended'?fields('endDisposition').value:null,
      closeReason:fields('status').value==='ended'?fields('closeReason').value.trim():'',conditions};
  }
  function renderFormHelp(){
    const values=readForm(),guide=categoryGuides[values.category];
    $('eventPressureHint').textContent=pressureHint({...values,id:editingId},eventsAtDate(events(),values.createdOn||getSelected()),values.createdOn||getSelected()).text;
    $('eventCategoryGuide').innerHTML=guide.levels.map((v,i)=>`<p><strong>H${i}</strong> ${esc(v)}</p>`).join('');
    $('eventDispositionField').hidden=values.status!=='ended';
    $('eventCancelField').hidden=values.status!=='ended'||values.endDisposition!=='canceled';
  }
  function openEvent(id=null){
    editingId=id;editorDirty=false;form.reset();
    const event=id?find(id):null;
    $('eventDialogTitle').textContent=event?'编辑事件':'新增事件';
    $('eventConditionFields').innerHTML=Object.entries(conditionLabels).map(([key,label])=>`<label><input type="checkbox" name="condition-${key}"> ${label}</label>`).join('');
    const data=event||{category:'R',priority:'P2',pressure:1,coordinatable:'unknown',status:'todo',cognitive:'unknown'};
    fields('createdOn').value=event?eventStartDate(event):getSelected()>localDate()?localDate():getSelected();
    fields('createdOn').max=localDate();
    $('eventDateHelp').textContent=event?`事件发生于 ${eventStartDate(event)}；实际录入于 ${completedAt(event.recordedAt||event.createdAt)}。可在这里更正发生日期。`:'可选择事件最初发生的日期，之后也能更正。';
    for(const key of ['name','category','priority','deadline','cognitive','notes'])fields(key).value=data[key]??'';
    const firstAdvance=event?.history?.findIndex(change=>change.kind==='advance')??-1;
    const initial=firstAdvance>0?event.history[firstAdvance-1].snapshot:event?.history?.find(change=>change.kind==='create')?.snapshot||event||{};
    const initialState=event?.history?.find(change=>change.kind==='create')?.snapshot||data;
    for(const key of ['pressure','coordinatable','status'])fields(key).value=initialState[key]??'';
    fields('closeReason').value=initialState.closeReason||'';
    const hasProgress=!!event?.nodes?.length;
    fields('currentStep').value=hasProgress?initial.currentStep||event.nodes[0].text:event?.currentStep||'';
    fields('currentStep').readOnly=hasProgress;
    $('initialProgressHelp').textContent=hasProgress?'这里展示初始进展与初始状态。已推进的进展请在独立窗口继续记录。':'这里只填写初始进展与初始状态。新增进展时，原进展会成为历史节点。';
    fields('endDisposition').value=initialState.endDisposition||'completed';
    for(const key of Object.keys(conditionLabels))form.querySelector(`[name="condition-${key}"]`).checked=!!data.conditions?.[key];
    $('eventFormState').textContent='';
    $('markCoordinated').hidden=!event;
    renderFormHelp();
    $('eventDialog').showModal();
  }
  function openProgress(id){
    if(progressBusy)return;
    const event=find(id);if(!event)return;
    progressId=id;$('progressForm').reset();$('progressState').textContent='';
    $('progressEventName').textContent=event.name;
    const dateField=$('progressForm').elements.namedItem('effectiveOn');
    dateField.min=eventStartDate(event);dateField.max=localDate();
    const selected=getSelected()>=eventStartDate(event)&&getSelected()<=localDate()?getSelected():localDate();
    const closed=event.status==='ended'&&event.closedAt?dateOf(event.closedAt):'';
    dateField.value=closed&&selected>=closed&&shiftDate(closed,-1)>=eventStartDate(event)?shiftDate(closed,-1):selected;
    renderProgressDate();
    $('progressDialog').showModal();
    $('progressForm').elements.namedItem('newStep').focus();
  }
  function openStage(id){
    if(stageBusy)return;
    const event=find(id);if(!event)return;
    stageEditingId=id;$('stageForm').reset();$('correctionForm').reset();$('stageState').textContent='';
    $('stageEventName').textContent=event.name;
    const stages=(event.history||[]).filter(change=>change.kind==='create'||change.kind==='advance').sort((a,b)=>a.at.localeCompare(b.at));
    $('stagePicker').innerHTML=stages.map(change=>`<option value="${esc(change.id)}">${change.kind==='create'?'初始节点':'进展节点'} · ${esc(completedAt(change.at))} · ${esc(progressForStage(event,change.id)?.currentStep||'待明确')}</option>`).join('');
    const current=stageAtDate(event,getSelected());
    $('stagePicker').value=stages.some(change=>change.id===current?.id)?current.id:stages.at(-1)?.id||'';
    $('correctionNode').innerHTML=(event.nodes||[]).map(n=>`<option value="${esc(n.id)}">${esc(n.text)}</option>`).join('');
    $('correctionForm').hidden=!(event.nodes||[]).length;
    $('stageHistory').hidden=!(event.nodes||[]).length&&!(event.corrections||[]).length;
    $('stageHistory').open=false;
    $('eventChanges').innerHTML=(event.history||[]).map(x=>`<p>${esc(x.at)} · ${esc(x.kind)} · H${esc(x.snapshot.pressure)} · ${esc(eventStatuses[x.snapshot.status]||x.snapshot.status)}</p>`).join('')+
      (event.corrections||[]).map(x=>`<p>${esc(x.at)} · 更正：${esc(x.oldText!==undefined?`${x.oldText} → ${x.newText}`:x.note)}</p>`).join('');
    renderStageSelection();
    $('stageDialog').showModal();
  }
  function readStageValues(form){
    const input=form.elements,status=input.namedItem('status').value;
    return {pressure:Number(input.namedItem('pressure').value),status,coordinatable:input.namedItem('coordinatable').value,
      ...(input.namedItem('currentStep')?{currentStep:input.namedItem('currentStep').value.trim()}:{}),
      endDisposition:status==='ended'?input.namedItem('endDisposition').value:null,
      closeReason:status==='ended'?input.namedItem('closeReason').value.trim():''};
  }
  function progressValues(){
    return readStageValues($('progressForm'));
  }
  function renderProgressEnding(){
    const input=$('progressForm').elements,ended=input.namedItem('status').value==='ended';
    $('progressDispositionField').hidden=!ended;
    $('progressCancelField').hidden=!ended||input.namedItem('endDisposition').value!=='canceled';
  }
  function renderStageEnding(){
    const input=$('stageForm').elements,ended=input.namedItem('status').value==='ended';
    $('stageDispositionField').hidden=!ended;
    $('stageCancelField').hidden=!ended||input.namedItem('endDisposition').value!=='canceled';
  }
  function renderStageSelection(){
    const event=find(stageEditingId),change=event?.history?.find(item=>item.id===$('stagePicker').value);
    if(!event||!change)return;
    const selected=change.snapshot||{},fields=$('stageForm').elements;
    const step=progressForStage(event,change.id)?.currentStep||'';
    $('stagePreview').textContent=`${change.kind==='create'?'初始节点':'进展节点'} · ${completedAt(change.at)} · 仅更正所选节点`;
    fields.namedItem('currentStep').value=step;
    for(const key of ['pressure','status','coordinatable'])fields.namedItem(key).value=selected[key]??(key==='pressure'?0:key==='status'?'todo':'unknown');
    fields.namedItem('endDisposition').value=selected.endDisposition||'completed';
    fields.namedItem('closeReason').value=selected.closeReason||'';
    renderStageEnding();
  }
  function renderProgressDate(){
    const event=find(progressId),date=$('progressForm').elements.namedItem('effectiveOn').value;
    if(!event||!date)return;
    const picker=$('progressPosition'),priorChoice=picker.value;
    const ordered=[...(event.history||[])].sort((a,b)=>a.at.localeCompare(b.at)||(a.order??0)-(b.order??0));
    const choices=ordered.filter((change,index)=>(change.kind==='advance'||
      change.snapshot.status==='ended'&&ordered[index-1]?.snapshot.status!=='ended')&&dateOf(change.at)>=date);
    picker.innerHTML='<option value="">按日期追加到当日末尾</option>'+choices.map(change=>
      `<option value="${esc(change.id)}">在 ${esc(change.kind==='advance'?`进展「${change.snapshot.currentStep}」`:'结束状态')}（${completedAt(change.at)}）之前</option>`).join('');
    picker.value=choices.some(change=>change.id===priorChoice)?priorChoice:'';
    let point;
    try{point=previewProgressInsertion(event,date,picker.value)}
    catch(error){$('progressStepHint').textContent=error.message;$('progressSubmit').disabled=true;$('progressChain').innerHTML='';return}
    const base=point.base,fields=$('progressForm').elements;
    for(const key of ['pressure','status','coordinatable'])fields.namedItem(key).value=base?.[key]??(key==='pressure'?0:key==='status'?'todo':'unknown');
    fields.namedItem('endDisposition').value=base?.endDisposition||'completed';
    fields.namedItem('closeReason').value=base?.closeReason||'';
    renderProgressEnding();
    const previous=(event.nodes||[]).filter(node=>point.history.findIndex(change=>change.id===node.transitionId)<point.insert&&point.history.some(change=>change.id===node.transitionId));
    $('progressChain').innerHTML=base?`<ol class="event-chain-list">${previous.map(node=>`<li class="event-chain-step completed"><span class="chain-marker">✓</span><div><small>已完成 · ${esc(completedAt(node.completedAt))}</small><span>${esc(node.text)}</span>${stageMeta(node)}</div></li>`).join('')}<li class="event-chain-step ${base.status==='ended'?'ended':'current'}"><span class="chain-marker">${base.status==='ended'?'✓':'●'}</span><div><small>${base.status==='ended'?'已结束':'插入前的进展'}</small><strong>${esc(base.currentStep||'待明确')}</strong>${stageMeta(base)}</div></li></ol>`:'<p>该日期之前事件尚未发生。</p>';
    $('progressStepHint').textContent=base?.status==='ended'?'此插入位置的节点已结束，请选择更早日期或“在结束状态之前”。':`进展“${base?.currentStep||'待明确'}”将归入历史；新进展在所选日期生效。${point.next?'后续进展仍按原时间和状态保留。':''}`;
    $('progressSubmit').textContent='归档原节点并保存新进展';
    $('progressSubmit').disabled=progressBusy||!base?.currentStep?.trim()||base.status==='ended';
  }
  async function saveProgress(operation){
    if(progressBusy)return;
    progressBusy=true;
    const controls=[$('closeProgressDialog'),...$('progressForm').querySelectorAll('input,select,button')];
    for(const control of controls)control.disabled=true;
    $('progressForm').setAttribute('aria-busy','true');
    $('progressState').textContent='正在保存进展并同步，请稍候…';
    try{
      if(await operation()){$('progressDialog').close();progressId=null}
    }finally{
      progressBusy=false;
      $('progressForm').removeAttribute('aria-busy');
      for(const control of controls)control.disabled=false;
      if($('progressDialog').open)renderProgressDate();
    }
  }
  async function saveStageCorrection(operation){
    if(stageBusy)return;
    stageBusy=true;
    const controls=[$('closeStageDialog'),...$('stageForm').querySelectorAll('input,select,button'),
      ...$('correctionForm').querySelectorAll('input,select,button')];
    for(const control of controls)control.disabled=true;
    $('stageForm').setAttribute('aria-busy','true');
    $('stageState').textContent='正在保存更正并同步，请稍候…';
    try{
      if(await operation()){$('stageDialog').close();stageEditingId=null}
    }finally{
      stageBusy=false;
      $('stageForm').removeAttribute('aria-busy');
      for(const control of controls)control.disabled=false;
      if($('stageDialog').open)renderStageSelection();
    }
  }
  $('newEvent').addEventListener('click',()=>openEvent());
  $('overviewNewEvent').addEventListener('click',()=>openEvent());
  $('closeEventDialog').addEventListener('click',()=>$('eventDialog').close());
  $('closeProgressDialog').addEventListener('click',()=>$('progressDialog').close());
  $('closeStageDialog').addEventListener('click',()=>$('stageDialog').close());
  $('progressDialog').addEventListener('cancel',e=>{if(progressBusy)e.preventDefault()});
  $('stageDialog').addEventListener('cancel',e=>{if(stageBusy)e.preventDefault()});
  for(const id of ['filterCategory','filterPriority','filterPressure','filterStatus','filterCoordination'])$(id).addEventListener('change',renderCards);
  const onCardAction=e=>{
    const button=e.target.closest('[data-action]');if(!button)return;
    if(button.dataset.action==='progress'||button.dataset.action==='history')openProgress(button.dataset.id);
    else if(button.dataset.action==='stage')openStage(button.dataset.id);
    else openEvent(button.dataset.id);
  };
  $('eventCards').addEventListener('click',onCardAction);
  $('archiveCards').addEventListener('click',onCardAction);
  for(const id of ['archiveQuery','archiveFrom','archiveTo'])$(id).addEventListener('input',renderArchive);
  $('progressForm').elements.namedItem('effectiveOn').addEventListener('change',()=>renderProgressDate());
  $('progressPosition').addEventListener('change',renderProgressDate);
  $('progressForm').elements.namedItem('status').addEventListener('change',renderProgressEnding);
  $('progressForm').elements.namedItem('endDisposition').addEventListener('change',renderProgressEnding);
  $('stagePicker').addEventListener('change',renderStageSelection);
  $('stageForm').elements.namedItem('status').addEventListener('change',renderStageEnding);
  $('stageForm').elements.namedItem('endDisposition').addEventListener('change',renderStageEnding);
  $('stageForm').addEventListener('submit',e=>{
    e.preventDefault();const id=stageEditingId,stageId=$('stagePicker').value,values=readStageValues($('stageForm'));
    saveStageCorrection(()=>updateEvent(id,event=>reviseStage(event,stageId,values),'stageState'));
  });
  form.addEventListener('input',e=>{
    editorDirty=true;
    if(e.target.name==='category'&&editingId===null)fields('pressure').value=categoryGuides[fields('category').value].base;
    renderFormHelp();
  });
  form.addEventListener('change',e=>{
    editorDirty=true;
    if(e.target.name==='category'&&editingId===null)fields('pressure').value=categoryGuides[fields('category').value].base;
    renderFormHelp();
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();const data=readForm();
    if(!data.name){showStatus('eventFormState','请填写事件名称');return}
    if(!data.createdOn||data.createdOn>localDate()){showStatus('eventFormState','请选择今天或过去的发生日期');return}
    const id=editingId;
    const saved=await commit(()=>{
      if(id){const index=events().findIndex(x=>x.id===id);if(index<0)throw Error('事件已不存在');
        state().events[index]=updateEventInfo(events()[index],data)}
      else state().events.push(createEvent(data));
    },'eventFormState');
    if(saved){$('eventDialog').close();editingId=null;editorDirty=false}
  });
  $('progressForm').addEventListener('submit',e=>{
    e.preventDefault();const newStep=e.target.elements.namedItem('newStep').value.trim(),id=progressId;
    if(!newStep)return;
    const date=e.target.elements.namedItem('effectiveOn').value,values=progressValues(),beforeStageId=$('progressPosition').value;
    saveProgress(()=>updateEvent(id,event=>advanceEvent(event,newStep,{...values,effectiveOn:date,beforeStageId}),'progressState'));
  });
  $('correctionForm').addEventListener('submit',e=>{
    e.preventDefault();const id=stageEditingId,nodeId=e.target.elements.namedItem('nodeId').value,note=e.target.elements.namedItem('note').value;
    saveStageCorrection(()=>updateEvent(id,event=>correctNode(event,nodeId,note),'stageState'));
  });
  $('markCoordinated').addEventListener('click',async()=>{
    if(editorDirty){showStatus('eventFormState','请先保存上方修改');return}
    const id=editingId;if(await updateEvent(id,markCoordinated,'eventFormState')){$('eventDialog').close();editingId=null}
  });
  $('eventEnergy').addEventListener('change',e=>{const date=getSelected(),value=e.target.value;commit(()=>{
    const old=state().eventDays?.[date]||{};
    state().eventDays[date]={...old,energy:value};
  },'eventDayState')});
  $('confirmOriginalPlan').addEventListener('click',()=>{const date=getSelected();commit(()=>{
    const old=state().eventDays?.[date]||{};
    if(date>localDate()||old.initialPlanEventIds)throw Error('原计划已经固定或日期尚未到来');
    state().eventDays[date]={...old,initialPlanEventIds:[...(old.plannedEventIds||[])],initialCandidateEventIds:[...(old.candidateEventIds||[])],originalConfirmedAt:new Date().toISOString()};
  },'eventDayState')});
  $('recommendContent').addEventListener('click',e=>{
    const button=e.target.closest('[data-plan-toggle]');if(!button)return;
    const date=getSelected(),id=button.dataset.eventId,action=button.dataset.planToggle;
    commit(()=>{
      const old=state().eventDays?.[date]||{},list=new Set(old.plannedEventIds||[]),candidates=new Set(old.candidateEventIds||[]);
      if(date>localDate())throw Error('未来日期尚无压力历史，请选择今天或过去日期');
      if(action==='add'&&!eventsAtDate(events(),date).some(event=>event.id===id&&event.status!=='ended'))throw Error('该事件在所选日期尚未发生或已结束');
      if((action==='candidate'||action==='formal')&&!list.has(id))throw Error('请先加入所选日期计划');
      if(action==='add'&&list.has(id)||action==='remove'&&!list.has(id))return;
      if(action==='add')list.add(id);
      if(action==='remove')list.delete(id);
      if(action==='candidate')candidates.add(id);
      if(action==='formal'||action==='remove')candidates.delete(id);
      state().eventDays[date]={...old,plannedEventIds:[...list],candidateEventIds:[...candidates],planChanges:[...(old.planChanges||[]),{at:new Date().toISOString(),action,eventId:id}]};
    },'eventDayState');
  });
  return {render};
}
