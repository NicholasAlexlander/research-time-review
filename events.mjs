import {categories,shiftDate,weekStart} from './calc.mjs';

export const categoryGuides={
  R:{base:1,levels:['步骤明确、可控的常规实验','日常调研或探索，没有明显时间压力','主线阻塞、反复实验或协调资源，开始影响专注','紧迫交付、关键环境故障或多项任务相互冲突']},
  E:{base:0,levels:['自愿安排的 Verilog、C/C++ 或个人项目','普通环境问题或少量待解决障碍','持续故障、任务依赖或已承诺的交付','不可协调的紧迫交付、服务故障或明显影响生活']},
  P:{base:0,levels:['日常计划、记录和复盘','近期任务较多或有少量时间冲突','计划反复被打断，安排本身挤占工作','关键决策临期或多项核心计划持续冲突']},
  S:{base:0,levels:['自由写作或没有交付约束的创作','自主更新计划和少量修改','对外承诺、多项创作或与其他工作冲突','重大外部交付或紧急合作问题影响生活']},
  C:{base:1,levels:['常规上课和准备充足的学习','要求明确、可按计划完成的作业','临近截止、多课集中或合作依赖','多份重要作业、汇报和考试密集冲突']},
  M:{base:1,levels:['组会旁听或简短同步','要求明确、准备充分的例行汇报','临时改要求、多人协调或准备不足','多场重要汇报集中、关键内容未定']},
  A:{base:1,levels:['工位整理、无期限安装或材料归档','常规提交、审批或普通等待','多人协助、流程不确定、反复查看消息','严格截止、多环节受外部制约，影响其他工作']},
};
export const eventStatuses={todo:'待处理',doing:'处理中',waiting:'等待外部',paused:'暂缓',ended:'已结束'};
export const coordinationLabels={yes:'可协调',no:'不可协调',unknown:'暂不确定'};
export const energyLabels={high:'精力充足',normal:'正常',tired:'疲劳',exhausted:'明显疲惫'};
export const conditionLabels={
  blocked:'关键步骤被阻塞',external:'依赖外部人员',interruptions:'反复检查消息',
  overlap:'多个期限重叠',consequence:'失败后果重要',clearNext:'下一步明确可控',progress:'已取得实质进展',
};
const dateInShanghai=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const validDate=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=new Date(`${date}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date};
const dayStart=date=>new Date(`${date}T00:00:00+08:00`).toISOString();
export const eventStartDate=event=>event.createdOn||dateInShanghai(event.createdAt);
const dateDiff=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const serial=()=>globalThis.crypto?.randomUUID?.()||`item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const snapshot=event=>Object.fromEntries(['name','category','priority','pressure','coordinatable','status','deadline','currentStep','nextStep','nextMinutes','cognitive','notes','conditions','closedAt','endDisposition','closeReason','coordinatedAt'].map(k=>[k,event[k]]));
const stageFields=['pressure','status','coordinatable'];
const compareChange=(a,b)=>a.at.localeCompare(b.at)||(a.order??0)-(b.order??0);
const sortedHistory=event=>[...(event.history||[])].sort(compareChange);
// Legacy edits could change progress text without creating a new node. Align
// snapshots within each stage before a write, while leaving dated H/status
// snapshots intact. A real advance is the only boundary between stages.
function alignedProgressHistory(event){
  const history=sortedHistory(event).map(change=>({...change,snapshot:{...change.snapshot}}));
  let start=0;
  for(let end=1;end<=history.length;end++){
    if(end<history.length&&history[end].kind!=='advance')continue;
    const current=history[end-1]?.snapshot;
    if(current)for(let index=start;index<end;index++){
      history[index].snapshot.currentStep=current.currentStep;
      history[index].snapshot.nextStep=current.nextStep;
    }
    start=end;
  }
  return history;
}
const withLatest=(event,history,at)=>({...event,...history.at(-1).snapshot,history,updatedAt:at});
// A completed node belongs to its START stage, not to the transition that
// finished it. Inserting a stage in the middle changes the completion time of
// its predecessor, but must not move that predecessor's ID/corrections to the
// newly inserted stage.
function completedStageNodes(event,history){
  const previous=sortedHistory(event).filter(change=>change.kind==='create'||change.kind==='advance');
  const oldNodes=event.nodes||[];
  const byStage=new Map();
  for(let i=0;i<previous.length-1;i++){
    const next=previous[i+1];
    const old=oldNodes.find(n=>n.stageId===previous[i].id)||
      oldNodes.find(n=>n.transitionId===next.id)||
      oldNodes.find(n=>n.completedAt===next.at&&!byStageHasNode(byStage,n.id))||oldNodes[i];
    if(old)byStage.set(previous[i].id,old);
  }
  const stages=history.filter(change=>change.kind==='create'||change.kind==='advance');
  return stages.slice(0,-1).map((stage,i)=>{
    const next=stages[i+1],prior=history[history.indexOf(next)-1]?.snapshot||stage.snapshot;
    const old=byStage.get(stage.id);
    return {...old,id:old?.id||serial(),stageId:stage.id,transitionId:next.id,
      text:prior.currentStep,completedAt:next.at,
      recordedAt:old?.transitionId===next.id?(old.recordedAt||next.recordedAt||next.at):(next.recordedAt||next.at),
      pressure:prior.pressure,status:prior.status,coordinatable:prior.coordinatable};
  });
}
const byStageHasNode=(map,id)=>[...map.values()].some(node=>node.id===id);
const h=value=>Math.max(0,Math.min(3,Number(value)||0));
const contribution=s=>s.status==='ended'?0:h(s.pressure);
export const activeEvents=events=>events.filter(e=>e.status!=='ended');
export const currentPressure=events=>activeEvents(events).reduce((sum,e)=>sum+h(e.pressure),0);
export const pressureBand=value=>value===null?{label:'记录不足',advice:'压力历史积累后会显示综合负荷。'}:
  value>=6?{label:'警戒负荷',advice:'优先关键交付，主动协调、减负或休息。'}:
  value>=4?{label:'较高负荷',advice:'检查计划，适当推迟非紧急事务。'}:
  value>=2?{label:'轻度负荷',advice:'关注任务安排，减少无必要的频繁切换。'}:
  {label:'正常',advice:'按计划推进。'};

export function pressureHint(fields,events=[],today=dateInShanghai(new Date().toISOString())){
  const guide=categoryGuides[fields.category]||categoryGuides.R;
  const reasons=[];
  const left=fields.deadline?dateDiff(fields.deadline,today):null;
  if(left!==null&&left<=3)reasons.push(left<0?'截止日期已过':'近期截止');
  if(left!==null&&left<=3&&fields.coordinatable==='no')reasons.push('调整空间有限');
  if(fields.conditions?.blocked)reasons.push('关键步骤被阻塞');
  if(fields.conditions?.external)reasons.push('依赖外部');
  if(fields.conditions?.interruptions)reasons.push('反复注意力中断');
  const overlap=fields.deadline&&events.some(e=>e.id!==fields.id&&e.status!=='ended'&&e.deadline&&Math.abs(dateDiff(fields.deadline,e.deadline))<=3);
  if(fields.conditions?.overlap||overlap)reasons.push('期限重叠');
  if(fields.conditions?.consequence)reasons.push('失败后果较重要');
  const easing=[];
  if(fields.conditions?.clearNext)easing.push('下一步明确');
  if(fields.conditions?.progress)easing.push('已取得进展');
  return {base:guide.base,reasons,easing,
    text:`常规${fields.category||'R'}类参考 H${guide.base}。${reasons.length?`这项事务有${reasons.join('、')}，请检查是否需要 H2 或 H3。`:'可按实际的持续牵挂和干扰程度调整。'}${easing.length?`${easing.join('、')}也可能缓解不确定性。`:''}最终等级由你决定。`};
}

export function createEvent(fields,at=new Date().toISOString()){
  const createdOn=fields.createdOn||dateInShanghai(at);
  if(!validDate(createdOn)||createdOn>dateInShanghai(at))throw Error('事件发生日期不能晚于今天');
  const effectiveAt=createdOn===dateInShanghai(at)?at:dayStart(createdOn);
  const event={
    id:serial(),name:String(fields.name||'').trim(),category:fields.category,priority:fields.priority||'P2',
    pressure:h(fields.pressure),coordinatable:fields.coordinatable||'unknown',status:fields.status||'todo',
    deadline:fields.deadline||'',currentStep:String(fields.currentStep||'').trim(),
    nextStep:'',nextMinutes:0,
    cognitive:fields.cognitive||'unknown',notes:String(fields.notes||'').trim(),
    conditions:{...fields.conditions},createdAt:effectiveAt,createdOn,recordedAt:at,updatedAt:at,closedAt:null,
    endDisposition:fields.status==='ended'?(fields.endDisposition||'completed'):null,closeReason:fields.closeReason||'',
    coordinatedAt:null,nodes:[],corrections:[],history:[],progressModel:'current-only',
  };
  if(!event.name||!categoryGuides[event.category])throw Error('填写事件名称和类别');
  if(event.status==='ended'&&event.endDisposition==='canceled'&&!event.closeReason.trim())throw Error('取消事件时请填写原因');
  if(event.status==='ended')event.closedAt=effectiveAt;
  event.history.push({id:serial(),at:effectiveAt,recordedAt:at,kind:'create',snapshot:snapshot(event)});
  return event;
}
export function changeEventStart(event,createdOn,recordedAt=new Date().toISOString()){
  if(createdOn===eventStartDate(event))return event;
  if(!validDate(createdOn)||createdOn>dateInShanghai(recordedAt))throw Error('事件发生日期不能晚于今天');
  const later=(event.history||[]).filter(change=>change.kind!=='create');
  if(later.some(change=>dateInShanghai(change.at)<createdOn)||
     (event.nodes||[]).some(node=>dateInShanghai(node.completedAt)<createdOn))
    throw Error('事件发生日期不能晚于已记录的进展或压力变化');
  const effectiveAt=dayStart(createdOn),history=(event.history||[]).map(change=>change.kind==='create'?{...change,at:effectiveAt,recordedAt:change.recordedAt||event.createdAt}:change);
  return {...event,createdOn,createdAt:effectiveAt,recordedAt:event.recordedAt||event.createdAt,updatedAt:recordedAt,history,
    dateCorrections:[...(event.dateCorrections||[]),{at:recordedAt,from:eventStartDate(event),to:createdOn}]};
}
export function changeEvent(event,patch,at=new Date().toISOString(),kind='update'){
  const next={...event,...patch,updatedAt:at};
  if(next.status==='ended'&&event.status!=='ended'){next.closedAt=at;next.endDisposition=next.endDisposition||'completed'}
  if(next.status!=='ended'&&event.status==='ended'){next.closedAt=null;next.endDisposition=null;next.closeReason=''}
  if(!next.name?.trim())throw Error('事件名称不能为空');
  if(next.status==='ended'&&next.endDisposition==='canceled'&&!next.closeReason?.trim())throw Error('取消事件时请填写原因');
  next.pressure=h(next.pressure);
  const before=snapshot(event),after=snapshot(next);
  if(JSON.stringify(before)===JSON.stringify(after))return event;
  next.history=[...(event.history||[]),{id:serial(),at,kind,previousPressure:contribution(event),snapshot:after}];
  return next;
}
export function updateEventInfo(event,fields,at=new Date().toISOString()){
  const {createdOn,...patch}=fields;
  let shifted=createdOn?changeEventStart(event,createdOn,at):event;
  const initial=Object.fromEntries(stageFields.filter(field=>patch[field]!==undefined).map(field=>[field,patch[field]]));
  for(const field of stageFields)delete patch[field];
  if(initial.status==='ended'){initial.endDisposition=patch.endDisposition||'completed';initial.closeReason=patch.closeReason||''}
  delete patch.endDisposition;delete patch.closeReason;
  if(shifted.nodes?.length)delete patch.currentStep;
  else if(patch.currentStep!==undefined){initial.currentStep=patch.currentStep;delete patch.currentStep}
  delete patch.nextStep;
  shifted=reviseStage(shifted,sortedHistory(shifted).find(change=>change.kind==='create').id,initial,at);
  return changeEvent(shifted,patch,at);
}
export function stageAtDate(event,date){
  return sortedHistory(event).filter(change=>(change.kind==='create'||change.kind==='advance')&&dateInShanghai(change.at)<=date).at(-1)||null;
}
export function reviseStage(event,stageId,values,at=new Date().toISOString()){
  const history=alignedProgressHistory(event),index=history.findIndex(change=>change.id===stageId&&(change.kind==='create'||change.kind==='advance'));
  if(index<0)throw Error('找不到这个进展节点');
  const target=history[index];
  if(Object.hasOwn(values,'pressure')&&(!Number.isInteger(Number(values.pressure))||Number(values.pressure)<0||Number(values.pressure)>3))throw Error('压力等级需为 H0 至 H3');
  if(Object.hasOwn(values,'status')&&!eventStatuses[values.status])throw Error('请选择有效的事件状态');
  if(Object.hasOwn(values,'coordinatable')&&!coordinationLabels[values.coordinatable])throw Error('请选择有效的可协调性');
  if(Object.hasOwn(values,'currentStep')&&!String(values.currentStep||'').trim())throw Error('节点描述不能为空');
  if(values.status==='ended'&&history.slice(index+1).some(change=>change.kind==='advance'))throw Error('后面已有进展节点，不能将其前面的节点设为已结束');
  if(values.status==='ended'&&values.endDisposition==='canceled'&&!values.closeReason?.trim())throw Error('取消事件时请填写原因');
  const editable=[...stageFields,'currentStep'];
  const patch=Object.fromEntries(editable.filter(field=>values[field]!==undefined).map(field=>[field,field==='pressure'?h(values[field]):field==='currentStep'?String(values[field]).trim():values[field]]));
  const originalText=progressForStage({history},stageId)?.currentStep||'';
  if(Object.hasOwn(patch,'status')&&patch.status!==target.snapshot.status){
    patch.closedAt=patch.status==='ended'?target.at:null;
    patch.endDisposition=patch.status==='ended'?(values.endDisposition||'completed'):null;
    if(patch.status!=='ended')patch.closeReason='';
    editable.push('closedAt','endDisposition','closeReason');
  }
  if((patch.status||target.snapshot.status)==='ended'){
    if(values.endDisposition!==undefined)patch.endDisposition=values.endDisposition;
    if(values.closeReason!==undefined)patch.closeReason=values.closeReason;
    if(!editable.includes('endDisposition'))editable.push('endDisposition','closeReason');
  }
  let previousOriginal=target.snapshot,previousUpdated={...target.snapshot,...patch};
  history[index]={...target,snapshot:previousUpdated};
  for(let i=index+1;i<history.length&&history[i].kind!=='advance';i++){
    const original=history[i].snapshot,updated={...original};
    for(const field of editable)if(Object.hasOwn(patch,field)&&original[field]===previousOriginal[field])updated[field]=previousUpdated[field];
    history[i]={...history[i],snapshot:updated};previousOriginal=original;previousUpdated=updated;
  }
  const nodes=completedStageNodes(event,history);
  const corrected=Object.hasOwn(patch,'currentStep')&&originalText!==patch.currentStep;
  const corrections=corrected?[...(event.corrections||[]),{id:serial(),kind:'text',stageId,at,
    oldText:originalText,newText:patch.currentStep,note:`节点描述：${originalText} → ${patch.currentStep}`}]:event.corrections||[];
  return {...withLatest(event,history,at),nodes,corrections,progressModel:'current-only'};
}
function insertionPoint(history,date,at,beforeStageId){
  const target=beforeStageId?history.find((change,index)=>change.id===beforeStageId&&
    (change.kind==='advance'||change.snapshot.status==='ended'&&history[index-1]?.snapshot.status!=='ended')):null;
  if(beforeStageId&&!target)throw Error('要插入到其前的节点不存在');
  if(target&&date>dateInShanghai(target.at))throw Error('补录日期晚于所选后继节点');
  let effectiveAt=date===dateInShanghai(at)?at:dayStart(date),order=0;
  if(target&&date===dateInShanghai(target.at)){
    effectiveAt=target.at;
    const tied=history.filter(change=>change.at===target.at);
    if(new Set(tied.map(change=>change.order??0)).size!==tied.length)
      tied.forEach((change,index)=>{change.order=index*2});
    const earlier=history.filter(change=>change.at===target.at&&change!==target&&history.indexOf(change)<history.indexOf(target)).at(-1);
    order=earlier?((earlier.order??0)+(target.order??0))/2:(target.order??0)-1;
    // Same-timestamp records without an explicit order retain their stable
    // order; place the insertion strictly before the requested successor.
  }else{
    const sameDay=history.filter(change=>dateInShanghai(change.at)===date&&(!target||compareChange(change,target)<0));
    if(sameDay.length&&effectiveAt<=sameDay.at(-1).at)effectiveAt=new Date(Date.parse(sameDay.at(-1).at)+1).toISOString();
  }
  if(dateInShanghai(effectiveAt)!==date)throw Error('该日期内没有可用的进展顺序，请选择明确的后继节点');
  if(effectiveAt>at)throw Error('进展生效时间不能晚于补录时间');
  const probe={at:effectiveAt,order};
  const index=history.findIndex(change=>compareChange(change,probe)>0);
  const insert=index<0?history.length:index;
  const next=history.slice(insert).find((change,index,list)=>change.kind==='advance'||
    change.snapshot.status==='ended'&&(index===0?history[insert-1]?.snapshot.status!=='ended':list[index-1].snapshot.status!=='ended'));
  if(target&&next?.id!==target.id)throw Error('所选节点位置与补录日期不一致，请检查进展顺序');
  return {effectiveAt,order,insert,base:history[insert-1]?.snapshot,next};
}
export function previewProgressInsertion(event,date,beforeStageId='',at=new Date().toISOString()){
  const history=sortedHistory(event).map(change=>({...change}));
  return insertionPoint(history,date,at,beforeStageId);
}
export function advanceEvent(event,newCurrentStep,optionsOrAt={},recordedAt=new Date().toISOString()){
  const options=typeof optionsOrAt==='string'?{}:optionsOrAt;
  const at=typeof optionsOrAt==='string'?optionsOrAt:recordedAt;
  const date=options.effectiveOn||dateInShanghai(at),start=eventStartDate(event);
  if(!validDate(date)||date<start||date>dateInShanghai(at))throw Error('进展日期需在事件发生日期与今天之间');
  const history=alignedProgressHistory(event);
  const {effectiveAt,order,insert,base,next}=insertionPoint(history,date,at,options.beforeStageId);
  if(!base?.currentStep?.trim())throw Error('请先填写当前节点');
  if(base.status==='ended')throw Error('已结束的节点不能继续推进，请先更正该节点状态');
  if(!String(newCurrentStep||'').trim())throw Error('请填写新增的当前进展');
  if(base.currentStep.trim()===String(newCurrentStep).trim()||next?.snapshot.currentStep?.trim()===String(newCurrentStep).trim())throw Error('相邻进展描述相同，请检查是否重复补录');
  const values={pressure:options.pressure??base.pressure,status:options.status??base.status,coordinatable:options.coordinatable??base.coordinatable};
  if(!Number.isInteger(Number(values.pressure))||Number(values.pressure)<0||Number(values.pressure)>3)throw Error('压力等级需为 H0 至 H3');
  if(!eventStatuses[values.status]||!coordinationLabels[values.coordinatable])throw Error('请选择有效的节点状态');
  if(values.status==='ended'&&history.slice(insert).some(change=>change.kind==='advance'))throw Error('后面已有进展节点，不能提前结束事件');
  if(values.status==='ended'&&options.endDisposition==='canceled'&&!options.closeReason?.trim())throw Error('取消事件时请填写原因');
  const newState={...base,currentStep:String(newCurrentStep).trim(),nextStep:'',nextMinutes:0,
    pressure:h(values.pressure),status:values.status,coordinatable:values.coordinatable,
    closedAt:values.status==='ended'?effectiveAt:null,
    endDisposition:values.status==='ended'?(options.endDisposition||'completed'):null,
    closeReason:values.status==='ended'?(options.closeReason||''):''};
  const transition={id:serial(),at:effectiveAt,order,recordedAt:at,kind:'advance',snapshot:newState};
  history.splice(insert,0,transition);
  let old=base,updated=newState;
  for(let i=insert+1;i<history.length;i++){
    if(history[i].kind==='advance')break;
    const original=history[i].snapshot,rebased={...original};
    for(const field of ['currentStep','nextStep','nextMinutes','pressure','status','coordinatable','closedAt','endDisposition','closeReason'])
      if(original[field]===old[field])rebased[field]=updated[field];
    history[i]={...history[i],snapshot:rebased};old=original;updated=rebased;
  }
  const nodes=completedStageNodes(event,history);
  return {...withLatest(event,history,at),nodes,progressModel:'current-only'};
}
// This one event was recorded with the retired two-step form: the first save
// only filled nextStep, and the second save advanced to that first input while
// leaving the second input in nextStep. Recreate those two advances at the
// recorded transition date without guessing a separate date for the first.
export function repairRetiredProgress(event){
  if(event?.progressModel==='current-only'||eventStartDate(event)!=='2026-10-12'||
     event.name?.replaceAll('**','').trim()!=='工程实践，搭建工位笔记本连接的流程打通和问题整合')return event;
  const original=alignedProgressHistory(event);
  const advances=original.filter(change=>change.kind==='advance');
  if(!advances.length||(event.nodes||[]).length!==advances.length)return event;
  const firstIndex=original.findIndex(change=>change.id===advances[0].id);
  const first=original[firstIndex-1]?.snapshot?.nextStep?.trim();
  const latest=original.at(-1)?.snapshot?.nextStep?.trim();
  if(!first||!latest||first==='待明确'||latest==='待明确')return event;
  const prior=original[firstIndex-1];
  const synthetic={id:`retired-progress-${advances[0].id}`,at:advances[0].at,
    recordedAt:advances[0].recordedAt||advances[0].at,kind:'advance',
    snapshot:{...prior.snapshot,currentStep:first,nextStep:'',nextMinutes:0}};
  const history=[];
  let current=original[0]?.snapshot?.currentStep;
  for(let i=0;i<original.length;i++){
    if(i===firstIndex){history.push(synthetic);current=first}
    const change=original[i];
    if(change.kind==='advance')current=change.snapshot.nextStep?.trim()||change.snapshot.currentStep;
    else if(i>firstIndex)current=change.snapshot.nextStep?.trim()||current;
    history.push({...change,snapshot:{...change.snapshot,currentStep:current,nextStep:'',nextMinutes:0}});
  }
  const oldNodes=[...(event.nodes||[])].sort((a,b)=>a.completedAt.localeCompare(b.completedAt));
  const transitions=history.filter(change=>change.kind==='advance');
  const nodes=transitions.map((transition,index)=>{
    const before=history[history.indexOf(transition)-1].snapshot;
    return {...(oldNodes[index]||{}),id:oldNodes[index]?.id||`retired-node-${transition.id}`,
      transitionId:transition.id,text:before.currentStep,completedAt:transition.at,
      recordedAt:transition.recordedAt||transition.at,pressure:before.pressure,
      status:before.status,coordinatable:before.coordinatable};
  });
  return {...withLatest(event,history,event.updatedAt),nodes,progressModel:'current-only'};
}
export function correctNode(event,nodeId,note,at=new Date().toISOString()){
  if(!event.nodes?.some(n=>n.id===nodeId)||!note?.trim())throw Error('选择历史节点并填写更正说明');
  return {...event,corrections:[...(event.corrections||[]),{id:serial(),nodeId,at,note:note.trim()}],
    updatedAt:at,history:[...(event.history||[]),{id:serial(),at,kind:'correction',snapshot:snapshot(event)}]};
}
export function markCoordinated(event,at=new Date().toISOString()){
  return changeEvent(event,{coordinatedAt:at},at,'coordinated');
}
export function progressForStage(event,stageId){
  const history=sortedHistory(event),index=history.findIndex(change=>change.id===stageId);
  if(index<0)return null;
  const next=history.findIndex((change,i)=>i>index&&change.kind==='advance');
  const state=history[(next<0?history.length:next)-1]?.snapshot;
  return state?{currentStep:state.currentStep}:null;
}
export function eventAt(event,date){
  const visible=sortedHistory(event).filter(change=>dateInShanghai(change.at)<=date);
  const state=visible.at(-1)?.snapshot;
  if(!state)return null;
  // Older versions allowed editing progress in an ordinary event update. That
  // left different text snapshots for one and the same node, especially after
  // moving the event start date backwards. Within a node, the latest wording
  // is its initial/corrected wording; only an advance creates the next node.
  // Stop at the next advance so its progress cannot leak into an earlier day.
  const stage=visible.findLast(change=>change.kind==='create'||change.kind==='advance');
  const progress=stage&&progressForStage(event,stage.id);
  // Category and priority are event information edited in the base form.
  // A dated progress snapshot supplies H/status/coordination, but must not
  // mask a later edit to these base fields while browsing an earlier day.
  return {...state,...progress,category:event.category,priority:event.priority};
}
export function eventsAtDate(events,date){
  return events.flatMap(event=>{
    if(eventStartDate(event)>date)return [];
    const state=eventAt(event,date);
    if(!state)return [];
    const history=sortedHistory(event).filter(change=>dateInShanghai(change.at)<=date);
    return [{...event,...state,
      nodes:(event.nodes||[]).filter(node=>dateInShanghai(node.completedAt)<=date),
      corrections:(event.corrections||[]).filter(change=>dateInShanghai(change.at)<=date),
      history,updatedAt:history.at(-1)?.at||event.createdAt}];
  });
}
// Keep the event list focused on work relevant to the selected day. This only
// filters cards; pressure history, weekly exports and persisted events still
// read the full event collection.
export function eventListAtDate(events,date,asOf=dateInShanghai(new Date().toISOString())){
  if(date>asOf)return [];
  const start=weekStart(date);
  const residualIds=new Set((pressureAt(events,date,asOf).residualSources||[])
    .filter(source=>source.amount>0).map(source=>source.eventId));
  return eventsAtDate(events,date).filter(event=>
    event.status!=='ended'||residualIds.has(event.id)||eventStartDate(event)>=start||
    (event.history||[]).some(change=>change.at&&dateInShanghai(change.at)>=start&&dateInShanghai(change.at)<=date)
  );
}
export function highPressureDays(event,asOf=dateInShanghai(new Date().toISOString())){
  if(!event.createdAt)return 0;
  let count=0;
  for(let date=dateInShanghai(event.createdAt);date<=asOf;date=shiftDate(date,1)){
    const previous=eventAt(event,shiftDate(date,-1));
    const onDate=(event.history||[]).filter(x=>dateInShanghai(x.at)===date).map(x=>x.snapshot);
    if([previous,...onDate].some(x=>x&&x.status!=='ended'&&h(x.pressure)>=2))count++;
  }
  return count;
}

// Consecutive days are counted from the dated event snapshots, not the number
// of progress nodes. A lower-pressure day or an ended event breaks the run.
export function sustainedPressure(event,date){
  let days=0;
  for(let day=date;day>=eventStartDate(event);day=shiftDate(day,-1)){
    const state=eventAt(event,day);
    if(!state||contribution(state)<2)break;
    days++;
  }
  return {days,bonus:days>=14?1:days>=7?0.5:0};
}

export function pressureHistory(events,start,end,asOf=dateInShanghai(new Date().toISOString())){
  const stream=events.flatMap(e=>(e.history||[]).filter(change=>change.snapshot).map(change=>({...change,eventId:e.id})))
    .sort((a,b)=>a.at.localeCompare(b.at));
  const started=stream.length?dateInShanghai(stream[0].at):null;
  const rows=[],live=new Map();
  let cursor=0;
  for(let date=start;date<=end;date=shiftDate(date,1)){
    while(cursor<stream.length&&dateInShanghai(stream[cursor].at)<date){live.set(stream[cursor].eventId,stream[cursor].snapshot);cursor++}
    if(!started||date<started||date>asOf){rows.push({date,recorded:false,peak:null,end:null,residual:null,chronic:null,load:null});continue}
    while(cursor<stream.length&&dateInShanghai(stream[cursor].at)===date&&stream[cursor].at<=dayStart(date)){
      live.set(stream[cursor].eventId,stream[cursor].snapshot);cursor++;
    }
    let total=[...live.values()].reduce((n,s)=>n+contribution(s),0),peak=total;
    const eventPeaks=new Map([...live].map(([id,state])=>[id,contribution(state)]));
    while(cursor<stream.length&&dateInShanghai(stream[cursor].at)===date){
      live.set(stream[cursor].eventId,stream[cursor].snapshot);cursor++;
      const id=stream[cursor-1].eventId;
      eventPeaks.set(id,Math.max(eventPeaks.get(id)||0,contribution(live.get(id))));
      total=[...live.values()].reduce((n,s)=>n+contribution(s),0);
      peak=Math.max(peak,total);
    }
    const eventEnds=new Map([...live].map(([id,state])=>[id,contribution(state)]));
    const chronicSources=events.flatMap(event=>{
      if(!eventEnds.get(event.id))return [];
      const {days,bonus}=sustainedPressure(event,date);
      return bonus?[{eventId:event.id,days,bonus}]:[];
    });
    const chronic=chronicSources.reduce((sum,source)=>sum+source.bonus,0);
    rows.push({date,recorded:true,peak,end:total,residual:null,chronic,load:null,
      chronicSources,eventPeaks,eventEnds});
  }
  for(const [index,row] of rows.entries()){
    if(!row.recorded)continue;
    const previous=[rows[index-1],rows[index-2],rows[index-3]];
    if(previous.every(r=>r?.recorded)){
      const residualSources=[];
      for(const event of events){
        const now=row.eventEnds.get(event.id)||0;
        const amount=[.5,.3,.2].reduce((sum,weight,k)=>
          sum+weight*Math.max(0,(previous[k].eventPeaks.get(event.id)||0)-now),0);
        if(amount)residualSources.push({eventId:event.id,amount:Math.round(amount*10)/10});
      }
      row.residual=Math.round(Math.min(6,residualSources.reduce((sum,source)=>sum+source.amount,0))*10)/10;
      row.residualSources=residualSources;
      row.load=Math.round((row.end+row.residual+row.chronic)*10)/10;
    }
  }
  return rows.map(({eventPeaks,eventEnds,...row})=>row);
}
export function pressureAt(events,date,asOf=dateInShanghai(new Date().toISOString())){
  const rows=pressureHistory(events,shiftDate(date,-3),date,asOf);
  return rows.at(-1);
}
export function recommendEvents(events,{date,load,energy='normal',lateNight=false,chronicSources=[]}){
  const result={priority:[],coordinate:[],suitable:[],waiting:[],ranked:[]};
  const strained=(load!==null&&load>=4)||energy==='tired'||energy==='exhausted'||lateNight;
  for(const event of activeEvents(events)){
    const due=event.deadline?dateDiff(event.deadline,date):null;
    const near=due!==null&&due<=3;
    const step=event.currentStep?.trim()||'';
    const urgent=event.priority==='P0'||near;
    const label=`${event.name} · ${event.priority} / H${event.pressure}`;
    const blocked=event.status==='waiting'||event.status==='paused'||!step;
    const cognitivePause=strained&&!urgent&&event.cognitive==='high';
    const chronic=chronicSources.find(source=>source.eventId===event.id);
    const stage=stageAtDate(event,date);
    const stageDays=stage?dateDiff(date,dateInShanghai(stage.at))+1:0;
    const reasons=[event.priority,`当前节点 H${event.pressure}`];
    if(due!==null&&due<=3)reasons.push(due<0?`已逾期 ${-due} 天`:due===0?'今日截止':`距截止 ${due} 天`);
    if(chronic)reasons.push(`连续 ${chronic.days} 天 H2/H3`);
    if(stageDays>=7&&Number(event.pressure)>=2)reasons.push(`当前进展持续 ${stageDays} 天`);
    if(event.status==='waiting')reasons.push('等待外部结果');
    if(event.status==='paused')reasons.push('当前暂缓');
    if(!step)reasons.push('当前进展待明确');
    if(cognitivePause)reasons.push('高负荷下的高认知任务');
    const tier=blocked?(urgent?1:5):cognitivePause?4:urgent?0:event.priority==='P1'?2:3;
    const action=blocked?urgent?'先确认外部依赖或恢复推进条件，保留截止风险。':'等待或暂缓；有明确可执行动作后再推进。':
      cognitivePause?'可暂缓本次高认知投入，先给恢复留出空间。':
      urgent?(event.coordinatable==='yes'&&Number(event.pressure)>=2?'先沟通交付范围，再推进当前进展。':'优先推进当前进展，收窄到必要交付。'):
      event.coordinatable==='yes'&&Number(event.pressure)>=2?'先协调范围、分工或资源，再推进当前进展。':'推进当前进展。';
    result.ranked.push({eventId:event.id,title:label,name:event.name,step,action,reasons,tier,
      due,priority:event.priority,pressure:Number(event.pressure)||0,coordinatable:event.coordinatable,
      chronicDays:chronic?.days||0});
    if(event.coordinatable==='yes'&&(event.pressure>=2||near||strained&&event.priority!=='P0')){
      result.coordinate.push({eventId:event.id,title:label,text:`可考虑沟通阶段范围、截止、分工或资源${near?'，同时确认临近交付':'，由你决定是否调整'}。`});
    }
    if(event.status==='waiting'||event.status==='paused'||!step){
      result.waiting.push({eventId:event.id,title:label,text:event.status==='waiting'?
        `主要等待外部结果${urgent?'，保留截止风险；有可执行跟进行动时再处理':''}。`:
        event.status==='paused'?'当前暂缓，保留链路和压力记录。':'下一步待明确，先确认可执行动作。'});
      continue;
    }
    if(urgent||event.priority==='P1'&&!strained){
      result.priority.push({eventId:event.id,title:label,text:`${near?(due<0?'已过截止':'距截止 '+due+' 天')+'；':''}${event.coordinatable==='no'&&near?'优先完成最低必要交付；':''}当前进展：${step}。${strained&&event.priority!=='P0'?'注意控制本次工作边界。':''}`});
    }else if(strained&&event.cognitive==='high'){
      result.waiting.push({eventId:event.id,title:label,text:'当前负荷或精力状态不适合高认知投入，可暂缓并留出恢复时间。'});
    }else{
      result.suitable.push({eventId:event.id,title:label,text:`可推进：${step}。`});
    }
  }
  if(energy==='exhausted')result.recovery='明显疲惫：休息或主动调休也是合理选项；必要交付尽量收窄范围。';
  else if(strained)result.recovery='近期负荷或疲劳较明显，请给恢复留出空间。';
  result.ranked.sort((a,b)=>a.tier-b.tier||(a.due??Infinity)-(b.due??Infinity)||
    Number(a.priority.slice(1))-Number(b.priority.slice(1))||b.pressure-a.pressure||b.chronicDays-a.chronicDays||a.name.localeCompare(b.name,'zh-CN'));
  return result;
}
export function eventWeekSummary(state,start,asOf=dateInShanghai(new Date().toISOString()),ledgerResults={}){
  const end=shiftDate(start,6),cutoff=asOf<end?asOf:end,events=state.events||[],daily=state.eventDays||{};
  const rows=pressureHistory(events,shiftDate(start,-3),end,asOf).slice(3);
  const known=rows.filter(r=>r.recorded),withLoad=known.filter(r=>r.load!==null);
  const weekEvents=events.filter(e=>e.createdAt&&dateInShanghai(e.createdAt)<=cutoff&&
    (eventAt(e,start)?.status!=='ended'||e.history?.some(x=>dateInShanghai(x.at)>=start&&dateInShanghai(x.at)<=cutoff)));
  const stateAtEnd=weekEvents.map(e=>({event:e,snapshot:eventAt(e,cutoff)})).filter(x=>x.snapshot);
  const distribution=Object.fromEntries(categories.map(c=>[c.key,0]));
  for(const {snapshot:s} of stateAtEnd)distribution[s.category]=(distribution[s.category]||0)+1;
  const adjustments=rows.flatMap(r=>daily[r.date]?.adjustments||[]);
  const planChanges=rows.flatMap(r=>daily[r.date]?.planChanges||[]);
  const highDates=known.filter(r=>r.load!==null&&r.load>=4);
  return {start,end,rows,recordedDays:known.length,loadDays:withLoad.length,
    averageLoad:withLoad.length?Math.round(withLoad.reduce((n,r)=>n+r.load,0)/withLoad.length*10)/10:null,
    maxLoad:withLoad.length?Math.max(...withLoad.map(r=>r.load)):null,
    highLoadDays:highDates.length,alertDays:withLoad.filter(r=>r.load>=6).length,
    recoveryDays:known.filter(r=>r.residual!==null&&r.residual>=1.5).length,
    newEvents:events.filter(e=>e.createdAt&&dateInShanghai(e.createdAt)>=start&&dateInShanghai(e.createdAt)<=cutoff).length,
    completedEvents:events.filter(e=>[...(e.history||[])].sort((a,b)=>a.at.localeCompare(b.at)).some((x,i,list)=>x.snapshot.status==='ended'&&list[i-1]?.snapshot.status!=='ended'&&dateInShanghai(x.at)>=start&&dateInShanghai(x.at)<=cutoff)).length,
    openEvents:stateAtEnd.filter(x=>x.snapshot.status!=='ended').length,
    highPressureEvents:stateAtEnd.filter(x=>x.snapshot.status!=='ended'&&h(x.snapshot.pressure)===3).length,
    distribution,topEvents:stateAtEnd.filter(x=>x.snapshot.status!=='ended').sort((a,b)=>h(b.snapshot.pressure)-h(a.snapshot.pressure)).slice(0,3).map(x=>({id:x.event.id,name:x.snapshot.name,pressure:h(x.snapshot.pressure)})),
    pressureChanges:events.flatMap(e=>(e.history||[]).filter(x=>x.at&&dateInShanghai(x.at)>=start&&dateInShanghai(x.at)<=cutoff&&x.kind!=='correction').map(x=>({eventId:e.id,name:x.snapshot.name,at:x.at,kind:x.kind,pressure:x.snapshot.pressure,status:x.snapshot.status}))),
    advancedNodes:events.reduce((n,e)=>n+(e.nodes||[]).filter(x=>dateInShanghai(x.completedAt)>=start&&dateInShanghai(x.completedAt)<=cutoff).length,0),
    adjustments:adjustments.length+planChanges.length,planChanges:planChanges.length,coordinatedEvents:new Set(events.flatMap(e=>(e.history||[]).filter(x=>x.kind==='coordinated'&&dateInShanghai(x.at)>=start&&dateInShanghai(x.at)<=cutoff).map(()=>e.id))).size,
    suggestedCoordination:stateAtEnd.filter(x=>x.snapshot.status!=='ended'&&x.snapshot.coordinatable==='yes'&&h(x.snapshot.pressure)>=2).length,
    deferred:adjustments.reduce((n,a)=>n+(a.deferred?.trim()?1:0),0),
    highLoadWork:highDates.map(r=>({date:r.date,effectiveMinutes:ledgerResults[r.date]?.effective||0,
      overtimeMinutes:ledgerResults[r.date]?.overtime||0,usedRestMinutes:ledgerResults[r.date]?.usedRest||0})),
    highLoadPlans:highDates.map(r=>({date:r.date,plannedEventIds:daily[r.date]?.plannedEventIds||[],planChanges:daily[r.date]?.planChanges||[],adjustments:daily[r.date]?.adjustments||[]})),
    events:weekEvents,
  };
}
