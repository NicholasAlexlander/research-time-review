import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryGuides,pressureHint,createEvent,changeEvent,updateEventInfo,advanceEvent,correctNode,
  pressureAt,pressureHistory,currentPressure,eventAt,recommendEvents,eventWeekSummary,sustainedPressure,
  eventsAtDate,eventListAtDate,eventStartDate,changeEventStart,stageAtDate,reviseStage,repairRetiredProgress} from './events.mjs';
import {eventCardMarkup} from './events-ui.mjs';
import {analyzeDailyPlan} from './plan.mjs';

const at=(date,hour='04:00')=>`${date}T${hour}:00.000Z`;
const make=(date,pressure=3,overrides={})=>createEvent({name:'待协调材料',category:'A',priority:'P1',pressure,
  coordinatable:'yes',status:'doing',currentStep:'收集材料',...overrides},at(date));

test('category defaults are guidance; deadline and interruptions prompt but never override H',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(categoryGuides).map(([key,guide])=>[key,guide.base])),
    {R:1,E:0,P:0,S:0,C:1,M:1,A:1});
  const hint=pressureHint({category:'E',pressure:0,deadline:'2026-10-15',conditions:{blocked:true}},[],'2026-10-14');
  assert.match(hint.text,/H0/);
  assert.match(hint.text,/H2 或 H3/);
  const event=make('2026-10-14',0,{category:'E'});
  assert.equal(event.pressure,0);
});

test('advance retains completed nodes, correction appends, and reopening preserves history',()=>{
  const first=make('2026-10-12');
  const second=advanceEvent(first,'等待回复',at('2026-10-13'));
  assert.equal(first.nodes.length,0);
  assert.equal(second.nodes[0].text,'收集材料');
  assert.equal(second.currentStep,'等待回复');
  assert.equal(second.nextStep,'');
  assert.equal(second.nextMinutes,0);
  const corrected=correctNode(second,second.nodes[0].id,'材料先由同事复核',at('2026-10-13','05:00'));
  assert.equal(corrected.nodes[0].text,'收集材料');
  assert.equal(corrected.corrections[0].note,'材料先由同事复核');
  assert.equal(corrected.history.at(-1).kind,'correction');
  const ended=changeEvent(corrected,{status:'ended',endDisposition:'completed'},at('2026-10-14'));
  assert.equal(currentPressure([ended]),0);
  const reopened=changeEvent(ended,{status:'doing',pressure:1},at('2026-10-15'));
  assert.equal(reopened.closedAt,null);
  assert.equal(reopened.nodes.length,1);
  assert.equal(eventAt(reopened,'2026-10-14').status,'ended');
  assert.equal(eventAt(reopened,'2026-10-15').pressure,1);
  const waiting=changeEvent(first,{status:'waiting'},at('2026-10-12','05:00'));
  assert.equal(waiting.pressure,3);
  assert.equal(currentPressure([waiting]),3);
  assert.throws(()=>changeEvent(first,{status:'ended',endDisposition:'canceled',closeReason:''}),/取消事件时请填写原因/);
});

test('an ended event archives its final step and hides the progress action on ended dates',()=>{
  const initial=make('2026-10-12',2,{currentStep:'搭建连接'});
  const advanced=advanceEvent(initial,'整理问题',{effectiveOn:'2026-10-13'},at('2026-10-15','04:00'));
  const closed=changeEvent(advanced,{status:'ended',endDisposition:'completed'},at('2026-10-15','05:00'));
  const activeCard=eventCardMarkup(eventsAtDate([closed],'2026-10-14')[0],{historical:true});
  assert.match(activeCard,/当前进展/);
  assert.match(activeCard,/data-action="progress"/);
  const archived=eventCardMarkup(eventsAtDate([closed],'2026-10-15')[0]);
  assert.match(archived,/已结束 · 共 2 个阶段/);
  assert.match(archived,/已结束<\/small><strong>整理问题/);
  assert.match(archived,/压力 H2 · 状态 已结束/);
  assert.doesNotMatch(archived,/data-action="progress"|下一步行动|当前进展<\/small>/);
  assert.match(archived,/data-action="stage"/);
  assert.match(archived,/data-action="edit"/);
  const reopened=changeEvent(closed,{status:'doing'},at('2026-10-16','04:00'));
  assert.doesNotMatch(eventCardMarkup(eventsAtDate([reopened],'2026-10-15')[0]),/data-action="progress"/);
  assert.match(eventCardMarkup(eventsAtDate([reopened],'2026-10-16')[0]),/data-action="progress"/);
});

