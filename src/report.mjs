import {PDFDocument} from 'pdfkit';

const text=value=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\n]/g,'');
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

export async function renderPlanPdf({input,plan,preview=null}) {
  const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`ActualPlanning annual plan ${plan.year}`,Author:'ActualPlanning'}});
  const chunks=[];
  const output=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const width=doc.page.width-84,bottom=()=>doc.page.height-55;
  let y=42;
  const nextPage=()=>{doc.addPage();y=42;};
  function paragraph(value,size=10,color='#183834'){
    doc.font('Helvetica').fontSize(size).fillColor(color);
    const valueText=text(value),height=doc.heightOfString(valueText,{width});
    if(y+height>bottom())nextPage();
    doc.text(valueText,42,y,{width});y+=height+9;
  }
  function heading(value){if(y+50>bottom())nextPage();y+=8;doc.font('Helvetica-Bold').fontSize(15).fillColor('#205d4b').text(text(value),42,y,{width});y+=28;}
  function table(headers,rows,widths){
    const draw=(values,header=false)=>{
      doc.font(header?'Helvetica-Bold':'Helvetica').fontSize(8.5);
      const height=Math.max(...values.map((value,i)=>doc.heightOfString(text(value),{width:widths[i]-10})))+12;
      if(height>bottom()-42)throw new Error('A report row is too large to fit on one page');
      if(y+height>bottom()){nextPage();if(!header)draw(headers,true);}
      const start=y;
      if(header)doc.rect(42,start,width,height).fill('#eaf0e5');
      let x=42;
      values.forEach((value,i)=>{doc.font(header?'Helvetica-Bold':'Helvetica').fontSize(8.5).fillColor('#183834').text(text(value),x+5,start+6,{width:widths[i]-10});x+=widths[i];});
      doc.moveTo(42,start+height).lineTo(42+width,start+height).lineWidth(.4).strokeColor('#dce4da').stroke();
      y=start+height;
    };
    draw(headers,true);rows.forEach(row=>draw(row));y+=15;
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#53786b').text('ACTUALPLANNING / ANNUAL PLAN',42,y);y+=25;
  doc.font('Times-Roman').fontSize(30).fillColor('#183834').text(`Your ${plan.year} plan`,42,y);y+=45;
  paragraph('Forecast and budget draft. This report does not apply changes to Actual.');
  heading('Income and contribution settings');
  table(['Setting','Value'],[
    ['Plan name',input.name||'Unsaved plan'],
    ['Annual salary before tax',money(input.annualGrossCents)],['First contribution / pay date',input.firstPayDate],['Frequency',input.frequency],['Calendar dates / remaining dates',`${plan.annualPayPeriods} / ${plan.rows.length}`],
    ['Employee 401(k) limit / prior YTD',`${money(input.k401.limitCents)} / ${money(input.k401.ytdCents)}`],['401(k) target / projected completion',`${input.k401.targetDate} / ${plan.k401FinishDate??'Not reached'}`],['401(k) contribution per date (up to)',money(plan.k401RequiredPerPeriodCents)],
    ['Combined IRA limit / prior YTD',`${money(input.ira.limitCents)} / ${money(input.ira.ytdCents)}`],['Roth IRA target / projected completion',`${input.ira.targetDate} / ${plan.iraFinishDate??'Not reached'}`],['Roth IRA contribution per date (up to)',money(plan.iraRequiredPerPeriodCents)],
    ['Employer method',input.employer.mode==='match'?'Match employee contributions':'Percentage of gross salary'],['Employer rate / eligible salary percentage',`${input.employer.ratePct}% / ${input.employer.mode==='match'?input.employer.matchSalaryCapPct+'%':'Not applicable'}`],['Employer annual cap / prior YTD',`${input.employer.annualCapCents===null?'No dollar cap':money(input.employer.annualCapCents)} / ${money(input.employer.ytdCents)}`],['Projected employer contribution',money(plan.employerContributionCents)]
  ],[width*.55,width*.45]);
  heading('Assumptions and limitations');
  for(const warning of plan.warnings)paragraph(warning,9,'#596755');
  nextPage();heading('Monthly amounts');
  table(['Month','Gross pay','Employee 401(k)','Employer','Roth IRA','Loans','Goals'],plan.monthly.map(r=>[r.month,...['grossCents','k401Cents','employerCents','iraCents','loanPaymentsCents','goalContributionsCents'].map(k=>money(r[k]))]),[60,75,75,75,75,75,width-435]);
  if(input.loans.length){
    heading('Loan settings');
    table(['Loan','Balance','APR','Target','Payment override'],input.loans.map(l=>[l.name,money(l.balanceCents),`${l.aprPct}%`,l.targetDate,l.monthlyPaymentCents?money(l.monthlyPaymentCents):'Automatic']),[151,90,50,100,width-391]);
    heading('Loan payoff projections');
    table(['Loan','Monthly payment','Payoff date','Interest to target','Remaining'],plan.loans.map(l=>[l.name,money(l.monthlyPaymentCents),l.payoffDate??'Not paid off',money(l.totalInterestCents),money(l.remainingCents)]),[151,90,100,85,width-426]);
  }
  for(const goal of plan.goals??[]){
    nextPage();heading(`Savings goal: ${goal.name}`);
    table(['Setting','Value'],[['Target / current savings',`${money(goal.targetCents)} / ${money(goal.balanceCents)}`],['Contribution / frequency',`${money(goal.contributionCents)} / ${goal.frequency}`],['APR / Actual category',`${goal.aprPct}% / ${goal.categoryName||(goal.categoryId?'Selected category':'Forecast only')}`],['Projected goal reached',goal.reachedDate??'Not reached within 50 years'],['Total deposits / forecast interest',`${money(goal.totalContributionsCents)} / ${money(goal.interestCents)}`]],[width*.5,width*.5]);
    paragraph(goal.assumption,9);
    if(y+210>bottom())nextPage();
    const top=y,left=100,chartWidth=width-65,chartHeight=140,start=Date.parse(goal.startDate),end=Math.max(start+86400000,Date.parse(goal.rows.at(-1).date)),max=Math.max(goal.targetCents,...goal.rows.map(r=>r.balanceCents),1);
    const x=d=>left+(Date.parse(d)-start)/(end-start)*chartWidth,gy=v=>top+chartHeight-v/max*chartHeight;
    for(let i=0;i<=4;i++){const v=max*i/4;doc.moveTo(left,gy(v)).lineTo(left+chartWidth,gy(v)).lineWidth(.4).strokeColor('#dce4da').stroke();doc.font('Helvetica').fontSize(8).fillColor('#53786b').text(money(v),42,gy(v)-4,{width:52,align:'right'});}
    doc.moveTo(left,gy(goal.targetCents)).lineTo(left+chartWidth,gy(goal.targetCents)).dash(4,{space:3}).strokeColor('#9a7131').stroke().undash();
    for(const [color,value]of [['#8caa98',r=>goal.balanceCents+r.totalContributionsCents],['#205d4b',r=>r.balanceCents]]){goal.rows.forEach((r,i)=>{if(i===0)doc.moveTo(x(r.date),gy(value(r)));else doc.lineTo(x(r.date),gy(value(r)));});doc.lineWidth(1.5).strokeColor(color).stroke();}
    doc.font('Helvetica').fontSize(8).fillColor('#53786b').text(goal.startDate,left,top+chartHeight+8).text(goal.rows.at(-1).date,left+chartWidth-80,top+chartHeight+8,{width:80,align:'right'});y=top+chartHeight+30;
    paragraph('Dark green: forecast balance. Light green: starting savings plus contributions. Dashed gold: target.',8);
    const years=new Map();for(const r of goal.rows){const year=r.date.slice(0,4),entry=years.get(year)??{contributions:0,final:r};entry.contributions+=r.contributionCents;entry.final=r;years.set(year,entry);}
    table(['Year','Contributions','Cumulative interest','Forecast balance'],[...years].map(([year,r])=>[year,money(r.contributions),money(r.final.interestCents),money(r.final.balanceCents)]),[70,140,150,width-360]);
  }
  nextPage();heading('Contribution dates and running totals');
  table(['Date','Gross pay','401(k)','401(k) YTD','Employer','Roth IRA','IRA YTD'],plan.rows.map(r=>[r.date,...['grossCents','k401Cents','k401YtdCents','employerCents','iraCents','iraYtdCents'].map(k=>money(r[k]))]),[64,75,72,75,75,75,width-436]);
  nextPage();heading('Actual budget preview');
  if(preview){
    paragraph(`Budget preview: ${preview.cells.length} selected category/month cells. Existing allocations in a partial first month may be retained separately from the remaining-period forecast.`,9);
    table(['Month','Category','Actual now','Proposed','Change','Note'],preview.cells.map(c=>[c.month,c.categoryName,c.beforeCents===null?'Unavailable':money(c.beforeCents),money(c.amountCents),c.deltaCents===null?'Unavailable':money(c.deltaCents),c.preserved?`Kept existing. Remaining-period forecast: ${money(c.forecastAmountCents)}`:'']),[62,127,68,68,66,width-391]);
  }else paragraph('No category preview included. Populate selected values first to include all proposed budget allocations.');
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);const margin=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font('Helvetica').fontSize(8).fillColor('#6c7d75').text(`ActualPlanning - ${plan.year} - Page ${i+1} of ${range.count}`,42,doc.page.height-28,{width,align:'right',lineBreak:false});doc.page.margins.bottom=margin;
  }
  doc.end();
  return output;
}
