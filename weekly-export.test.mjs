import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRules} from './calc.mjs';
import {makeWeeklySnapshot,weeklySnapshotMarkdown} from './weekly-export.mjs';
import {createEvent,changeEvent,advanceEvent,reviseStage} from './events.mjs';

test('weekly export is scoped to seven dates and keeps raw entries beside calculated values',()=>{
  const state={rules:{...defaultRules},openingRest:60,openingPoints:2,weeks:{'2026-09-21':'本周复现了一个 Bug。'},days:{
    '2026-09-19':{times:{R:480},normalOvertime:120,overtimeReason:'necessary'},
    '2026-09-21':{dayMode:'work',ruleVersion:3,times:{R:300,E:120},usedRest:30,normalOvertime:45,overtimeReason:'necessary',outputs:['等价性测试','报告'],blocker:'工具输出不一致',nextAction:'明天检查日志',observation:'发现 A|B\n另起一行'},
    '2026-09-22':{dayMode:'shiftRest',ruleVersion:3,times:{R:480},outputs:['隐藏的旧产出'],dailyLife:'个人事务',tomorrowPlan:'明天复核参数'},
    '2026-09-26':{dayMode:'extra',ruleVersion:3,times:{R:60,E:60},outputs:['额外测试']},
    '2026-09-28':{dayMode:'work',ruleVersion:3,times:{R:300},usedRest:60,blocker:'future secret'},
  }};
  const snapshot=makeWeeklySnapshot(state,'2026-09-21',new Date('2026-09-27T12:00:00Z'),'synced');
  assert.equal(snapshot.schema,'research-time-weekly-export/v1');
  assert.equal(snapshot.week.end,'2026-09-27');
  assert.equal(snapshot.days.length,7);
  assert.equal(snapshot.summary.recordedDays,3);
  assert.equal(snapshot.summary.totalMinutes,540);
  assert.equal(snapshot.summary.effectiveMinutes,540);
  assert.equal(snapshot.summary.outputs,3);
  assert.equal(snapshot.summary.restBalanceAtWeekStartMinutes,120);
  assert.equal(snapshot.summary.restBalanceAtWeekEndMinutes,143);
  assert.equal(snapshot.summary.currentRestBalanceMinutes,83);
  assert.equal(snapshot.days[0].originalEntry.observation,'发现 A|B\n另起一行');
  assert.equal(snapshot.days[1].calculated.totalMinutes,0);
  assert.equal(snapshot.days[1].originalEntry.times.R,480);
  assert.equal(snapshot.days[2].recorded,false);
  const markdown=weeklySnapshotMarkdown(snapshot);
  assert.match(markdown,/R \+ E/);
  assert.match(markdown,/明天复核参数/);
  assert.match(markdown,/23:30 前 45m/);
  assert.match(markdown,/发现 A\\\|B/);
  assert.match(markdown,/未记录工时。/);
  assert.doesNotMatch(markdown,/隐藏的旧产出/);
  assert.match(JSON.stringify(snapshot),/隐藏的旧产出/);
  assert.doesNotMatch(markdown,/future secret/);
  assert.doesNotMatch(JSON.stringify(snapshot),/future secret/);
});