test('editing base priority and category updates the card even while viewing an earlier day',()=>{
  const initial=make('2026-10-12',2,{name:'工位连接',category:'A',priority:'P2'});
  const advanced=advanceEvent(initial,'梳理连接问题',{effectiveOn:'2026-10-13',pressure:1},at('2026-10-15'));
  const edited=updateEventInfo(advanced,{createdOn:'2026-10-12',name:'工位连接',category:'E',priority:'P0',
    pressure:2,status:'doing',coordinatable:'yes',currentStep:'初始文本'},at('2026-10-16'));
  const oldDay=eventsAtDate([edited],'2026-10-12')[0];
  assert.deepEqual([oldDay.category,oldDay.priority,oldDay.pressure],['E','P0',2]);
  assert.equal(eventsAtDate([edited],'2026-10-13')[0].pressure,1);
  const card=eventCardMarkup(oldDay,{historical:true});
  assert.match(card,/<span>E · P0<\/span>/);
  assert.doesNotMatch(card,/<span>E · P0 · H2<\/span>/);
});

test('every new progress immediately archives the former current step and becomes current',()=>{
  const initial=make('2026-10-12',1,{currentStep:'完善界面'});
  const analyzed=advanceEvent(initial,'具体功能分析',at('2026-10-13'));
  assert.deepEqual(analyzed.nodes.map(node=>node.text),['完善界面']);
  assert.equal(analyzed.currentStep,'具体功能分析');
  const implemented=advanceEvent(analyzed,'实现表单',at('2026-10-14'));
  assert.deepEqual(implemented.nodes.map(node=>node.text),['完善界面','具体功能分析']);
  assert.equal(implemented.currentStep,'实现表单');
  assert.equal(implemented.nextStep,'');
  const card=eventCardMarkup(implemented);
  assert.ok(card.indexOf('完善界面')<card.indexOf('具体功能分析'));
  assert.ok(card.indexOf('具体功能分析')<card.indexOf('实现表单'));
  assert.doesNotMatch(card,/验证交互/);
  assert.throws(()=>advanceEvent(implemented,''),/新增的当前进展/);
  const edited=updateEventInfo(implemented,{createdOn:'2026-10-11',name:'界面项目',currentStep:'错误覆盖',nextStep:'错误覆盖'},at('2026-10-15'));
  assert.equal(edited.name,'界面项目');
  assert.equal(edited.createdOn,'2026-10-11');
  assert.equal(edited.currentStep,'实现表单');
  assert.equal(edited.nextStep,'');
  assert.deepEqual(edited.nodes.map(node=>node.text),['完善界面','具体功能分析']);
  const beforeAdvance=updateEventInfo(initial,{createdOn:'2026-10-12',currentStep:'完善初始界面'},at('2026-10-12','05:00'));
  assert.equal(beforeAdvance.currentStep,'完善初始界面');
});

