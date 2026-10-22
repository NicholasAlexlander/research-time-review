export const categories = [
  { key: 'R', label: '科研', color: '#526AD2' },
  { key: 'E', label: '工程', color: '#42A9A1' },
  { key: 'P', label: '工作管理', color: '#D29A50' },
  { key: 'S', label: '自由创作', color: '#B47A9A' },
  { key: 'C', label: '课程', color: '#8D84C4' },
  { key: 'M', label: '汇报沟通', color: '#8997A8' },
  { key: 'A', label: '行政杂务', color: '#A5AEB8' },
];

export const defaultRules = {
  baseMinutes: 480, minimumMinutes: 420, coreMinutes: 240, toleranceMinutes: 20,
  basePoints: 1, corePoints: 1, growthPoints: .5, reviewPoints: .5,
  finishPoints: .5, overtimeShortPoints: .5, overtimeLongPoints: 1,
  procrastinationPenalty: 1, lateTargetPenalty: 1, night1Penalty: 1,
  night2Penalty: 1.5, night3Penalty: 2, artificialPenalty: 1,
  driftPenalty: .5, fatiguePenalty: .5, forcedRestPenalty: 1,
  deductionCap: 2, overtimeFactor: .5, nightFactor: 1, restDayFactor: .25,
  restSuggestMinutes: 120, restForceMinutes: 240,
  restHalfDayMinutes: 360, restStopMinutes: 480,
};

