import {categories,clampMinutes,computeLedger,computeWeek,computeEngineeringWeek,formatMinutes,shiftDate,weekStart} from './calc.mjs';
import {daySchedule} from './calendar.mjs';
import {eventAt,eventWeekSummary,pressureBand,recommendEvents,highPressureDays,energyLabels,eventStatuses,eventsAtDate,eventStartDate} from './events.mjs';
import {analyzeDailyPlan} from './plan.mjs';

const percent=(part,total)=>total?Math.round(part/total*1000)/10:0;
const signed=value=>`${value>=0?'+':''}${value}`;
const overtimeReasons={necessary:'实际任务需要或有效工作延长',self:'自身拖延补工',artificial:'无必要延长'};
const flagLabels={growthDone:'长期能力建设',reviewDone:'完成每日复盘',procrastinated:'自身拖延导致加班',lateTargetSelf:'旧规则 23:00 未达标',drift:'注意力漂移',fatigue:'疲劳仍增加任务',artificialOvertime:'人为制造加班',unnecessaryOvertime:'强制调休区无必要加班',p0Emergency:'P0 紧急事件'};
const safeText=value=>String(value??'').replace(/\r\n?/g,'\n').trim();
const inline=value=>safeText(value).replace(/\s*\n\s*/g,' / ').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/([\\`*_\[\]])/g,'\\$1').replaceAll('|','\\|');
const quote=value=>safeText(value).split('\n').map(line=>`> ${inline(line)||' '}`).join('\n');
const restNatureLabel={active:'主动调休',passive:'被动抵扣',unclassified:'未标注'};
const dateInShanghai=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);

export function dayModeLabel(date,entry){
  const scheduledRest=daySchedule(date).rest;
  if(entry.dayMode==='shiftRest')return '工作日调整为休息日';
  if(entry.dayMode==='shiftWork')return '休息日调整为工作日';
  if(entry.dayMode==='extra')return '休息日额外工作';
  if(entry.dayMode==='rest'&&!scheduledRest)return entry.usedRest?'旧版整日调休记录':'工作日调整为休息日（旧记录）';
  if(!entry.dayMode&&scheduledRest&&Object.values(entry.times||{}).some(Number))return '休息日工作（旧记录，沿用原核算）';
  return scheduledRest?'正常休息日':'正常工作日';
}

export function makeWeeklySnapshot(state,start,exportedAt=new Date(),sourceSync='unknown'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||weekStart(start)!==start)throw Error('需要选择周一作为周起始日');
  const end=shiftDate(start,6);
  const ledger=computeLedger(state.days,state.rules,state.openingRest,state.openingPoints);
  const week=computeWeek(state.days,ledger.results,start);
  const engineering=computeEngineeringWeek(ledger.results,start,dateInShanghai(exportedAt));
  const exportDate=dateInShanghai(exportedAt);
  const eventSummary=eventWeekSummary(state,start,exportDate,ledger.results);
  const eventCutoff=exportDate<end?exportDate:end;
  const eventRow=eventSummary.rows.find(row=>row.date===eventCutoff);
  const eventSnapshots=eventSummary.events.map(event=>{
    const atEnd=eventAt(event,eventCutoff);
    if(!atEnd)return null;
    return {id:event.id,createdAt:event.createdAt,createdOn:eventStartDate(event),recordedAt:event.recordedAt||event.createdAt,asOf:eventCutoff,snapshot:atEnd,
      completedNodes:(event.nodes||[]).filter(node=>dateInShanghai(new Date(node.completedAt))<=eventCutoff),
      corrections:(event.corrections||[]).filter(item=>dateInShanghai(new Date(item.at))<=eventCutoff),
      changes:(event.history||[]).filter(item=>dateInShanghai(new Date(item.at))<=eventCutoff),
      dateCorrections:event.dateCorrections||[],pressureCorrections:event.pressureCorrections||[],
      highPressureDays:highPressureDays(event,eventCutoff)};
  }).filter(Boolean);
  const activeAtCutoff=eventsAtDate(state.events||[],eventCutoff).filter(event=>event.status!=='ended');
  const recommendationContext={date:eventCutoff,load:eventRow?.load??null,
    chronicSources:eventRow?.chronicSources||[],energy:state.eventDays?.[eventCutoff]?.energy||'normal',
    lateNight:[eventCutoff,shiftDate(eventCutoff,-1)].some(date=>{
      const endTime=state.days[date]?.endTime;
      return endTime&&(endTime>='23:30'||endTime<'06:00');
    })};
  const eventManagement={...eventSummary,events:eventSnapshots,
    current:{date:eventCutoff,pressure:eventRow?.end??null,residual:eventRow?.residual??null,
      chronic:eventRow?.chronic??null,load:eventRow?.load??null,
      band:pressureBand(eventRow?.load??null).label},
    recommendations:recommendEvents(activeAtCutoff,recommendationContext),recommendationContext};
  const sorted=Object.keys(state.days).sort();
  const previous=sorted.filter(date=>date<start).at(-1);
  const latestThroughWeek=sorted.filter(date=>date<=end).at(-1);
  const beforeRest=previous?ledger.results[previous].balance:clampMinutes(state.openingRest);
  const beforePoints=previous?ledger.results[previous].accumulatedPoints:Number(state.openingPoints)||0;
  const asOfWeekRest=latestThroughWeek?ledger.results[latestThroughWeek].balance:clampMinutes(state.openingRest);
  const asOfWeekPoints=latestThroughWeek?ledger.results[latestThroughWeek].accumulatedPoints:Number(state.openingPoints)||0;
  const days=week.dates.map((date,index)=>{
    const schedule=daySchedule(date);
    const record=state.eventDays?.[date]||{};
    const lateNight=[date,shiftDate(date,-1)].some(d=>{const time=state.days[d]?.endTime;return time&&(time>='23:30'||time<'06:00')});
    const assessment=analyzeDailyPlan(eventsAtDate(state.events||[],date),record.plannedEventIds||[],eventSummary.rows[index],
      {energy:record.energy,lateNight,candidateIds:record.candidateEventIds||[]});
    const shared={date,scheduled:{weekday:schedule.weekday,label:schedule.label,kind:schedule.kind,rest:schedule.rest},engineering:{...engineering.daily[index]},
      eventRecord:{...record,pressure:eventSummary.rows[index],planAssessment:assessment}};
    const entry=state.days[date];
    if(!entry)return {...shared,recorded:false};
    const value=ledger.results[date];
    const goalApplies=!['rest','shiftRest','extra'].includes(entry.dayMode);
    return {...shared,recorded:true,actualMode:dayModeLabel(date,entry),originalEntry:JSON.parse(JSON.stringify(entry)),calculated:{
      countedMinutesByCategory:{...value.times},effectiveMinutes:value.effective,totalMinutes:value.total,
      baseGoalMinutes:goalApplies?value.baseGoal:null,coreGoalMinutes:goalApplies?value.coreGoal:null,
      meetsBase:goalApplies?value.meetsBase:null,meetsCore:goalApplies?value.meetsCore:null,
      qualifyingOvertimeMinutes:value.overtime,earnedRestMinutes:value.earnedRest,usedRestMinutes:value.usedRest,
      usedRestNature:value.usedRest?(['active','passive'].includes(entry.usedRestNature)?entry.usedRestNature:'unclassified'):null,
      restBalanceAfterMinutes:value.balance,restShortfallMinutes:value.restShortfall,
      points:{bonus:value.bonus,rawPenalty:value.rawPenalty,deduction:value.deduction,net:value.net,
        accumulated:value.accumulatedPoints,bonuses:value.lines.map(line=>({...line})),penalties:value.penalties.map(line=>({...line}))},
    }};
  });
  return {
    schema:'research-time-weekly-export/v1',exportedAt:exportedAt.toISOString(),timezone:'Asia/Shanghai',sourceSync,
    week:{start,end,weekNote:state.weeks[start]||''},
    summary:{recordedDays:week.entries.length,totalMinutes:week.total,effectiveMinutes:week.effective,
      byCategory:Object.fromEntries(categories.map(c=>[c.key,{label:c.label,minutes:week.byCategory[c.key],percentage:percent(week.byCategory[c.key],week.total)}])),
      netPoints:week.points,pointsAtWeekStart:beforePoints,pointsAtWeekEnd:asOfWeekPoints,
      qualifyingOvertimeMinutes:week.entries.reduce((sum,date)=>sum+ledger.results[date].overtime,0),
      earnedRestMinutes:week.earnedRest,usedRestMinutes:week.usedRest,
      activeRestMinutes:week.activeRest,passiveRestMinutes:week.passiveRest,
      unclassifiedRestMinutes:week.unclassifiedRest,activeRestSharePercent:week.activeRestShare,
      engineering:{targetMinutes:engineering.targetMinutes,dailyTargetMinutes:engineering.dailyTargetMinutes,
        currentActualMinutes:engineering.currentActualMinutes,currentExpectedMinutes:engineering.currentExpectedMinutes,
        currentAnxietyMinutes:engineering.currentAnxietyMinutes,weekActualMinutes:engineering.weekActualMinutes,
        finalAnxietyMinutes:engineering.finalAnxietyMinutes,finalIsProvisional:engineering.finalIsProvisional},
      restBalanceAtWeekStartMinutes:beforeRest,restBalanceAtWeekEndMinutes:asOfWeekRest,
      currentRestBalanceMinutes:ledger.rest,outputs:week.outputs},
    ruleSnapshot:{...state.rules},eventManagement,days,
  };
}

export function weeklySnapshotMarkdown(snapshot){
  const {week,summary,days}=snapshot;
  const lines=[
    `# 科研工时周记录：${week.start} 至 ${week.end}`,'',
    `导出时间：${snapshot.exportedAt}（${snapshot.timezone} 日期分周）`,
    `记录同步状态：${snapshot.sourceSync==='synced'?'云端已同步':'本地记录，云端同步状态未确认'}`,
    '统计口径：有效任务 = R + E；时间单位为小时/分钟。积分和调休按导出时保存的规则核算。Markdown 展示当前状态有效的字段，JSON 同时保留逐日原始填写值。','',
    '## 本周汇总','',
    '| 项目 | 结果 |','| --- | ---: |',
    `| 已记录天数 | ${summary.recordedDays} / 7 |`,
    `| 总投入 | ${formatMinutes(summary.totalMinutes)} |`,
    `| 有效任务 R + E | ${formatMinutes(summary.effectiveMinutes)} |`,
    `| 有效任务占比 | ${percent(summary.effectiveMinutes,summary.totalMinutes)}% |`,
    `| 有效加班 | ${formatMinutes(summary.qualifyingOvertimeMinutes)} |`,
    `| 本周积分 | ${signed(summary.netPoints)} |`,
    `| 本周新增调休 | +${formatMinutes(summary.earnedRestMinutes)} |`,
    `| 本周使用调休 | −${formatMinutes(summary.usedRestMinutes)} |`,
    `| 主动调休 | ${formatMinutes(summary.activeRestMinutes)} |`,
    `| 被动抵扣 | ${formatMinutes(summary.passiveRestMinutes)} |`,
    `| 未标注性质（旧记录） | ${formatMinutes(summary.unclassifiedRestMinutes)} |`,
    `| 主动调休占比（全部已使用时长） | ${summary.activeRestSharePercent}% |`,
    `| 周初调休余额 | ${formatMinutes(summary.restBalanceAtWeekStartMinutes)} |`,
    `| 周末调休余额 | ${formatMinutes(summary.restBalanceAtWeekEndMinutes)} |`,
    `| 当前调休余额（含后续记录） | ${formatMinutes(summary.currentRestBalanceMinutes)} |`,'',
    '### 个人工程指标','',
    `- 本周 E 目标：${formatMinutes(summary.engineering.targetMinutes)}（每日进度 +${formatMinutes(summary.engineering.dailyTargetMinutes)}）`,
    `- 当前累计 E：${formatMinutes(summary.engineering.currentActualMinutes)}；本周已记录 E：${formatMinutes(summary.engineering.weekActualMinutes)}`,
    `- 当前工程焦虑值：${formatMinutes(summary.engineering.currentAnxietyMinutes)}`,
    `- 周末${summary.engineering.finalIsProvisional?'暂估':'最终'}工程焦虑值：${formatMinutes(summary.engineering.finalAnxietyMinutes)}`,
    `- 状态：${summary.engineering.currentAnxietyMinutes?'工程投入低于截至目前的目标进度':'正常'}。周一重置，不结转，不计积分。`,'',
    '### 时间结构','',
    '| 类别 | 时间 | 占总投入 |','| --- | ---: | ---: |',
    ...categories.map(c=>`| ${c.key} · ${c.label} | ${formatMinutes(summary.byCategory[c.key].minutes)} | ${summary.byCategory[c.key].percentage}% |`),'',
  ];
  const event=snapshot.eventManagement;
  if(event){
    lines.push('## 事务负荷与恢复','',
      `- 当前压力 P_now：${event.current.pressure??'记录不足'}；逐事件下降残留 D：${event.current.residual??'记录不足'}；持续高压 C：${event.current.chronic??'记录不足'}；综合负荷 L：${event.current.load??'记录不足'}（${event.current.band}）。`,
      `- 平均 / 最高综合负荷：${event.averageLoad??'记录不足'} / ${event.maxLoad??'记录不足'}；较高 / 警戒天数：${event.highLoadDays} / ${event.alertDays}；恢复提醒天数：${event.recoveryDays}。`,
      `- 新增 / 完成 / 未结束事件：${event.newEvents} / ${event.completedEvents} / ${event.openEvents}；H3 事件：${event.highPressureEvents}。`,
      `- 完成节点：${event.advancedNodes}；计划选择变更：${event.planChanges}；旧版延期记录：${event.deferred}；建议协调 / 实际已协调：${event.suggestedCoordination} / ${event.coordinatedEvents}。`,
      `- 事件类别：${Object.entries(event.distribution).filter(([,n])=>n).map(([key,n])=>`${key} ${n}`).join(' · ')||'暂无'}；主要压力来源：${event.topEvents.map(x=>`${inline(x.name)} H${x.pressure}`).join('、')||'暂无'}。`,
      '这些数据展示同期记录，不表示事务负荷导致了工时、加班或调休。','',
      '| 日期 | 压力峰值 | 日末压力 | 下降残留 | 持续负荷 | 综合负荷 | R+E / 加班 / 使用调休 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
      ...event.rows.map(row=>{
        const work=days.find(day=>day.date===row.date)?.calculated;
        return `| ${row.date} | ${row.peak??'未记录'} | ${row.end??'未记录'} | ${row.residual??'记录不足'} | ${row.chronic??'未记录'} | ${row.load??'记录不足'} | ${work?`${formatMinutes(work.effectiveMinutes)} / ${formatMinutes(work.qualifyingOvertimeMinutes)} / ${formatMinutes(work.usedRestMinutes)}`:'未记录'} |`;
      }),'','### 事件与推进链','');
    if(!event.events.length)lines.push('本周没有关联事件。','');
    for(const item of event.events){
      const e=item.snapshot;
      lines.push(`- ${inline(e.name)}（${e.category} / ${e.priority} / H${e.pressure} / ${eventStatuses[e.status]||e.status}）：当前进展「${inline(e.currentStep||'待明确')}」；H2/H3 累计 ${item.highPressureDays} 天。`);
      lines.push(`  - 事件发生日期：${item.createdOn}；实际录入：${item.recordedAt}。`);
      lines.push(`  - 截止：${e.deadline||'无'}；可协调：${{yes:'是',no:'否',unknown:'暂不确定'}[e.coordinatable]||'暂不确定'}；认知强度：${{low:'低',medium:'中',high:'高',unknown:'不确定'}[e.cognitive]||'不确定'}。`);
      if(item.completedNodes.length)lines.push(`  - 已完成节点：${item.completedNodes.map(n=>`${inline(n.text)}（生效 ${n.completedAt}${n.pressure!==undefined?`，结束时 H${n.pressure} / ${eventStatuses[n.status]||n.status} / ${{yes:'可协调',no:'不可协调',unknown:'暂不确定'}[n.coordinatable]||'暂不确定'}`:''}${n.recordedAt?`，实际录入 ${n.recordedAt}`:''}）`).join('；')}`);
      if(item.corrections.length)lines.push(`  - 历史更正：${item.corrections.map(c=>`${inline(c.note)}（${c.at}）`).join('；')}`);
      if(item.changes.length)lines.push(`  - 状态 / 压力变更：${item.changes.map(c=>`${c.at} ${c.kind} H${c.snapshot.pressure} ${eventStatuses[c.snapshot.status]||c.snapshot.status}`).join('；')}`);
      if(item.dateCorrections.length)lines.push(`  - 日期更正：${item.dateCorrections.map(c=>`${c.from} → ${c.to}（录入 ${c.at}）`).join('；')}`);
      if(item.pressureCorrections.length)lines.push(`  - 压力补记：${item.pressureCorrections.map(c=>`${c.date} H${c.pressure}（录入 ${c.at}）`).join('；')}`);
      if(e.closeReason)lines.push(`  - ${e.endDisposition==='canceled'?'取消原因':'结束说明'}：${inline(e.closeReason)}`);
      if(e.notes)lines.push(`  - 备注：${inline(e.notes)}`);
    }
    lines.push('','### 截至导出日期的建议（仅供参考）','');
    for(const [index,item] of event.recommendations.ranked.entries()){
      lines.push(`${index+1}. ${inline(item.name)}（${inline(item.priority)} / H${item.pressure}）：${inline(item.action)} 依据：${item.reasons.map(inline).join('；')}。当前进展：${inline(item.step||'待明确')}。`);
    }
    if(!event.recommendations.ranked.length)lines.push('暂无待安排事件。');
    lines.push('');
    for(const [key,label] of [['priority','优先处理'],['coordinate','建议协调'],['suitable','适合推进'],['waiting','等待或暂缓']]){
      lines.push(`- ${label}：${event.recommendations[key].map(x=>`${inline(x.title)}，${inline(x.text)}`).join('；')||'暂无'}`);
    }
    if(event.recommendations.recovery)lines.push(`- 恢复提示：${inline(event.recommendations.recovery)}`);
    lines.push('');
  }
  lines.push('## 每日记录','');
  for(const day of days){
    lines.push(`### ${day.date} ${day.scheduled.weekday}`,'');
    if(!day.recorded)lines.push('未记录工时。');
    lines.push(`- 工程目标进度：${formatMinutes(day.engineering.expectedMinutes)}；E 累计：${formatMinutes(day.engineering.actualMinutes)}；工程焦虑值：${day.engineering.observed?formatMinutes(day.engineering.anxietyMinutes):'该日尚未到来'}`);
    const eventDay=day.eventRecord||{};
    if(eventDay.energy)lines.push(`- 精力状态：${energyLabels[eventDay.energy]||inline(eventDay.energy)}`);
    if(eventDay.pressure?.recorded)lines.push(`- 事务压力：峰值 ${eventDay.pressure.peak}，日末 ${eventDay.pressure.end}，逐事件下降残留 ${eventDay.pressure.residual??'记录不足'}，持续负荷 ${eventDay.pressure.chronic??'记录不足'}，综合 ${eventDay.pressure.load??'记录不足'}。`);
    const nameAtDate=id=>inline(event?.events.find(item=>item.id===id)?.changes.filter(c=>dateInShanghai(new Date(c.at))<=day.date).at(-1)?.snapshot.name||id);
    if(eventDay.initialPlanEventIds)lines.push(`- 原计划：${eventDay.initialPlanEventIds.map(id=>`${nameAtDate(id)}${(eventDay.initialCandidateEventIds||[]).includes(id)?'（候补）':''}`).join('；')||'空'}（确认时间 ${eventDay.originalConfirmedAt||'未记录'}）`);
    if(eventDay.plannedEventIds?.length)lines.push(`- 当前计划：${eventDay.plannedEventIds.map(id=>`${nameAtDate(id)}${(eventDay.candidateEventIds||[]).includes(id)?'（候补）':'（正式）'}`).join('；')}`);
    if(eventDay.planAssessment&&eventDay.plannedEventIds?.length)lines.push(`- 计划压力：所选 H ${eventDay.planAssessment.selectedPressure}；候补 H ${eventDay.planAssessment.candidatePressure}；所选持续负荷 ${eventDay.planAssessment.selectedChronic}；下降残留 ${eventDay.planAssessment.residual??'记录不足'}；计划值 ${eventDay.planAssessment.planLoad??'记录不足'}；整体负荷 ${eventDay.planAssessment.overallLoad??'记录不足'}；建议：${inline(eventDay.planAssessment.label)}，${inline(eventDay.planAssessment.action)}`);
    const planAction={add:'加入',remove:'取消',candidate:'设为候补',formal:'转为正式'};
    for(const change of eventDay.planChanges||[])lines.push(`- 计划选择：${planAction[change.action]||inline(change.action)} ${nameAtDate(change.eventId)}（${change.at}）`);
    for(const adjustment of eventDay.adjustments||[]){
      lines.push(`- 旧版手写计划调整（${adjustment.at}）：${[['原计划','original'],['新增','added'],['延期','deferred'],['协调','coordinate'],['原因','reason']].filter(([,key])=>adjustment[key]).map(([label,key])=>`${label} ${inline(adjustment[key])}`).join('；')}`);
    }
    if(!day.recorded){lines.push('');continue}
    const entry=day.originalEntry,v=day.calculated,resting=['rest','shiftRest'].includes(entry.dayMode);
    lines.push(`- 日历安排：${day.scheduled.label}；实际状态：${day.actualMode}`);
    lines.push(`- 时间：${categories.map(c=>`${c.key} ${formatMinutes(v.countedMinutesByCategory[c.key])}`).join(' · ')}`);
    lines.push(`- 有效任务 R+E：${formatMinutes(v.effectiveMinutes)}；总投入：${formatMinutes(v.totalMinutes)}${v.baseGoalMinutes===null?'':`；最低工作目标：${formatMinutes(v.baseGoalMinutes)}`}`);
    lines.push(`- 有效加班：${formatMinutes(v.qualifyingOvertimeMinutes)}；新增调休：${formatMinutes(v.earnedRestMinutes)}；使用调休：${formatMinutes(v.usedRestMinutes)}；调休性质：${v.usedRestNature?restNatureLabel[v.usedRestNature]:'无'}；日末余额：${formatMinutes(v.restBalanceAfterMinutes)}`);
    if(!resting&&entry.dayMode!=='extra'&&(entry.normalOvertime||entry.nightOvertime))lines.push(`- 手动加班分段：23:30 前 ${formatMinutes(entry.normalOvertime||0)}，23:30 后 ${formatMinutes(entry.nightOvertime||0)}；原因：${overtimeReasons[entry.overtimeReason]||'未选择'}`);
    lines.push(`- 积分：加分 ${signed(v.points.bonus)}，实际扣分 −${v.points.deduction}，当日净分 ${signed(v.points.net)}`);
    if(v.points.bonuses.length)lines.push(`- 加分明细：${v.points.bonuses.map(item=>`${item.label} +${item.points}`).join('；')}`);
    if(v.points.penalties.length)lines.push(`- 扣分触发：${v.points.penalties.map(item=>`${item.label} −${item.points}`).join('；')}（按单日上限扣 ${v.points.deduction}）`);
    if(!resting&&entry.dayMode!=='extra'&&entry.endTime)lines.push(`- 最晚结束工作：${inline(entry.endTime)}`);
    const checked=resting||entry.dayMode==='extra'?[]:Object.entries(flagLabels).filter(([key])=>entry[key]).map(([,label])=>label);
    if(checked.length)lines.push(`- 今日标记：${checked.join('；')}`);
    if(!resting&&entry.outputs?.length){lines.push('- 专项产出：');for(const item of entry.outputs)lines.push(`  - ${inline(item)}`)}
    for(const [label,key] of [['当前阻塞','blocker'],['明日第一步','nextAction'],['今日事务／日常','dailyLife'],['明天计划','tomorrowPlan'],['下周计划','nextWeekPlan'],['今日观察／异常','observation']]){
      if(resting&&['blocker','nextAction'].includes(key))continue;
      if(!resting&&['dailyLife','tomorrowPlan','nextWeekPlan'].includes(key))continue;
      if(!safeText(entry[key]))continue;
      const heading=key==='nextWeekPlan'&&day.scheduled.rest===false&&resting?'旧版下周计划（保留）':label;
      lines.push(`- ${heading}：`,'',quote(entry[key]),'');
    }
    lines.push('');
  }
  lines.push('## 周复盘笔记','',week.weekNote?quote(week.weekNote):'未填写。','');
  return lines.join('\n');
}