test('daily peak and three-day residual survive ending and cross a week boundary',()=>{
  let e=make('2026-10-11');
  e=changeEvent(e,{pressure:2},at('2026-10-12'));
  e=changeEvent(e,{pressure:1},at('2026-10-13'));
  e=changeEvent(e,{status:'ended'},at('2026-10-14'));
  const rows=pressureHistory([e],'2026-10-11','2026-10-15','2026-10-15');
  assert.deepEqual(rows.map(r=>r.peak),[3,3,2,1,0]);
  assert.equal(rows[3].end,0);
  assert.equal(rows[3].residual,2.5);
  assert.equal(rows[3].load,2.5);
  assert.equal(rows[4].residual,1.7);
  const next=eventWeekSummary({events:[e],eventDays:{}},'2026-10-12','2026-10-15');
  assert.equal(next.rows[2].load,2.5);
  assert.equal(pressureAt([], '2026-10-14').load,null);
});

test('event cards retain active, this-week activity and residual sources without deleting history',()=>{
  const stale=changeEvent(make('2026-10-05',2,{name:'上周完成'}),{status:'ended'},at('2026-10-06'));
  const recent=changeEvent(make('2026-10-10',2,{name:'周末完成'}),{status:'ended'},at('2026-10-11'));
  const worked=changeEvent(make('2026-10-08',0,{name:'本周推进'}),{status:'ended'},at('2026-10-13'));
  const ongoing=make('2026-10-01',1,{name:'持续处理中'});
  const records=[stale,recent,worked,ongoing];
  const names=date=>eventListAtDate(records,date,'2026-10-22').map(e=>e.name);
  assert.deepEqual(names('2026-10-12'),['周末完成','本周推进','持续处理中']);
  assert.deepEqual(names('2026-10-14'),['周末完成','本周推进','持续处理中']);
  assert.deepEqual(names('2026-10-15'),['本周推进','持续处理中']);
  assert.deepEqual(names('2026-10-19'),['持续处理中']);
  assert.deepEqual(names('2026-10-06'),['上周完成','持续处理中']);
  assert.equal(records.length,4);
  assert.equal(eventListAtDate(records,'2026-10-23','2026-10-22').length,0);
});

test('recommendations balance urgency, coordination, waiting, cognition and energy',()=>{
  const urgent=make('2026-10-11',2,{deadline:'2026-10-15',coordinatable:'no'});
  const waiting=make('2026-10-11',3,{name:'等待答复',status:'waiting',nextStep:''});
  const hard=make('2026-10-11',2,{name:'高认知工程',category:'E',priority:'P3',cognitive:'high'});
  const rec=recommendEvents([urgent,waiting,hard],{date:'2026-10-14',load:5,energy:'tired'});
  assert.ok(rec.priority.some(x=>x.eventId===urgent.id));
  assert.ok(rec.coordinate.some(x=>x.eventId===waiting.id));
  assert.ok(rec.waiting.some(x=>x.eventId===waiting.id));
  assert.ok(rec.waiting.some(x=>x.eventId===hard.id));
  assert.match(rec.recovery,/恢复/);
});

test('stable H does not create residue; only the per-event drop does',()=>{
  const stable=make('2026-10-10',3,{name:'持续实验'});
  const ended=changeEvent(make('2026-10-10',2,{name:'已完成汇报'}),{status:'ended'},at('2026-10-14'));
  const row=pressureAt([stable,ended],'2026-10-15','2026-10-15');
  assert.equal(row.end,3);
  assert.equal(row.residual,2);
  assert.equal(row.chronic,0);
  assert.equal(row.load,5);
  assert.deepEqual(row.residualSources.map(source=>source.eventId),[ended.id]);
  assert.equal(pressureAt([stable],'2026-10-15','2026-10-15').residual,0);
});