test('event-only week exports pressure timeline, immutable chain and plan adjustments without future changes',()=>{
  const base={name:'实验资源协调',category:'R',priority:'P1',pressure:2,coordinatable:'yes',status:'doing',
    deadline:'2026-10-15',currentStep:'已申请设备',nextStep:'确认时间',notes:'资源依赖'};
  const event={...base,id:'event-1',createdAt:'2026-10-12T04:00:00Z',updatedAt:'2026-10-19T04:00:00Z',
    nodes:[{id:'node-1',text:'联系负责人',completedAt:'2026-10-13T04:00:00Z',status:'doing'}],
    corrections:[{id:'correction-1',nodeId:'node-1',note:'日期是周二',at:'2026-10-14T04:00:00Z'}],
    history:[{id:'h1',at:'2026-10-12T04:00:00Z',kind:'create',snapshot:{...base}},
      {id:'h2',at:'2026-10-13T04:00:00Z',kind:'advance',snapshot:{...base,currentStep:'确认时间',nextStep:'准备材料'}},
      {id:'h3',at:'2026-10-19T04:00:00Z',kind:'update',snapshot:{...base,notes:'future secret',pressure:3}}]};
  const state={rules:{...defaultRules},openingRest:0,openingPoints:0,weeks:{},days:{},events:[event],
    eventDays:{'2026-10-13':{energy:'tired',plannedEventIds:['event-1'],adjustments:[{at:'2026-10-13T04:00:00Z',original:'查资料',added:'确认设备',deferred:'写作',coordinate:'负责人',reason:'设备冲突'}]}}};
  const snapshot=makeWeeklySnapshot(state,'2026-10-12',new Date('2026-10-14T12:00:00Z'));
  assert.equal(snapshot.summary.recordedDays,0);
  assert.equal(snapshot.eventManagement.newEvents,1);
  assert.equal(snapshot.eventManagement.advancedNodes,1);
  assert.equal(snapshot.eventManagement.events[0].completedNodes[0].text,'联系负责人');
  assert.equal(snapshot.eventManagement.events[0].corrections[0].note,'日期是周二');
  assert.equal(snapshot.eventManagement.events[0].snapshot.notes,'资源依赖');
  assert.equal(snapshot.days[1].eventRecord.energy,'tired');
  assert.equal(snapshot.days[1].eventRecord.adjustments[0].deferred,'写作');
  const markdown=weeklySnapshotMarkdown(snapshot);
  assert.match(markdown,/事务负荷与恢复/);
  assert.match(markdown,/计划调整/);
  assert.match(markdown,/联系负责人/);
  assert.doesNotMatch(JSON.stringify(snapshot),/future secret/);
});

test('export of an empty week keeps missing days distinct from zero-hour saved days',()=>{
  const state={rules:{...defaultRules},openingRest:0,openingPoints:0,weeks:{},days:{'2026-09-21':{dayMode:'rest',ruleVersion:3,times:{R:0}}}};
  const snapshot=makeWeeklySnapshot(state,'2026-09-21');
  assert.equal(snapshot.days[0].recorded,true);
  assert.equal(snapshot.days[1].recorded,false);
  assert.equal(snapshot.summary.recordedDays,1);
  assert.equal(snapshot.summary.byCategory.R.percentage,0);
  assert.throws(()=>makeWeeklySnapshot(state,'2026-09-22'),/周一/);
});
test('weekly snapshot keeps rest nature and engineering progress for recorded and missing days',()=>{
  const state={rules:{...defaultRules},openingRest:300,openingPoints:0,weeks:{},days:{
    '2026-09-28':{dayMode:'work',ruleVersion:3,times:{R:180},usedRest:240,usedRestNature:'active'},
    '2026-09-29':{dayMode:'work',ruleVersion:3,times:{E:90},usedRest:90,usedRestNature:'passive'},
    '2026-09-30':{dayMode:'work',ruleVersion:3,times:{E:40},usedRest:30},
  }};
  const snapshot=makeWeeklySnapshot(state,'2026-09-28',new Date('2026-09-30T12:00:00Z'),'synced');
  assert.equal(snapshot.summary.activeRestMinutes,240);
  assert.equal(snapshot.summary.passiveRestMinutes,90);
  assert.equal(snapshot.summary.unclassifiedRestMinutes,30);
  assert.equal(snapshot.summary.activeRestSharePercent,66.7);
  assert.equal(snapshot.days[0].calculated.usedRestNature,'active');
  assert.equal(snapshot.days[1].calculated.usedRestNature,'passive');
  assert.equal(snapshot.days[2].calculated.usedRestNature,'unclassified');
  assert.equal(snapshot.days[3].engineering.expectedMinutes,120);
  assert.equal(snapshot.days[3].engineering.anxietyMinutes,null);
  assert.equal(snapshot.summary.engineering.targetMinutes,210);
  assert.equal(snapshot.summary.engineering.currentAnxietyMinutes,0);
  assert.equal(snapshot.summary.engineering.finalAnxietyMinutes,80);
  assert.equal(snapshot.summary.engineering.finalIsProvisional,true);
  const markdown=weeklySnapshotMarkdown(snapshot);
  assert.match(markdown,/主动调休.*4h/);
  assert.match(markdown,/被动抵扣.*1h30m/);
  assert.match(markdown,/调休性质：未标注/);
  assert.match(markdown,/周末暂估工程焦虑值：1h20m/);
  assert.match(markdown,/该日尚未到来/);
});

