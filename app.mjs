import {categories,defaultRules,clampMinutes,formatMinutes,weekStart,shiftDate,restStatus,computeDay,computeLedger,computeWeek,computeEngineeringWeek} from './calc.mjs';
import {daySchedule,monthDates} from './calendar.mjs';
import {makeWeeklySnapshot,weeklySnapshotMarkdown} from './weekly-export.mjs';
import {initEventApp} from './events-ui.mjs';
import {removeContaminatedEvent} from './event-cleanup.mjs';
import {repairRetiredProgress} from './events.mjs';

const STORAGE_KEY = 'research-time-review-v1';
const PENDING_KEY = 'research-time-review-pending-v1';
const $ = id => document.getElementById(id);
const shanghaiDate = date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const today = () => shanghaiDate(new Date());
const initial = () => ({schema:1,days:{},weeks:{},rules:{...defaultRules},openingRest:0,openingPoints:0,events:[],eventDays:{}});
function readStorage() {try {const raw=localStorage.getItem(STORAGE_KEY);return raw?normalize(JSON.parse(raw)):initial()} catch {return initial()}}
function normalize(data) {
  if (!data || data.schema!==1 || !data.days || typeof data.days!=='object' || Array.isArray(data.days)) throw Error('备份格式无效');
  const normalized={schema:1,days:data.days,weeks:data.weeks&&typeof data.weeks==='object'?data.weeks:{},rules:{...defaultRules,...data.rules},openingRest:clampMinutes(data.openingRest),openingPoints:Number(data.openingPoints)||0,
    events:Array.isArray(data.events)?data.events.map(repairRetiredProgress):[],eventDays:data.eventDays&&typeof data.eventDays==='object'&&!Array.isArray(data.eventDays)?data.eventDays:{}};
  return removeContaminatedEvent(normalized).state;
}
let state=readStorage(), selected=today(), shownWeek=weekStart(selected), dirty=false;
let currentMode='work', calendarYear=Number(selected.slice(0,4)), calendarMonth=Number(selected.slice(5,7));
let remoteRevision=0, cloudReady=false, conflictData=null, saving=false, queuedSaves=0, saveQueue=Promise.resolve();
const hasLocalData=value=>Object.keys(value.days).length>0||Object.keys(value.weeks).length>0||value.openingRest>0||value.openingPoints>0||value.events?.length>0||Object.keys(value.eventDays||{}).length>0||JSON.stringify(value.rules)!==JSON.stringify(defaultRules);
const flags=['growthDone','reviewDone','procrastinated','drift','fatigue','artificialOvertime','unnecessaryOvertime','p0Emergency'];
const ruleSections = [
  ['每日目标（分钟）',[['minimumMinutes','工作日最低目标（新记录）'],['baseMinutes','旧记录基础工时'],['coreMinutes','R+E 核心目标'],['toleranceMinutes','旧记录达标容差']]],
  ['加分（分）',[['basePoints','基础工时'],['corePoints','核心时间块'],['growthPoints','长期能力建设'],['reviewPoints','每日复盘'],['finishPoints','正常结束工作'],['overtimeShortPoints','合理加班 30–59 分钟'],['overtimeLongPoints','合理加班 ≥60 分钟']]],
  ['扣分（分）',[['procrastinationPenalty','拖延导致加班'],['lateTargetPenalty','旧记录 23:00 未达标'],['night1Penalty','新记录 00:00 后工作'],['night2Penalty','00:30 后工作'],['night3Penalty','02:00 后工作'],['artificialPenalty','人为制造加班'],['driftPenalty','注意力漂移'],['fatiguePenalty','疲劳追加任务'],['forcedRestPenalty','强制调休区无必要加班'],['deductionCap','单日扣分上限']]],
  ['调休换算与提醒',[['overtimeFactor','普通加班倍率'],['nightFactor','23:30 后加班倍率'],['restDayFactor','休息日额外工作倍率'],['restSuggestMinutes','建议使用阈值（分钟）'],['restForceMinutes','强制消费阈值（分钟）'],['restHalfDayMinutes','半天调休阈值（分钟）'],['restStopMinutes','暂停非必要加班阈值（分钟）']]],
];