test('continuous H2/H3 crosses node boundaries, adds at most one per event and stops at ending',()=>{
  let event=make('2026-10-01',2,{name:'长期交付'});
  event=advanceEvent(event,'第二阶段',{effectiveOn:'2026-10-07',pressure:3},at('2026-10-07'));
  assert.deepEqual(sustainedPressure(event,'2026-10-07'),{days:7,bonus:0.5});
  assert.deepEqual(sustainedPressure(event,'2026-10-14'),{days:14,bonus:1});
  let row=pressureAt([event],'2026-10-14','2026-10-14');
  assert.equal(row.residual,0);
  assert.equal(row.chronic,1);
  assert.equal(row.load,4);
  assert.equal(analyzeDailyPlan(eventsAtDate([event],'2026-10-14'),[event.id],row).planLoad,4);
  event=changeEvent(event,{status:'ended'},at('2026-10-15'));
  row=pressureAt([event],'2026-10-15','2026-10-15');
  assert.equal(row.chronic,0);
  assert.equal(sustainedPressure(event,'2026-10-15').days,0);
});

test('ranked recommendations put actionable urgent work before blocked follow-up and optional work',()=>{
  const urgent=make('2026-10-11',2,{name:'必要交付',priority:'P0',coordinatable:'no',deadline:'2026-10-15'});
  const blocked=make('2026-10-11',3,{name:'等待材料',status:'waiting',priority:'P0'});
  const optional=make('2026-10-11',2,{name:'个人实验',priority:'P3',category:'E',cognitive:'high'});
  const rec=recommendEvents([optional,blocked,urgent],{date:'2026-10-15',load:7,energy:'tired'});
  assert.deepEqual(rec.ranked.map(item=>item.eventId),[urgent.id,blocked.id,optional.id]);
  assert.match(rec.ranked[0].reasons.join('；'),/今日截止/);
  assert.match(rec.ranked[1].action,/依赖/);
  assert.match(rec.ranked[2].action,/暂缓/);
  assert.equal(new Set(rec.ranked.map(item=>item.eventId)).size,3);
});

test('doing cards expose the chain and a separate progress action; advancing updates visible steps',()=>{
  const first=make('2026-10-12',2,{name:'实验<资源>'});
  const second=advanceEvent(first,'安排邮寄',at('2026-10-13'));
  const card=eventCardMarkup(second);
  assert.match(card,/链式进展/);
  assert.match(card,/已完成 1 个阶段/);
  assert.ok(card.indexOf('收集材料')<card.indexOf('当前进展'));
  assert.ok(card.indexOf('当前进展')<card.indexOf('安排邮寄'));
  assert.ok(card.indexOf('安排邮寄')<card.indexOf('下一步行动'));
  assert.match(card,/安排邮寄/);
  assert.match(card,/data-action="progress"/);
  assert.match(card,/data-action="stage"/);
  assert.equal((card.match(/class="event-stage-meta"/g)||[]).length,2);
  assert.match(card,/压力 H2 · 状态 处理中 · 可协调性/);
  assert.doesNotMatch(card,/data-action="advance"/);
  assert.match(card,/实验&lt;资源&gt;/);
  assert.doesNotMatch(card,/实验<资源>/);
  const waiting=eventCardMarkup(changeEvent(second,{status:'waiting'},at('2026-10-14')));
  assert.match(waiting,/class="event-chain"/);
  assert.match(waiting,/data-action="edit"/);
  assert.match(waiting,/data-action="progress"/);
  assert.match(waiting,/data-action="stage"/);
  const previous=eventCardMarkup(eventsAtDate([second],'2026-10-12')[0],{historical:true});
  assert.equal((previous.match(/class="event-stage-meta"/g)||[]).length,1);
  assert.doesNotMatch(previous,/安排邮寄/);
});

