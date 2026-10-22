// 国务院办公厅 2025、2026 年部分节假日安排；只列出相对正常双休的例外。
// 2025: https://www.forestry.gov.cn/c/www/szxx/594663.jhtml
// 2026: https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html
const schedules = {
  2025: {
    holidays: [
      ['2025-01-01','2025-01-01','元旦'],
      ['2025-01-28','2025-02-04','春节'],
      ['2025-04-04','2025-04-06','清明节'],
      ['2025-05-01','2025-05-05','劳动节'],
      ['2025-05-31','2025-06-02','端午节'],
      ['2025-10-01','2025-10-08','国庆节·中秋节'],
    ],
    workdays: ['2025-01-26','2025-02-08','2025-04-27','2025-09-28','2025-10-11'],
  },
  2026: {
    holidays: [
      ['2026-01-01','2026-01-03','元旦'],
      ['2026-02-15','2026-02-23','春节'],
      ['2026-04-04','2026-04-06','清明节'],
      ['2026-05-01','2026-05-05','劳动节'],
      ['2026-06-19','2026-06-21','端午节'],
      ['2026-09-25','2026-09-27','中秋节'],
      ['2026-10-01','2026-10-07','国庆节'],
    ],
    workdays: ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'],
  },
};

const weekdayNames=['周日','周一','周二','周三','周四','周五','周六'];
export function daySchedule(dateString) {
  const date=new Date(`${dateString}T12:00:00`);
  if(Number.isNaN(date.getTime())) return {kind:'unknown',rest:false,label:'日期无效',weekday:'',official:false};
  const weekday=weekdayNames[date.getDay()];
  const published=schedules[date.getFullYear()];
  if(published?.workdays.includes(dateString)) return {kind:'makeup',rest:false,label:'周末补班',weekday,official:true};
  const holiday=published?.holidays.find(([start,end])=>dateString>=start&&dateString<=end);
  if(holiday) return {kind:'holiday',rest:true,label:`${holiday[2]}假期`,weekday,official:true};
  const rest=date.getDay()===0||date.getDay()===6;
  return {kind:rest?'weekend':'weekday',rest,label:rest?weekday:'工作日',weekday,official:!!published};
}

export function monthDates(year,month){
  const first=new Date(year,month-1,1,12);
  const offset=(first.getDay()+6)%7;
  const days=new Date(year,month,0,12).getDate();
  return {offset,dates:Array.from({length:days},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)};
}