function durationMarkup(key){return `<input type="number" min="0" max="999" step="1" inputmode="numeric" data-hour="${key}" aria-label="${key} 小时" value="0"><span>h</span><input type="number" min="0" max="59" step="1" inputmode="numeric" data-minute="${key}" aria-label="${key} 分钟" value="0"><span>m</span>`}
function renderStatic(){
  $('timeFields').innerHTML=categories.map(c=>`<div class="time-field ${['R','E'].includes(c.key)?'core':''}"><div class="time-name"><b>${c.key}</b><small>${c.label}</small></div><div class="duration" data-duration="${c.key}">${durationMarkup(c.key)}</div></div>`).join('');
  document.querySelectorAll('.duration:not(.time-field .duration)').forEach(el=>{if(!el.innerHTML.trim())el.innerHTML=durationMarkup(el.dataset.duration)});
  $('ruleFields').innerHTML=ruleSections.map(([title,fields])=>`<div style="grid-column:1/-1;font-size:12px;font-weight:700;color:#344765;margin-top:12px">${title}</div>${fields.map(([key,label])=>`<label>${label}<input type="number" min="0" step="any" data-rule="${key}"></label>`).join('')}`).join('');
}
function setDuration(key,minutes){const n=clampMinutes(minutes);document.querySelector(`[data-hour="${key}"]`).value=Math.floor(n/60);document.querySelector(`[data-minute="${key}"]`).value=n%60}
function getDuration(key){const h=Number(document.querySelector(`[data-hour="${key}"]`).value),m=Number(document.querySelector(`[data-minute="${key}"]`).value);return Math.max(0,Math.round((Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0)))}
function defaultMode(day){
  const scheduledRest=daySchedule(selected).rest;
  if(day?.dayMode==='rest'&&!scheduledRest)return day.usedRest?'legacyRest':'shiftRest';
  if(day?.dayMode==='work'&&scheduledRest)return 'shiftWork';
  if(day?.dayMode)return day.dayMode;
  if(day&&scheduledRest&&Object.values(day.times||{}).some(Number))return 'legacyWork';
  return scheduledRest?'rest':'work';
}
function renderMode(){
  const schedule=daySchedule(selected), resting=['rest','shiftRest','legacyRest'].includes(currentMode), extra=currentMode==='extra';
  const actualLabels={work:'正常工作日',rest:'正常休息日',shiftRest:'工作日调整为休息日',shiftWork:'休息日调整为工作日',extra:'休息日额外工作',legacyRest:'旧版休息记录',legacyWork:'旧版工作记录'};
  $('dateStatus').textContent=`${schedule.weekday} · ${schedule.label}`;
  $('dateStatus').className=`schedule-chip ${schedule.rest?'is-rest':schedule.kind==='makeup'?'is-makeup':''}`;
  $('actualStatus').textContent=`今日实际：${actualLabels[currentMode]}`;
  $('actualStatus').dataset.baseLabel=`今日实际：${actualLabels[currentMode]}`;
  $('actualStatus').className=`schedule-chip ${resting?'is-rest':extra?'is-makeup':''}`;
  $('scheduleHint').textContent=schedule.official?'依据已公布的节假日安排':`${selected.slice(0,4)} 年安排尚未收录，仅按正常双休暂估`;
  $('entryTitle').textContent=resting?'休息日记录':'每日记录';
  $('entrySubtitle').textContent=resting?'给休息和下周计划留一点空间。':extra?'今日所有工作时间计作休息日加班。':'按实际投入填写。最低工作目标为 7h，可用已积累调休时长抵扣。';
  $('restPanel').hidden=!resting;$('workPanel').hidden=resting;
  const adjustedRest=currentMode==='shiftRest'||currentMode==='legacyRest';
  $('restPanelTitle').textContent=adjustedRest?'工作日调整为休息日':'正常休息日记录';
  $('restPanelDescription').textContent=adjustedRest?'记录今日休息与个人事务，并安排明天的工作；新记录不扣已积累的调休余额。':'记录今日日常与下周计划，不需要填写工作时间。';
  $('dailyLifeLabel').textContent=adjustedRest?'今日事务 / 休息记录':'今日日常记录';
  $('nextWeekPlanField').hidden=adjustedRest;
  $('tomorrowPlanField').hidden=!adjustedRest;
  const previousPlan=adjustedRest?state.days[selected]?.nextWeekPlan:'';
  $('legacyWeekPlan').hidden=!previousPlan;
  $('legacyWeekPlan').textContent=previousPlan?`旧版记录的“下周计划”（已保留）：${previousPlan}`:'';
  $('modeDescription').textContent=currentMode==='shiftRest'?'今日整天按休息日记录，不使用调休余额。':currentMode==='shiftWork'?'今日按正常工作日规则记录；少工作几个小时可在下方使用已积累调休。':extra?'今日工作时间全部计为加班，按 1/4 兑换调休；不触发工作日扣分。':resting?'今日记录生活与计划，不核算工时。':'今日按正常工作日记录；已积累调休可抵扣最低工作目标。';
  $('legacyNotice').hidden=currentMode!=='legacyRest';
  $('legacyNotice').textContent=currentMode==='legacyRest'?`这是旧版休息记录，已扣除 ${formatMinutes(getDuration('usedRest'))} 调休；原记录保持不变。点击“工作日调整为休息日”可改为不扣余额的新状态。`:'';
  $('manualOvertime').hidden=extra;
  $('workRhythm').hidden=extra;
  $('overtimeExplanation').textContent=extra?'休息日额外工作：左侧所有工作时间均计为加班，按 1/4 兑换调休；无需分段填写。':'加班已包含在左侧时间里，此处只用于核算，不会重复计入总投入。';
  $('normalModeButton').textContent=schedule.rest?'正常休息日':'正常工作日';
  $('normalModeButton').setAttribute('aria-pressed',String(currentMode===(schedule.rest?'rest':'work')));
  $('adjustModeButton').textContent=schedule.rest?'休息日调整为工作日':'工作日调整为休息日';
  $('adjustModeButton').setAttribute('aria-pressed',String(currentMode===(schedule.rest?'shiftWork':'shiftRest')));
  $('extraWorkButton').hidden=!schedule.rest;
  $('extraWorkButton').setAttribute('aria-pressed',String(extra));
  $('overtimeHint').hidden=resting||extra;
  updateRestNatureVisibility();
}
function updateRestNatureVisibility(){
  const applies=!['rest','shiftRest','legacyRest','extra'].includes(currentMode)&&getDuration('usedRest')>0;
  $('restNatureField').hidden=!applies;
  $('usedRestNature').disabled=!applies;
}
function draft(){const day={times:{},outputs:$('outputs').value.split('\n').map(s=>s.trim()).filter(Boolean),blocker:$('blocker').value.trim(),nextAction:$('nextAction').value.trim(),outputPoints:Number($('outputPoints').value)||0,overtimeReason:$('overtimeReason').value,endTime:$('endTime').value,dailyLife:$('dailyLife').value.trim(),nextWeekPlan:$('nextWeekPlan').value.trim(),tomorrowPlan:$('tomorrowPlan').value.trim(),observation:$('observation').value.trim()};const saved=state.days[selected];if(currentMode==='legacyRest')day.dayMode='rest';else if(currentMode!=='legacyWork'){day.dayMode=currentMode;day.ruleVersion=!dirty&&saved?saved.ruleVersion:3}if((!dirty||currentMode==='legacyWork')&&saved?.lateTargetSelf&&day.ruleVersion<3)day.lateTargetSelf=true;for(const c of categories)day.times[c.key]=getDuration(c.key);for(const k of ['normalOvertime','nightOvertime','usedRest'])day[k]=getDuration(k);if(['rest','shiftRest','extra'].includes(currentMode))day.usedRest=0;if(day.usedRest&&['active','passive'].includes($('usedRestNature').value))day.usedRestNature=$('usedRestNature').value;for(const k of flags)day[k]=$(k).checked;return day}
function fill(day={}){currentMode=defaultMode(state.days[selected]);for(const c of categories)setDuration(c.key,day.times?.[c.key]||0);for(const k of ['normalOvertime','nightOvertime','usedRest'])setDuration(k,day[k]||0);for(const k of flags)$(k).checked=!!day[k];$('outputs').value=(day.outputs||[]).join('\n');$('blocker').value=day.blocker||'';$('nextAction').value=day.nextAction||'';$('outputPoints').value=day.outputPoints||0;$('overtimeReason').value=day.overtimeReason||'necessary';$('usedRestNature').value=['active','passive'].includes(day.usedRestNature)?day.usedRestNature:'';$('endTime').value=day.endTime||'';$('dailyLife').value=day.dailyLife||'';$('nextWeekPlan').value=day.nextWeekPlan||'';$('tomorrowPlan').value=day.tomorrowPlan||'';$('observation').value=day.observation||'';$('entryDate').value=selected;calendarYear=Number(selected.slice(0,4));calendarMonth=Number(selected.slice(5,7));dirty=false;$('saveState').textContent=localStorage.getItem(PENDING_KEY)?'仅本地，待同步':state.days[selected]?'已同步':'尚未记录';renderMode();renderCalendar();renderPreview()}
function setSync(mode, message=''){
  $('syncIndicator').className=`private ${mode==='ok'?'':mode==='conflict'?'conflict':'unsynced'}`;
  $('syncText').textContent={ok:'云端已同步',loading:'正在连接云端',error:'仅本地，待同步',conflict:'同步冲突'}[mode];
  $('syncBanner').hidden=mode==='ok'||mode==='loading';
  $('syncChoices').hidden=mode!=='conflict';
  $('syncMessage').textContent=message||{error:'云端暂不可用，记录已留在本浏览器。请稍后刷新页面重试，并导出 JSON 备份。',conflict:'本地和云端记录都已更改。先导出本地备份，再选择保留哪份记录。'}[mode]||'';
}
async function remote(method, payload){
  const response=await fetch('/api/state',{method,headers:method==='PUT'?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.error||'request_failed');error.status=response.status;throw error}
  return result;
}
function pending(){try{const raw=localStorage.getItem(PENDING_KEY);return raw?JSON.parse(raw):null}catch{return null}}
function persist(){
  queuedSaves++;saving=true;
  const operation=saveQueue.then(()=>persistOne());
  saveQueue=operation.catch(()=>{});
  return operation.finally(()=>{queuedSaves--;saving=queuedSaves>0});
}
async function persistOne(){
  if(conflictData){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));localStorage.setItem(PENDING_KEY,JSON.stringify({state,expectedRevision:remoteRevision}))}catch{}
    setSync('conflict');return false;
  }
  const snapshot=JSON.parse(JSON.stringify(state));
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot));localStorage.setItem(PENDING_KEY,JSON.stringify({state:snapshot,expectedRevision:remoteRevision}))}catch{}
  try{
    if(!cloudReady)throw Error('offline');
    const result=await remote('PUT',{state:snapshot,expectedRevision:remoteRevision});
    remoteRevision=result.revision;
    try{localStorage.removeItem(PENDING_KEY)}catch{}
    setSync('ok');return true;
  }catch(error){
    if(error.status===409){try{conflictData=await remote('GET')}catch{};setSync('conflict')}
    else setSync('error');
    return false;
  }
}
async function initializeCloud(){
  setSync('loading');
  try{
    const cloud=await remote('GET');
    remoteRevision=cloud.revision;
    cloudReady=true;
    const unsynced=pending();
    if(unsynced){
      state=normalize(unsynced.state);
      if(unsynced.expectedRevision===remoteRevision){
        const success=await persist();
        if(!success&&conflictData)return;
      }else if(cloud.state&&JSON.stringify(state)===JSON.stringify(normalize(cloud.state))){
        state=normalize(cloud.state);
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));localStorage.removeItem(PENDING_KEY)}catch{}
        setSync('ok');
      }else{conflictData=cloud;setSync('conflict');fill(state.days[selected]);render();return}
    }else if(cloud.state){
      const incoming=normalize(cloud.state);
      if(hasLocalData(state)&&JSON.stringify(state)!==JSON.stringify(incoming)){
        conflictData=cloud;
        setSync('conflict','此浏览器的历史记录与云端不同。请先导出本地备份，再选择保留哪份记录。');
        fill(state.days[selected]);render();return;
      }
      state=incoming;
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{}
      if(JSON.stringify(cloud.state.events||[])!==JSON.stringify(incoming.events))await persist();
      else setSync('ok');
    }else if(hasLocalData(state)){
      const success=await persist();
      if(success)setSync('ok','此浏览器的旧记录已同步到云端。');
    }else setSync('ok');
    fill(state.days[selected]);render();
  }catch{cloudReady=false;setSync('error');fill(state.days[selected]);render()}
}
function shortDate(date){return `${Number(date.slice(5,7))}月${Number(date.slice(8))}日`}
function renderCalendar(){
  $('calendarMonth').textContent=`${calendarYear} 年 ${calendarMonth} 月`;
  const {offset,dates}=monthDates(calendarYear,calendarMonth);
  $('calendarGrid').replaceChildren();
  for(let i=0;i<offset;i++)$('calendarGrid').append(document.createElement('span'));
  for(const date of dates){
    const schedule=daySchedule(date),button=document.createElement('button');
    button.type='button';button.className=`calendar-day ${schedule.kind} ${selected===date?'selected':''}`;
    button.setAttribute('aria-label',`${date} ${schedule.weekday} ${schedule.label}`);
    button.setAttribute('aria-current',selected===date?'date':'false');
    const number=document.createElement('strong');number.textContent=String(Number(date.slice(8)));
    const badge=document.createElement('small');const savedMode=state.days[date]?.dayMode;
    badge.textContent=savedMode==='shiftRest'?'改休':savedMode==='rest'&&!schedule.rest?(state.days[date].usedRest?'旧休':'改休'):savedMode==='shiftWork'?'改工':savedMode==='extra'?'额外':schedule.kind==='makeup'?'补班':schedule.kind==='holiday'?'假期':schedule.weekday==='周日'?'周日':schedule.weekday==='周六'?'周末':'·';
    button.append(number,badge);
    button.addEventListener('click',()=>{navigateDay(date);if(selected===date){$('calendarPopover').hidden=true;$('calendarButton').setAttribute('aria-expanded','false')}});
    $('calendarGrid').append(button);
  }
  $('calendarNote').textContent=daySchedule(dates[0]).official?'假期与补班以已公布安排为准；其余日期按正常双休。':'年度放假安排尚未收录，当前仅按正常双休暂估。';
}
function renderPreview(){
  updateRestNatureVisibility();
  const day=draft(),days={...state.days,[selected]:day};
  const ledger=computeLedger(days,state.rules,state.openingRest,state.openingPoints),v=ledger.results[selected];
  const resting=['rest','shiftRest','legacyRest'].includes(currentMode),extra=currentMode==='extra';
  $('previewEffective').textContent=formatMinutes(v.effective);
  $('previewTotal').textContent=formatMinutes(v.total);
  $('previewScore').textContent=`${v.net>=0?'+':''}${v.net} 分`;
  $('actualStatus').textContent=`${$('actualStatus').dataset.baseLabel}${!resting&&!extra&&v.usedRest?` · 使用 ${formatMinutes(v.usedRest)} 调休`:''}`;
  $('previewRest').textContent=resting?(currentMode==='legacyRest'?`旧记录已使用调休 ${formatMinutes(v.usedRest)}`:'今日不使用调休余额'):`预计新增调休 ${formatMinutes(v.earnedRest)}${v.usedRest?` · 使用 ${formatMinutes(v.usedRest)}`:''}`;
  $('adjustedGoal').textContent=extra?'全部工时按额外工作核算':`今日最低工作目标 ${formatMinutes(v.baseGoal)}${v.usedRest?`（已使用 ${formatMinutes(v.usedRest)} 调休）`:''}；8h 后请自行登记加班分段。`;
  const overEight=!resting&&!extra&&v.total>480;
  $('overtimeHint').hidden=!overEight;
  $('overtimeHint').textContent=overEight?`今日工作时间已超过 8h（超出 ${formatMinutes(v.total-480)}），记得自行核对并记录加班时长。`:'';
  const warnings=[];
  if(v.restShortfall)warnings.push(`调休使用超出可用余额 ${formatMinutes(v.restShortfall)}，余额不会低于 0。`);
  if(!resting&&!extra&&day.nightOvertime&&!day.endTime)warnings.push('填写了深夜加班，请填写最晚结束时间以核算深夜扣分。');
  if(!resting&&!extra&&(day.normalOvertime||day.nightOvertime)&&day.overtimeReason!=='necessary')warnings.push('这类加班不产生积分与调休。');
  $('previewWarnings').textContent=warnings.join(' ');
}
function daySummary(date,day){
  if(day.dayMode==='shiftRest')return '改为休息日';
  if(day.dayMode==='shiftWork')return '改为工作日';
  if(day.dayMode==='extra')return '休息日额外工作';
  if(day.dayMode==='rest'&&!daySchedule(date).rest)return day.usedRest?'旧版整日调休':'改为休息日';
  if(day.usedRest)return `工作日使用调休 ${formatMinutes(day.usedRest)}`;
  return daySchedule(date).rest?'正常休息日':'正常工作日';
}
function renderWeeklyIndicators(week,ledger){
  $('weekActiveRest').textContent=formatMinutes(week.activeRest);
  $('weekPassiveRest').textContent=formatMinutes(week.passiveRest);
  $('weekUnclassifiedRow').hidden=week.unclassifiedRest===0;
  $('weekUnclassifiedRest').textContent=formatMinutes(week.unclassifiedRest);
  $('weekActiveShare').textContent=`${week.activeRestShare}%`;
  const unclassified=week.unclassifiedRest>0;
  const mostlyPassive=!unclassified&&week.usedRest>=120&&week.passiveRest/(week.activeRest+week.passiveRest)>=0.7;
  $('restNatureHint').hidden=!unclassified&&!mostlyPassive;
  $('restNatureHint').textContent=unclassified?`有 ${formatMinutes(week.unclassifiedRest)} 已使用调休尚未标注性质；主动占比按全部已使用调休计算。`:mostlyPassive?'本周调休以被动抵扣为主，可以考虑下一次在疲劳明显时更早地主动结束工作。':'';
  const asOfDate=shanghaiDate(new Date());
  const metric=computeEngineeringWeek(ledger.results,shownWeek,asOfDate);
  $('engineeringActual').textContent=`${formatMinutes(metric.currentActualMinutes)} / ${formatMinutes(metric.targetMinutes)}`;
  $('engineeringAnxiety').textContent=formatMinutes(metric.currentAnxietyMinutes);
  $('engineeringStatus').textContent=asOfDate<shownWeek?'本周尚未开始。':metric.currentAnxietyMinutes?'工程投入落后于本周目标进度。':'正常';
}
function render(){const ledger=computeLedger(state.days,state.rules,state.openingRest,state.openingPoints);const week=computeWeek(state.days,ledger.results,shownWeek);const end=shiftDate(shownWeek,6);$('weekRange').textContent=`${shortDate(shownWeek)} — ${shortDate(end)}`;$('reviewRange').textContent=`${shortDate(shownWeek)}–${shortDate(end)}`;$('statEffective').textContent=formatMinutes(week.effective);$('statTotal').textContent=formatMinutes(week.total);$('statPoints').textContent=`${week.points>=0?'+':''}${week.points}`;$('statRest').textContent=formatMinutes(ledger.rest);$('totalFoot').textContent=`已记录 ${week.entries.length} 天`;$('effectiveFoot').textContent=week.total?`占总投入 ${Math.round(week.effective/week.total*100)}%`:'本周科研与工程投入';$('pointsFoot').textContent=`累计 ${ledger.points} 分`;const status=restStatus(ledger.rest,state.rules);$('restFoot').textContent=status.label;$('restStatus').textContent=status.label;$('restStatus').className=`status-chip ${status.level==='good'?'':status.level==='suggest'?'warn':'alert'}`;$('restMessage').textContent=status.text;$('weekTotalLabel').textContent=`合计 ${formatMinutes(week.total)}`;$('distribution').innerHTML=categories.filter(c=>week.byCategory[c.key]).map(c=>`<span style="background:${c.color};width:${week.byCategory[c.key]/week.total*100}%" title="${c.label} ${formatMinutes(week.byCategory[c.key])}"></span>`).join('');$('legend').innerHTML=categories.map(c=>`<div class="legend-item"><i style="background:${c.color}"></i><span>${c.key} · ${c.label}</span><b>${week.total?Math.round(week.byCategory[c.key]/week.total*100):0}%</b></div>`).join('');$('structureNote').textContent=week.total?`R+E 共 ${formatMinutes(week.effective)}；占总投入 ${Math.round(week.effective/week.total*100)}%。占比以 R/E/P/S/C/M/A 总和为分母。`:'保存一条记录后，这里会显示各类投入的占比。';$('weekEarned').textContent=`+${formatMinutes(week.earnedRest)}`;$('weekUsed').textContent=`−${formatMinutes(week.usedRest)}`;$('weekPoints').textContent=`${week.points>=0?'+':''}${week.points}`;$('dailyCount').textContent=`${week.entries.length} 天`;$('dayBreakdown').innerHTML=week.entries.length?week.entries.map(date=>`<div class="day-line"><span>${shortDate(date)} · ${daySummary(date,state.days[date])} · ${formatMinutes(ledger.results[date].effective)} 有效任务</span><b>${ledger.results[date].net>=0?'+':''}${ledger.results[date].net} 分</b></div>`).join(''):'<p class="empty-days">本周尚无记录</p>';$('outputSummary').textContent=`本周记录的专项产出：${week.outputs} 项`;$('weeklyText').value=state.weeks[shownWeek]||'';const observations=week.entries.filter(date=>state.days[date].observation);$('weeklyObservations').replaceChildren();if(!observations.length){const empty=document.createElement('p');empty.className='empty-days';empty.textContent='本周尚无观察记录';$('weeklyObservations').append(empty)}for(const date of observations){const row=document.createElement('div'),stamp=document.createElement('strong'),body=document.createElement('span');row.className='observation-item';stamp.textContent=shortDate(date);body.textContent=state.days[date].observation;row.append(stamp,body);$('weeklyObservations').append(row)}$('exportRange').textContent=`${shownWeek} 至 ${end}`;$('exportState').textContent='';renderWeeklyIndicators(week,ledger);renderCalendar();renderPreview();eventApp.render()}
function navigateDay(date){if(dirty&&!confirm('当前记录尚未保存，确定切换日期吗？')){$('entryDate').value=selected;return}selected=date;shownWeek=weekStart(date);fill(state.days[selected]);render()}
function changeWeek(week){shownWeek=week;render()}
function showRules(){for(const input of document.querySelectorAll('[data-rule]'))input.value=state.rules[input.dataset.rule];$('openingPoints').value=state.openingPoints;$('openingRest').value=state.openingRest;$('settingsState').textContent='';$('settingsDialog').showModal()}
function downloadBackup(){const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`科研工时备份-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

renderStatic();const eventApp=initEventApp({getState:()=>state,onPersist:()=>persist(),getSelected:()=>selected,getWeek:()=>shownWeek,getLedger:()=>computeLedger(state.days,state.rules,state.openingRest,state.openingPoints)});fill(state.days[selected]);render();initializeCloud();
$('dayForm').addEventListener('input',()=>{dirty=true;$('saveState').textContent='未保存';renderPreview()});
$('dayForm').addEventListener('change',()=>{dirty=true;$('saveState').textContent='未保存';renderPreview()});
$('dayForm').addEventListener('submit',async e=>{e.preventDefault();const day=draft();if(day.outputPoints<0){$('saveState').textContent='专项产出加分不能为负';return}state.days[selected]=day;const synced=await persist();dirty=false;$('saveState').textContent=synced?'已同步':'仅本地，待处理';render()});
function switchMode(mode){if(currentMode===mode)return;currentMode=mode;dirty=true;$('saveState').textContent='未保存';renderMode();renderPreview()}
$('normalModeButton').addEventListener('click',()=>switchMode(daySchedule(selected).rest?'rest':'work'));
$('adjustModeButton').addEventListener('click',()=>switchMode(daySchedule(selected).rest?'shiftWork':'shiftRest'));
$('extraWorkButton').addEventListener('click',()=>switchMode('extra'));
$('entryDate').addEventListener('change',e=>{const date=e.target.value;if(date)navigateDay(date);else e.target.value=selected});
$('calendarButton').addEventListener('click',()=>{const open=$('calendarPopover').hidden;$('calendarPopover').hidden=!open;$('calendarButton').setAttribute('aria-expanded',String(open));if(open)renderCalendar()});
function stepMonth(amount){const date=new Date(calendarYear,calendarMonth-1+amount,1,12);calendarYear=date.getFullYear();calendarMonth=date.getMonth()+1;renderCalendar()}
$('prevMonth').addEventListener('click',()=>stepMonth(-1));
$('nextMonth').addEventListener('click',()=>stepMonth(1));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('calendarPopover').hidden){$('calendarPopover').hidden=true;$('calendarButton').setAttribute('aria-expanded','false')}});
$('prevDay').addEventListener('click',()=>navigateDay(shiftDate(selected,-1)));
$('nextDay').addEventListener('click',()=>navigateDay(shiftDate(selected,1)));
$('prevWeek').addEventListener('click',()=>changeWeek(shiftDate(shownWeek,-7)));
$('nextWeek').addEventListener('click',()=>changeWeek(shiftDate(shownWeek,7)));
$('saveWeekly').addEventListener('click',async()=>{state.weeks[shownWeek]=$('weeklyText').value.trim();const synced=await persist();$('weeklyState').textContent=synced?'周复盘已同步':'仅本地，待处理'});
$('weeklyText').addEventListener('input',()=>$('weeklyState').textContent='未保存');
function exportSnapshot(){
  if($('syncText').textContent==='正在连接云端'){$('exportState').textContent='正在读取云端记录，请稍后再导出。';return null}
  if(conflictData){$('exportState').textContent='本地与云端记录有冲突，请先在页面顶部选择保留哪份记录。';return null}
  if(saving){$('exportState').textContent='正在保存，请稍后再导出。';return null}
  if(dirty||$('weeklyText').value.trim()!==(state.weeks[shownWeek]||'')){
    $('exportState').textContent='有未保存的每日记录或周复盘。请先保存，再导出这一周。';return null;
  }
  const weekEnd=shiftDate(shownWeek,6);
  const hasDays=Object.keys(state.days).some(date=>date>=shownWeek&&date<=weekEnd);
  const hasEvents=(state.events||[]).some(event=>event.createdAt&&shanghaiDate(new Date(event.createdAt))<=weekEnd&&
    (event.history||[]).some(change=>change.at&&shanghaiDate(new Date(change.at))>=shownWeek&&shanghaiDate(new Date(change.at))<=weekEnd));
  const hasEventDays=Object.keys(state.eventDays||{}).some(date=>date>=shownWeek&&date<=weekEnd);
  if(!hasDays&&!hasEvents&&!hasEventDays&&!state.weeks[shownWeek]){$('exportState').textContent='这一周还没有已保存的记录。';return null}
  const synced=cloudReady&&$('syncText').textContent==='云端已同步'&&!pending()&&!conflictData;
  return makeWeeklySnapshot(state,shownWeek,new Date(),synced?'synced':'local_pending');
}
function downloadWeek(content,extension,mime,snapshot){
  const name=`科研工时周记录-${snapshot.week.start}_${snapshot.week.end}.${extension}`;
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('exportState').textContent=`已生成 ${name}${snapshot.sourceSync==='synced'?'':'；当前数据尚未同步云端'}`;
}
$('downloadWeekMarkdown').addEventListener('click',()=>{const snapshot=exportSnapshot();if(snapshot)downloadWeek(weeklySnapshotMarkdown(snapshot),'md','text/markdown;charset=utf-8',snapshot)});
$('downloadWeekJson').addEventListener('click',()=>{const snapshot=exportSnapshot();if(snapshot)downloadWeek(`${JSON.stringify(snapshot,null,2)}\n`,'json','application/json;charset=utf-8',snapshot)});
$('copyWeekMarkdown').addEventListener('click',async()=>{
  const snapshot=exportSnapshot();if(!snapshot)return;
  try{await navigator.clipboard.writeText(weeklySnapshotMarkdown(snapshot));$('exportState').textContent=`已复制 ${snapshot.week.start} 至 ${snapshot.week.end} 的 Markdown${snapshot.sourceSync==='synced'?'':'；当前数据尚未同步云端'}`}
  catch{$('exportState').textContent='浏览器未允许复制，请使用“下载 Markdown”。'}
});
$('settingsButton').addEventListener('click',showRules);
$('saveSettings').addEventListener('click',async()=>{const next={...state.rules};for(const input of document.querySelectorAll('[data-rule]')){const n=Number(input.value);if(!Number.isFinite(n)||n<0){$('settingsState').textContent='规则须为非负数字';return}next[input.dataset.rule]=n}if(!(next.restSuggestMinutes<=next.restForceMinutes&&next.restForceMinutes<=next.restHalfDayMinutes&&next.restHalfDayMinutes<=next.restStopMinutes)){$('settingsState').textContent='调休提醒阈值须按顺序递增';return}state.rules=next;state.openingRest=clampMinutes($('openingRest').value);state.openingPoints=Math.max(0,Number($('openingPoints').value)||0);const synced=await persist();render();if(synced)$('settingsDialog').close();else $('settingsState').textContent='尚未同步到云端，请先导出备份'});
$('exportButton').addEventListener('click',downloadBackup);
$('importFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const parsed=normalize(JSON.parse(await file.text()));if(!confirm('导入会替换云端与本浏览器的全部记录和规则。确定导入吗？'))return;state=parsed;const synced=await persist();fill(state.days[selected]);render();if(synced)$('settingsDialog').close();else $('settingsState').textContent='已导入本地，但尚未同步到云端'}catch{$('settingsState').textContent='导入失败：不是有效的科研工时备份'}finally{e.target.value=''}});
$('useCloud').addEventListener('click',()=>{if(!conflictData)return;state=conflictData.state?normalize(conflictData.state):initial();remoteRevision=conflictData.revision;conflictData=null;cloudReady=true;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));localStorage.removeItem(PENDING_KEY)}catch{}setSync('ok');fill(state.days[selected]);render()});
$('overwriteCloud').addEventListener('click',async()=>{if(!conflictData)return;remoteRevision=conflictData.revision;conflictData=null;cloudReady=true;const synced=await persist();$('saveState').textContent=synced?'已同步':'仅本地，待处理';render()});