test('a backdated event appears on its effective day while retaining its actual entry time',()=>{
  const recorded=at('2026-10-15');
  const earlier=createEvent({name:'12 日材料',category:'A',pressure:3,status:'doing',createdOn:'2026-10-12'},recorded);
  const later=createEvent({name:'13 日实验',category:'R',pressure:1,status:'doing',createdOn:'2026-10-13'},recorded);
  assert.equal(eventStartDate(earlier),'2026-10-12');
  assert.equal(earlier.recordedAt,recorded);
  assert.deepEqual(eventsAtDate([earlier,later],'2026-10-12').map(e=>e.name),['12 日材料']);
  assert.deepEqual(eventsAtDate([earlier,later],'2026-10-13').map(e=>e.name),['12 日材料','13 日实验']);
  const moved=changeEvent(later,{status:'waiting',pressure:2},at('2026-10-15','05:00'));
  assert.equal(eventsAtDate([moved],'2026-10-13')[0].status,'doing');
  assert.equal(eventsAtDate([moved],'2026-10-13')[0].pressure,1);
  assert.equal(pressureAt([earlier,later],'2026-10-12','2026-10-15').end,3);
  assert.equal(pressureAt([earlier,later],'2026-10-13','2026-10-15').end,4);
  assert.doesNotMatch(eventCardMarkup(eventsAtDate([earlier],'2026-10-12')[0],{historical:true}),/补记当日压力/);
  assert.throws(()=>createEvent({name:'未来',category:'A',createdOn:'2026-10-16'},recorded),/晚于今天/);
});

test('backdated stages carry forward without later stages rewriting earlier dates',()=>{
  const recorded=at('2026-10-15');
  const initial=createEvent({name:'界面任务',category:'P',createdOn:'2026-10-12',pressure:3,status:'todo',coordinatable:'yes',currentStep:'完善界面'},recorded);
  const analyzed=advanceEvent(initial,'实现功能',{effectiveOn:'2026-10-13',pressure:2,status:'doing',coordinatable:'no'},at('2026-10-15','05:00'));
  const implemented=advanceEvent(analyzed,'联调',{effectiveOn:'2026-10-14',pressure:1,status:'waiting',coordinatable:'yes'},at('2026-10-15','06:00'));
  assert.deepEqual(['2026-10-12','2026-10-13','2026-10-14','2026-10-15'].map(date=>{
    const stage=eventsAtDate([implemented],date)[0];return [stage.currentStep,stage.pressure,stage.status,stage.coordinatable];
  }),[['完善界面',3,'todo','yes'],['实现功能',2,'doing','no'],['联调',1,'waiting','yes'],['联调',1,'waiting','yes']]);
  assert.deepEqual(implemented.nodes.map(node=>[node.text,node.pressure,node.status,node.coordinatable]),
    [['完善界面',3,'todo','yes'],['实现功能',2,'doing','no']]);
  assert.deepEqual(pressureHistory([implemented],'2026-10-12','2026-10-15','2026-10-15').map(row=>row.end),[3,2,1,1]);
  const inserted=advanceEvent(implemented,'补做检查',{effectiveOn:'2026-10-13',pressure:2,status:'doing',coordinatable:'yes'},at('2026-10-15','07:00'));
  assert.equal(eventsAtDate([inserted],'2026-10-12')[0].currentStep,'完善界面');
  assert.equal(eventsAtDate([inserted],'2026-10-13')[0].currentStep,'补做检查');
  assert.equal(eventsAtDate([inserted],'2026-10-14')[0].currentStep,'联调');
  const corrected=reviseStage(implemented,stageAtDate(implemented,'2026-10-12').id,{pressure:0,status:'doing',coordinatable:'unknown'},at('2026-10-15','07:00'));
  assert.equal(eventsAtDate([corrected],'2026-10-12')[0].pressure,0);
  assert.equal(eventsAtDate([corrected],'2026-10-13')[0].pressure,2);
  assert.equal(corrected.nodes[0].pressure,0);
  assert.equal(corrected.pressure,1);
  const infoEdited=updateEventInfo(implemented,{createdOn:'2026-10-12',pressure:0,status:'waiting',coordinatable:'no',currentStep:'不能覆盖当前',nextStep:'不能覆盖下一步'},at('2026-10-15','08:00'));
  assert.deepEqual([eventAt(infoEdited,'2026-10-12').pressure,eventAt(infoEdited,'2026-10-12').status,eventAt(infoEdited,'2026-10-13').pressure],[0,'waiting',2]);
  assert.equal(infoEdited.currentStep,'联调');
  assert.equal(infoEdited.nodes[0].status,'waiting');
  assert.throws(()=>reviseStage(implemented,stageAtDate(implemented,'2026-10-12').id,{status:'ended'}),/后面已有进展/);
});

