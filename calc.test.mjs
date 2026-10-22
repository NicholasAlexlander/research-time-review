import test from 'node:test';
import assert from 'node:assert/strict';
import {computeDay,computeLedger,computeWeek,computeEngineeringWeek,defaultRules,lateTier,restStatus} from './calc.mjs';

test('effective time is R+E; other categories count only toward total',()=>{
  const day=computeDay({times:{R:124,E:95,P:30,S:20,C:120,M:15,A:5}});
  assert.equal(day.effective,219);
  assert.equal(day.total,409);
  assert.equal(day.meetsCore,false);
});
test('reasonable overtime earns at most one point and night time returns full rest',()=>{
  const day=computeDay({times:{R:450,E:60},normalOvertime:120,nightOvertime:40,overtimeReason:'necessary',endTime:'00:10'});
  assert.equal(day.earnedRest,100);
  assert.equal(day.lines.find(x=>x.label==='合理加班').points,1);
  assert.equal(day.penalties.find(x=>x.label==='23:30 后工作').points,1);
});
test('night penalty selects the latest tier once, with daily penalty cap',()=>{
  assert.equal(lateTier('23:31'),1);
  assert.equal(lateTier('00:31'),2);
  assert.equal(lateTier('02:01'),3);
  const day=computeDay({endTime:'02:05',procrastinated:true,normalOvertime:90,lateTargetSelf:true,drift:true,overtimeReason:'self'});
  assert.equal(day.penalties.filter(x=>x.label.includes('后工作')).length,1);
  assert.ok(day.rawPenalty>2);
  assert.equal(day.deduction,2);
  assert.equal(day.earnedRest,0);
});
test('rest carries over across weeks and spending lowers the daily target',()=>{
  const days={'2026-09-20':{times:{R:480},normalOvertime:120,overtimeReason:'necessary'},'2026-09-21':{times:{R:420},usedRest:60}};
  const ledger=computeLedger(days,defaultRules,35,2);
  assert.equal(ledger.results['2026-09-20'].balance,95);
  assert.equal(ledger.results['2026-09-21'].baseGoal,420);
  assert.equal(ledger.results['2026-09-21'].meetsBase,true);
  assert.equal(ledger.rest,35);
  assert.equal(computeWeek(days,ledger.results,'2026-09-21').earnedRest,0);
  assert.equal(restStatus(240).level,'force');
});
test('day off consumes recorded leave without counting hidden work fields',()=>{
  const day={dayMode:'rest',times:{R:480,E:60},normalOvertime:120,overtimeReason:'necessary',growthDone:true,usedRest:120,outputs:['old hidden work']};
  const value=computeDay(day,defaultRules,180);
  assert.equal(value.total,0);
  assert.equal(value.effective,0);
  assert.equal(value.earnedRest,0);
  assert.equal(value.net,0);
  assert.equal(value.balance,60);
  assert.equal(computeWeek({'2026-09-28':day},{'2026-09-28':value},'2026-09-28').outputs,0);
});
test('extra work on a rest day earns one quarter of all logged time',()=>{
  const value=computeDay({dayMode:'extra',times:{R:120,E:60,P:60},normalOvertime:999,nightOvertime:999,overtimeReason:'self'},defaultRules,0);
  assert.equal(value.effective,180);
  assert.equal(value.total,240);
  assert.equal(value.overtime,240);
  assert.equal(value.earnedRest,60);
  assert.equal(value.lines.some(line=>line.label==='完成基础工时'),false);
});
test('rest day extra work never incurs workday deductions, even on an older saved entry',()=>{
  const entry={dayMode:'extra',ruleVersion:3,times:{M:100},endTime:'10:00',
    normalOvertime:60,nightOvertime:30,overtimeReason:'necessary',procrastinated:true,
    drift:true,fatigue:true,artificialOvertime:true,unnecessaryOvertime:true,lateTargetSelf:true};
  for(const ruleVersion of [undefined,3]){
    const value=computeDay({...entry,ruleVersion},defaultRules,480);
    assert.equal(value.total,100);
    assert.equal(value.overtime,100);
    assert.equal(value.earnedRest,25);
    assert.equal(value.rawPenalty,0);
    assert.equal(value.deduction,0);
    assert.deepEqual(value.penalties,[]);
    assert.equal(value.net,1);
  }
  const shifted=computeDay({...entry,dayMode:'shiftWork'},defaultRules,480);
  assert.ok(shifted.rawPenalty>0);
});
test('legacy saved days remain on their old scoring rules',()=>{
  const value=computeDay({times:{R:480},normalOvertime:120,overtimeReason:'necessary'},defaultRules,0);
  assert.equal(value.earnedRest,60);
  assert.equal(value.total,480);
});
test('normal workday uses a seven hour minimum minus spent leave',()=>{
  const day=computeDay({dayMode:'work',ruleVersion:2,times:{R:300},usedRest:120},defaultRules,180);
  assert.equal(day.baseGoal,300);
  assert.equal(day.meetsBase,true);
  assert.equal(day.balance,60);
  assert.equal(computeDay({dayMode:'work',ruleVersion:2,times:{R:299},usedRest:120},defaultRules,180).meetsBase,false);
});
test('rest use nature changes weekly observations without changing balance, goal or points',()=>{
  const days={
    '2026-09-28':{dayMode:'work',ruleVersion:3,times:{R:180},usedRest:240,usedRestNature:'active'},
    '2026-09-29':{dayMode:'work',ruleVersion:3,times:{R:330},usedRest:90,usedRestNature:'passive'},
    '2026-09-30':{dayMode:'work',ruleVersion:3,times:{R:390},usedRest:30},
  };
  const ledger=computeLedger(days,defaultRules,500);
  const week=computeWeek(days,ledger.results,'2026-09-28');
  assert.equal(week.usedRest,360);
  assert.equal(week.activeRest,240);
  assert.equal(week.passiveRest,90);
  assert.equal(week.unclassifiedRest,30);
  assert.equal(week.activeRestShare,66.7);
  const swapped=computeDay({...days['2026-09-28'],usedRestNature:'passive'},defaultRules,500);
  assert.equal(swapped.baseGoal,ledger.results['2026-09-28'].baseGoal);
  assert.equal(swapped.net,ledger.results['2026-09-28'].net);
  assert.equal(swapped.balance,ledger.results['2026-09-28'].balance);
});
test('engineering proxy uses E only, clamps at zero and restarts each Monday',()=>{
  const days={
    '2026-09-27':{dayMode:'extra',times:{E:180}},
    '2026-09-28':{dayMode:'work',times:{R:400,C:180}},
    '2026-09-30':{dayMode:'work',times:{E:90}},
    '2026-10-02':{dayMode:'work',times:{E:40}},
  };
  const ledger=computeLedger(days);
  const wednesday=computeEngineeringWeek(ledger.results,'2026-09-28','2026-09-30');
  assert.deepEqual(wednesday.daily.slice(0,3).map(d=>d.anxietyMinutes),[30,60,0]);
  assert.equal(wednesday.daily[3].anxietyMinutes,null);
  assert.equal(wednesday.currentActualMinutes,90);
  assert.equal(wednesday.currentAnxietyMinutes,0);
  assert.equal(wednesday.finalAnxietyMinutes,80);
  assert.equal(wednesday.finalIsProvisional,true);
  const sunday=computeEngineeringWeek(ledger.results,'2026-09-28','2026-10-04');
  assert.equal(sunday.weekActualMinutes,130);
  assert.equal(sunday.finalAnxietyMinutes,80);
  assert.equal(sunday.finalIsProvisional,false);
  const next=computeEngineeringWeek(ledger.results,'2026-10-05','2026-10-05');
  assert.equal(next.currentActualMinutes,0);
  assert.equal(next.currentAnxietyMinutes,30);
  const advance=computeEngineeringWeek(computeLedger({'2026-10-05':{dayMode:'work',times:{E:210}}}).results,'2026-10-05','2026-10-11');
  assert.equal(advance.daily[6].anxietyMinutes,0);
});
test('changing a workday to rest consumes no accrued leave',()=>{
  const value=computeDay({dayMode:'shiftRest',ruleVersion:2,times:{R:300},usedRest:120,outputPoints:2},defaultRules,180);
  assert.equal(value.total,0);
  assert.equal(value.net,0);
  assert.equal(value.usedRest,0);
  assert.equal(value.balance,180);
});
test('a rest day changed to a workday gets ordinary work scoring',()=>{
  const value=computeDay({dayMode:'shiftWork',ruleVersion:2,times:{R:420},usedRest:0},defaultRules,0);
  assert.equal(value.baseGoal,420);
  assert.equal(value.meetsBase,true);
  assert.equal(value.earnedRest,0);
  assert.ok(value.lines.some(line=>line.label==='完成基础工时'));
  assert.equal(computeDay({dayMode:'extra',ruleVersion:2,times:{R:420}},defaultRules,0).earnedRest,105);
});
test('ordinary rest uses no leave while a legacy workday keeps its old goal',()=>{
  const resting=computeDay({dayMode:'rest',ruleVersion:2,usedRest:120,times:{R:300}},defaultRules,180);
  assert.equal(resting.usedRest,0);
  assert.equal(resting.balance,180);
  const old=computeDay({dayMode:'work',times:{R:420}},defaultRules,0);
  assert.equal(old.baseGoal,480);
  assert.equal(old.meetsBase,false);
});
test('revised night rule starts at midnight and ignores the old 23:00 flag',()=>{
  for(const time of ['23:00','23:30','23:59']){
    const day=computeDay({dayMode:'work',ruleVersion:3,endTime:time,lateTargetSelf:true});
    assert.equal(day.penalties.length,0,time);
  }
  assert.equal(lateTier('00:00',true),1);
  assert.equal(lateTier('00:29',true),1);
  assert.equal(lateTier('00:30',true),2);
  assert.equal(lateTier('02:00',true),3);
  const midnight=computeDay({dayMode:'work',ruleVersion:3,endTime:'00:00'});
  assert.deepEqual(midnight.penalties,[{label:'00:00 后工作',points:1}]);
  assert.equal(computeDay({dayMode:'work',ruleVersion:3,endTime:'00:30'}).rawPenalty,1.5);
  assert.equal(computeDay({dayMode:'work',ruleVersion:3,endTime:'02:00'}).deduction,2);
  assert.equal(computeDay({dayMode:'work',ruleVersion:2,endTime:'23:31'}).rawPenalty,1);
});