test('weekly export dates events by occurrence and includes current plan assessment',()=>{
  const at='2026-10-15T03:00:00.000Z';
  let event=createEvent({name:'材料协作',category:'A',pressure:3,status:'doing',nextStep:'沟通',createdOn:'2026-10-12'},at);
  event=changeEvent(event,{pressure:1},'2026-10-16T04:00:00.000Z');
  const state={rules:{...defaultRules},openingRest:0,openingPoints:0,weeks:{},days:{},events:[event],eventDays:{
    '2026-10-15':{initialPlanEventIds:[event.id],plannedEventIds:[event.id],energy:'tired',planChanges:[{at,action:'add',eventId:event.id}]},
  }};
  const snapshot=makeWeeklySnapshot(state,'2026-10-12',new Date(at));
  assert.equal(snapshot.eventManagement.newEvents,1);
  assert.equal(snapshot.eventManagement.rows[0].end,3);
  assert.equal(snapshot.eventManagement.rows[1].end,3);
  assert.equal(snapshot.eventManagement.rows[3].residual,0);
  assert.equal(snapshot.days[3].eventRecord.planAssessment.selectedPressure,3);
  assert.equal(snapshot.days[3].eventRecord.planAssessment.planLoad,3);
  assert.equal(snapshot.eventManagement.events[0].createdOn,'2026-10-12');
  assert.equal(snapshot.eventManagement.events[0].recordedAt,at);
  const markdown=weeklySnapshotMarkdown(snapshot);
  assert.match(markdown,/事件发生日期：2026-10-12；实际录入/);
  assert.match(markdown,/计划压力：所选 H 3/);
  assert.match(markdown,/计划选择变更/);
});

test('weekly export keeps each historical node effective date and ending state',()=>{
  const at='2026-10-15T03:00:00.000Z';
  let event=createEvent({name:'项目',category:'P',createdOn:'2026-10-12',currentStep:'完善界面',nextStep:'分析功能',pressure:3,status:'doing',coordinatable:'yes'},at);
  event=advanceEvent(event,'实现',{effectiveOn:'2026-10-13',pressure:1,status:'waiting',coordinatable:'no'},'2026-10-15T04:00:00.000Z');
  const snapshot=makeWeeklySnapshot({rules:{...defaultRules},openingRest:0,openingPoints:0,weeks:{},days:{},events:[event],eventDays:{}},'2026-10-12',new Date('2026-10-15T05:00:00Z'));
  assert.equal(snapshot.eventManagement.rows[0].end,3);
  assert.equal(snapshot.eventManagement.rows[1].end,1);
  assert.equal(snapshot.eventManagement.events[0].completedNodes[0].pressure,3);
  assert.equal(snapshot.eventManagement.events[0].completedNodes[0].coordinatable,'yes');
  assert.match(weeklySnapshotMarkdown(snapshot),/完善界面（生效 .*结束时 H3 \/ 处理中 \/ 可协调/);
});

test('weekly export retains candidate plan classification and text correction audit',()=>{
  const stamp='2026-10-15T04:00:00.000Z';
  let formal=createEvent({name:'正式实验',category:'R',pressure:2,status:'doing',createdOn:'2026-10-12',currentStep:'旧描述'},stamp);
  formal=advanceEvent(formal,'新节点',{effectiveOn:'2026-10-13'},stamp);
  const first=formal.history.find(change=>change.kind==='create');
  formal=reviseStage(formal,first.id,{currentStep:'更准确的描述'},'2026-10-15T05:00:00.000Z');
  const candidate=createEvent({name:'候补工程',category:'E',pressure:3,status:'doing',createdOn:'2026-10-12',currentStep:'构建'},stamp);
  const state={rules:{...defaultRules},openingRest:0,openingPoints:0,weeks:{},days:{},events:[formal,candidate],eventDays:{
    '2026-10-15':{plannedEventIds:[formal.id,candidate.id],candidateEventIds:[candidate.id],planChanges:[{action:'candidate',eventId:candidate.id,at:stamp}]}}};
  const snapshot=makeWeeklySnapshot(state,'2026-10-12',new Date('2026-10-15T12:00:00.000Z'));
  assert.equal(snapshot.days[3].eventRecord.planAssessment.selectedPressure,2);
  assert.equal(snapshot.days[3].eventRecord.planAssessment.candidatePressure,3);
  assert.equal(snapshot.days[3].eventRecord.planAssessment.overallLoad,5);
  assert.equal(snapshot.eventManagement.events[0].completedNodes[0].text,'更准确的描述');
  assert.equal(snapshot.eventManagement.events[0].corrections[0].oldText,'旧描述');
  const markdown=weeklySnapshotMarkdown(snapshot);
  assert.match(markdown,/候补工程（候补）/);
  assert.match(markdown,/旧描述 → 更准确的描述/);
});