test('older progress can be inserted ahead of a legacy later metadata change without losing its later state',()=>{
  const recorded=at('2026-10-15');
  let event=createEvent({name:'材料',category:'A',createdOn:'2026-10-12',pressure:3,status:'doing',currentStep:'准备'},recorded);
  event=changeEvent(event,{pressure:1,coordinatable:'no'},at('2026-10-15','05:00'));
  event=advanceEvent(event,'等待回复',{effectiveOn:'2026-10-13',pressure:2,status:'doing',coordinatable:'yes'},at('2026-10-15','06:00'));
  assert.equal(eventsAtDate([event],'2026-10-12')[0].currentStep,'准备');
  assert.equal(eventsAtDate([event],'2026-10-13')[0].currentStep,'等待回复');
  assert.equal(eventsAtDate([event],'2026-10-13')[0].pressure,2);
  assert.equal(event.currentStep,'等待回复');
  assert.equal(event.pressure,1);
  assert.equal(event.coordinatable,'no');
});

test('an omitted stage can be inserted before a later stage without rewriting it',()=>{
  const recorded=at('2026-10-15');
  let event=createEvent({name:'界面',category:'P',createdOn:'2026-10-12',pressure:2,status:'doing',currentStep:'完善界面',nextStep:'功能分析'},recorded);
  event=advanceEvent(event,'最终联调',{effectiveOn:'2026-10-14',pressure:1,status:'doing',coordinatable:'yes'},at('2026-10-15','05:00'));
  event=advanceEvent(event,'具体实现',{effectiveOn:'2026-10-13',pressure:2,status:'doing',coordinatable:'no'},at('2026-10-15','06:00'));
  assert.deepEqual(['2026-10-12','2026-10-13','2026-10-14'].map(date=>eventsAtDate([event],date)[0].currentStep),
    ['完善界面','具体实现','最终联调']);
  assert.deepEqual(event.nodes.map(node=>node.text),['完善界面','具体实现']);
  assert.equal(event.nextStep,'');
  assert.equal(eventAt(event,'2026-10-12').pressure,2);
});

test('correcting an event start date replays history but keeps actual recording and later changes',()=>{
  const recorded=at('2026-10-15');
  let e=createEvent({name:'设备问题',category:'R',pressure:2,createdOn:'2026-10-15'},recorded);
  e=changeEventStart(e,'2026-10-12',at('2026-10-15','05:00'));
  assert.equal(e.recordedAt,recorded);
  assert.equal(e.dateCorrections[0].from,'2026-10-15');
  assert.equal(eventAt(e,'2026-10-12').pressure,2);
  assert.equal(pressureAt([e],'2026-10-15','2026-10-15').residual,0);
  const changed=changeEvent(e,{status:'doing'},at('2026-10-15','06:00'));
  assert.throws(()=>changeEventStart(changed,'2026-10-16',at('2026-10-15','07:00')),/晚于今天/);
});