export const clampMinutes = value => Math.max(0, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
export const formatMinutes = n => {
  const v = Math.round(Math.abs(n));
  return `${v >= 60 ? `${Math.floor(v / 60)}h` : ''}${v % 60 ? `${v % 60}m` : v < 60 ? '0m' : ''}`;
};
export function weekStart(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function shiftDate(dateString, days) {
  const d = new Date(`${dateString}T12:00:00`);
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function lateTier(endTime, revised = false) {
  if (!endTime || !/^\d{2}:\d{2}$/.test(endTime)) return 0;
  let [h,m] = endTime.split(':').map(Number);
  let minutes = h * 60 + m;
  if (minutes < 12 * 60) minutes += 1440;
  if (revised) {
    if (minutes >= 1560) return 3; // from 02:00
    if (minutes >= 1470) return 2; // from 00:30
    if (minutes >= 1440) return 1; // from 00:00; 23:00/23:30 have no penalty
    return 0;
  }
  if (minutes > 1560) return 3; // legacy after 02:00
  if (minutes > 1470) return 2; // legacy after 00:30
  if (minutes > 1410) return 1; // legacy after 23:30
  return 0;
}
export function restStatus(balance, rules = defaultRules) {
  if (balance >= rules.restStopMinutes) return { level: 'stop', label: '优先调休', text: '暂停非必要加班，优先把调休余额降至 4h 以下。' };
  if (balance > rules.restHalfDayMinutes) return { level: 'half', label: '安排半天', text: '安排至少半天低负荷工作或调休。' };
  if (balance >= rules.restForceMinutes) return { level: 'force', label: '强制消费区', text: '下一周至少使用 1–2h 调休。' };
  if (balance > rules.restSuggestMinutes) return { level: 'suggest', label: '建议近期使用', text: '近期安排使用调休。' };
  return { level: 'good', label: '余额正常', text: '无需主动处理。' };
}
function add(lines, label, points) { if (points > 0) lines.push({label, points}); }
export function computeDay(day = {}, rules = defaultRules, balanceBefore = 0) {
  const isRest = day.dayMode === 'rest' || day.dayMode === 'shiftRest';
  const isExtra = day.dayMode === 'extra';
  const canPenalize = !isRest && !isExtra;
  const t = Object.fromEntries(categories.map(c => [c.key, isRest ? 0 : clampMinutes(day.times?.[c.key])]));
  const effective = t.R + t.E;
  const total = Object.values(t).reduce((a,b)=>a+b,0);
  const normalOvertime = isRest || isExtra ? 0 : clampMinutes(day.normalOvertime);
  const nightOvertime = isRest || isExtra ? 0 : clampMinutes(day.nightOvertime);
  const usedRest = day.dayMode === 'shiftRest' || (isRest && day.ruleVersion >= 2) || isExtra ? 0 : clampMinutes(day.usedRest);
  const qualifying = day.overtimeReason === 'necessary';
  const overtime = isExtra ? total : qualifying ? normalOvertime + nightOvertime : 0;
  const earnedRest = isExtra ? Math.round(total * rules.restDayFactor) : qualifying ? Math.round(normalOvertime * rules.overtimeFactor + nightOvertime * rules.nightFactor) : 0;
  const lines = [], penalties = [];
  const revisedGoal = day.ruleVersion >= 2;
  const baseGoal = Math.max(0, clampMinutes(day.baseGoal ?? (revisedGoal ? rules.minimumMinutes : rules.baseMinutes)) - usedRest);
  const coreGoal = clampMinutes(day.coreGoal ?? rules.coreMinutes);
  const meetsBase = total + (revisedGoal ? 0 : rules.toleranceMinutes) >= baseGoal;
  const meetsCore = effective + rules.toleranceMinutes >= coreGoal;
  add(lines, '完成基础工时', !isExtra && !isRest && meetsBase && baseGoal > 0 ? rules.basePoints : 0);
  add(lines, '完成核心时间块', !isExtra && !isRest && meetsCore && coreGoal > 0 ? rules.corePoints : 0);
  add(lines, '长期能力建设', !isRest && day.growthDone ? rules.growthPoints : 0);
  add(lines, '完成每日复盘', !isRest && day.reviewDone ? rules.reviewPoints : 0);
  add(lines, '正常结束工作', !isExtra && !isRest && meetsBase && !normalOvertime && !nightOvertime && !day.procrastinated && !day.artificialOvertime ? rules.finishPoints : 0);
  add(lines, '合理加班', !isRest && overtime >= 60 ? rules.overtimeLongPoints : !isRest && overtime >= 30 ? rules.overtimeShortPoints : 0);
  const outputPoints = Math.max(0, Number(day.outputPoints) || 0);
  add(lines, '专项产出（手动）', !isRest ? outputPoints : 0);
  add(penalties, '自身拖延导致加班', canPenalize && day.procrastinated && (normalOvertime + nightOvertime > 0) ? rules.procrastinationPenalty : 0);
  const revisedNight = day.ruleVersion >= 3;
  add(penalties, '23:00 未达基础工时（旧规则）', !revisedNight && canPenalize && day.lateTargetSelf ? rules.lateTargetPenalty : 0);
  const tier = !canPenalize || day.p0Emergency ? 0 : lateTier(day.endTime, revisedNight);
  add(penalties, (revisedNight ? ['','00:00 后工作','00:30 后工作','02:00 后工作'] : ['','23:30 后工作','00:30 后工作','02:00 后工作'])[tier], tier ? rules[`night${tier}Penalty`] : 0);
  add(penalties, '为刷积分延长工作', canPenalize && day.artificialOvertime ? rules.artificialPenalty : 0);
  add(penalties, '无意识注意力漂移 ≥1h', canPenalize && day.drift ? rules.driftPenalty : 0);
  add(penalties, '疲劳后仍增加任务', canPenalize && day.fatigue ? rules.fatiguePenalty : 0);
  add(penalties, '强制调休区仍无必要加班', canPenalize && balanceBefore >= rules.restForceMinutes && day.unnecessaryOvertime && overtime > 0 ? rules.forcedRestPenalty : 0);
  const bonus = lines.reduce((s,x)=>s+x.points,0);
  const rawPenalty = penalties.reduce((s,x)=>s+x.points,0);
  const deduction = Math.min(rawPenalty, rules.deductionCap);
  const redeemedPoints = Math.max(0, Number(day.redeemedPoints) || 0);
  return { times:t, effective, total, baseGoal, coreGoal, meetsBase, meetsCore, bonus, rawPenalty,
    deduction, net: Math.round((bonus - deduction - redeemedPoints)*100)/100, redeemedPoints,
    lines, penalties, overtime, earnedRest, usedRest,
    balance: Math.max(0,balanceBefore + earnedRest - usedRest),
    restShortfall: Math.max(0,usedRest - balanceBefore - earnedRest) };
}
export function computeLedger(days, rules = defaultRules, openingRest = 0, openingPoints = 0) {
  let rest = clampMinutes(openingRest), points = Number(openingPoints) || 0;
  const results = {};
  for (const date of Object.keys(days).sort()) {
    const value = computeDay(days[date],rules,rest);
    rest = value.balance;
    points = Math.round((points + value.net)*100)/100;
    results[date] = {...value, accumulatedPoints:points};
  }
  return {results,rest,points};
}
export function computeWeek(days, results, start) {
  const dates = Array.from({length:7},(_,i)=>shiftDate(start,i));
  const entries = dates.filter(d=>days[d]);
  const byCategory = Object.fromEntries(categories.map(c=>[c.key,0]));
  let total=0,effective=0,points=0,earnedRest=0,usedRest=0,activeRest=0,passiveRest=0,unclassifiedRest=0,outputs=0;
  for (const date of entries) {
    const v=results[date];
    for (const c of categories) byCategory[c.key]+=v.times[c.key];
    total+=v.total; effective+=v.effective; points+=v.net;
    earnedRest+=v.earnedRest; usedRest+=v.usedRest;
    if(v.usedRest){
      if(days[date].usedRestNature==='active')activeRest+=v.usedRest;
      else if(days[date].usedRestNature==='passive')passiveRest+=v.usedRest;
      else unclassifiedRest+=v.usedRest;
    }
    if(!['rest','shiftRest'].includes(days[date].dayMode))outputs+=(days[date].outputs||[]).filter(s=>String(s).trim()).length;
  }
  return {dates,entries,byCategory,total,effective,points:Math.round(points*100)/100,earnedRest,usedRest,
    activeRest,passiveRest,unclassifiedRest,activeRestShare:usedRest?Math.round(activeRest/usedRest*1000)/10:0,outputs};
}

// This independent indicator uses only counted E time; each Monday starts at zero.
export function computeEngineeringWeek(results,start,asOfDate) {
  const dates=Array.from({length:7},(_,i)=>shiftDate(start,i));
  const targetMinutes=210, dailyTargetMinutes=30;
  const daily=[];
  let cumulative=0,currentActualMinutes=0,currentExpectedMinutes=0,currentAnxietyMinutes=0;
  for(const [index,date] of dates.entries()){
    cumulative+=results[date]?.times.E||0;
    const observed=date<=asOfDate;
    const expectedMinutes=dailyTargetMinutes*(index+1);
    const anxietyMinutes=observed?Math.max(0,expectedMinutes-cumulative):null;
    daily.push({date,expectedMinutes,actualMinutes:cumulative,anxietyMinutes,observed});
    if(observed){currentActualMinutes=cumulative;currentExpectedMinutes=expectedMinutes;currentAnxietyMinutes=anxietyMinutes}
  }
  return {targetMinutes,dailyTargetMinutes,daily,currentActualMinutes,currentExpectedMinutes,currentAnxietyMinutes,
    weekActualMinutes:cumulative,finalAnxietyMinutes:Math.max(0,targetMinutes-cumulative),
    finalIsProvisional:asOfDate<dates[6]};
}