test('legacy progress edits stay on the same initial node after moving its start date back',()=>{
  let event=make('2026-10-15',2,{currentStep:'证明在路上，已快递运走'});
  event=changeEvent(event,{currentStep:'整理证明材料',pressure:1,status:'waiting'},at('2026-10-15','05:00'));
  event=changeEventStart(event,'2026-10-12',at('2026-10-15','06:00'));
  for(const date of ['2026-10-12','2026-10-13','2026-10-14','2026-10-15']){
    const visible=eventsAtDate([event],date)[0];
    assert.equal(visible.currentStep,'整理证明材料');
    assert.deepEqual(visible.nodes,[]);
    assert.doesNotMatch(eventCardMarkup(visible),/证明在路上|接收快递并分发材料/);
  }
  assert.equal(eventAt(event,'2026-10-12').pressure,2);
  assert.equal(eventAt(event,'2026-10-15').pressure,1);
  assert.equal(eventAt(event,'2026-10-12').status,'doing');
  assert.equal(eventAt(event,'2026-10-15').status,'waiting');
  const advanced=advanceEvent(event,'等待归档',{effectiveOn:'2026-10-15'},at('2026-10-15','07:00'));
  for(const date of ['2026-10-12','2026-10-13','2026-10-14']){
    const visible=eventsAtDate([advanced],date)[0];
    assert.deepEqual(visible.nodes,[]);
    assert.equal(visible.currentStep,'整理证明材料');
  }
  assert.deepEqual(eventsAtDate([advanced],'2026-10-15')[0].nodes.map(node=>node.text),['整理证明材料']);
  assert.deepEqual([eventAt(advanced,'2026-10-15').currentStep,eventAt(advanced,'2026-10-15').nextStep],['等待归档','']);
});

test('a backdated advance of a legacy edited node moves the actual visible step and retains later status',()=>{
  let event=make('2026-10-15',3,{currentStep:'旧文字'});
  event=changeEvent(event,{currentStep:'整理材料',pressure:1,status:'waiting'},at('2026-10-15','05:00'));
  event=changeEventStart(event,'2026-10-12',at('2026-10-15','06:00'));
  event=advanceEvent(event,'提交材料',{effectiveOn:'2026-10-13',pressure:2,status:'doing'},at('2026-10-15','07:00'));
  assert.deepEqual(event.nodes.map(node=>node.text),['整理材料']);
  assert.deepEqual(['2026-10-12','2026-10-13','2026-10-14','2026-10-15'].map(date=>{
    const visible=eventsAtDate([event],date)[0];
    return [visible.nodes.map(node=>node.text),visible.currentStep];
  }),[
    [[], '整理材料'],
    [['整理材料'],'提交材料'],
    [['整理材料'],'提交材料'],
    [['整理材料'],'提交材料'],
  ]);
  assert.deepEqual([event.currentStep,event.nextStep,event.pressure,event.status],['提交材料','',1,'waiting']);
  assert.equal(eventsAtDate([event],'2026-10-12')[0].pressure,3);
});

test('the first new progress creates a completed node even on an edited older event',()=>{
  let event=make('2026-10-15',1,{currentStep:'旧初始进展'});
  event=changeEvent(event,{currentStep:'实际初始进展'},at('2026-10-15','05:00'));
  event=changeEventStart(event,'2026-10-12',at('2026-10-15','06:00'));
  event=advanceEvent(event,'收集信息',{effectiveOn:'2026-10-13'},at('2026-10-15','07:00'));
  assert.deepEqual(event.nodes.map(node=>node.text),['实际初始进展']);
  assert.deepEqual([event.currentStep,event.nextStep],['收集信息','']);
});

test('plan pressure is a selected subset of whole pressure, with energy and history affecting judgment',()=>{
  const recorded=at('2026-10-15');
  const a=createEvent({name:'紧急交付',category:'R',pressure:3,status:'doing',priority:'P0',nextStep:'提交',createdOn:'2026-10-12'},recorded);
  const b=createEvent({name:'工程训练',category:'E',pressure:0,status:'doing',nextStep:'编码',cognitive:'high',nextMinutes:180,createdOn:'2026-10-13'},recorded);
  const row=pressureAt([a,b],'2026-10-15','2026-10-15');
  const onlyEngineering=analyzeDailyPlan(eventsAtDate([a,b],'2026-10-15'),[b.id],row,{energy:'tired'});
  assert.equal(onlyEngineering.selectedPressure,0);
  assert.equal(onlyEngineering.planLoad,row.residual);
  assert.equal(onlyEngineering.overallLoad,row.load);
  assert.equal(onlyEngineering.unselectedPressure,3);
  assert.match(onlyEngineering.reasons.join('；'),/高认知/);
  const both=analyzeDailyPlan(eventsAtDate([a,b],'2026-10-15'),[a.id,b.id],row);
  assert.equal(both.planLoad,row.load);
  assert.equal(both.knownMinutes,undefined);
  assert.doesNotMatch(both.reasons.join('；')+both.action,/预计耗时|已估计/);
  assert.equal(analyzeDailyPlan([a],[a.id],pressureAt([a],'2026-10-12','2026-10-15')).planLoad,null);
});

test('a new event starts with one current step and advances on its first addition',()=>{
  const created=createEvent({name:'新材料',category:'A',createdOn:'2026-10-12',status:'doing',currentStep:'准备材料'},at('2026-10-15'));
  assert.equal(created.nextStep,'');
  assert.equal(created.nextMinutes,0);
  const plan=analyzeDailyPlan([created],[created.id],{date:'2026-10-15',recorded:true,end:1,residual:0});
  assert.deepEqual(plan.blockedIds,[]);
  const rec=recommendEvents([created],{date:'2026-10-15',load:1,energy:'normal'});
  assert.equal(rec.suitable[0].text,'可推进：准备材料。');
  const set=advanceEvent(created,'联系学院',{effectiveOn:'2026-10-13'},at('2026-10-15','05:00'));
  assert.deepEqual(set.nodes.map(node=>node.text),['准备材料']);
  assert.deepEqual([set.currentStep,set.nextStep],['联系学院','']);
});

test('the October 12 two-save legacy event recovers both additions as completed and current',()=>{
  const name='工程实践，搭建工位笔记本连接的流程打通和问题整合';
  const created=createEvent({name,category:'E',createdOn:'2026-10-12',status:'doing',pressure:1,
    currentStep:'初始连接'},at('2026-10-15'));
  const oldTransition={id:'old-advance',kind:'advance',at:at('2026-10-15','06:00'),
    recordedAt:at('2026-10-15','06:00'),snapshot:{...created.history[0].snapshot,
      currentStep:'排查连接',nextStep:'整理问题',pressure:2}};
  const broken={...created,progressModel:undefined,currentStep:'排查连接',nextStep:'整理问题',pressure:2,
    history:[{...created.history[0],snapshot:{...created.history[0].snapshot,nextStep:'排查连接'}},oldTransition],
    nodes:[{id:'existing-node',transitionId:'old-advance',text:'初始连接',completedAt:oldTransition.at,
      pressure:1,status:'doing',coordinatable:'unknown'}]};
  const repaired=repairRetiredProgress(broken);
  assert.equal(repaired.nodes[0].id,'existing-node');
  assert.deepEqual(repaired.nodes.map(node=>node.text),['初始连接','排查连接']);
  assert.equal(repaired.currentStep,'整理问题');
  assert.equal(repaired.nextStep,'');
  assert.equal(eventsAtDate([repaired],'2026-10-12')[0].currentStep,'初始连接');
  assert.deepEqual(eventsAtDate([repaired],'2026-10-12')[0].nodes,[]);
  assert.equal(eventsAtDate([repaired],'2026-10-15')[0].currentStep,'整理问题');
  assert.match(eventCardMarkup(eventsAtDate([repaired],'2026-10-15')[0]),/当前进展<\/small><strong>整理问题/);
  assert.doesNotMatch(eventCardMarkup({...broken,nextStep:'不应显示的旧行动'}),/不应显示的旧行动/);
  assert.equal(repairRetiredProgress(repaired),repaired);
  const continued=advanceEvent(repaired,'下一轮验证',{effectiveOn:'2026-10-15'},at('2026-10-15','07:00'));
  assert.deepEqual(continued.nodes.map(node=>node.text),['初始连接','排查连接','整理问题']);
  assert.equal(continued.currentStep,'下一轮验证');
});
