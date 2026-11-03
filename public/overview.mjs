const palette=['#286b58','#6677bc','#b26c4c','#af8e38','#3886a0','#9365a4','#658745','#b65374','#4c7890','#a77b58'];
const amount=v=>Number.isSafeInteger(v)?v:0;
const sum=values=>values.reduce((a,b)=>a+b,0);
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
export function buildOverview(plan,input,actual=null){
  const months=plan.monthly.filter(m=>m.month>=plan.startDate.slice(0,7));
  const series=[];
  const add=(key,label,values,color)=>series.push({key,label,values,color:color||palette[series.length%palette.length]});
  add('401k','Employee 401(k)',months.map(m=>m.k401Cents),'#286b58');
  add('ira','Roth IRA',months.map(m=>m.iraCents),'#6677bc');
  for(const loan of plan.loans)add(`loan:${loan.id}`,loan.name,months.map(m=>amount(m.loans?.[loan.id])));
  for(const goal of plan.goals??[])add(`goal:${goal.id}`,goal.name,months.map(m=>amount(m.goals?.[goal.id])));
  const mapped=new Set((input.mappings??[]).filter(m=>m.source!=='income').map(m=>m.categoryId));
  for(const goal of plan.goals??[])if(goal.categoryId)mapped.add(goal.categoryId);
  const mappedSources=new Set((input.mappings??[]).filter(m=>m.categoryId).map(m=>m.source));
  for(const goal of plan.goals??[])if(goal.categoryId)mappedSources.add(`goal:${goal.id}`);
  const unmappedSources=series.filter(s=>s.key!=='401k'&&s.values.some(v=>v>0)&&!mappedSources.has(s.key)).map(s=>s.label);
  const relevantActual=actual?.year===plan.year?actual:null;
  const incomeGroups=new Set((relevantActual?.groups??[]).filter(g=>g.is_income).map(g=>g.id));
  const actualMonths=months.map(m=>relevantActual?.budgets?.find(b=>b.month===m.month&&b.status==='read')?.budget??null);
  for(const c of (unmappedSources.length?[]:relevantActual?.categories)??[]){
    if(c.hidden||c.is_income||incomeGroups.has(c.group_id)||mapped.has(c.id))continue;
    const values=actualMonths.map(b=>Math.max(0,amount(b?.categoryGroups?.flatMap(g=>g.categories).find(item=>item.id===c.id)?.budgeted)));
    if(values.some(v=>v>0))add(`actual:${c.id}`,c.name,values);
  }
  const rows=months.map((m,i)=>{
    const committedCents=sum(series.map(s=>s.values[i])),grossCents=m.grossCents;
    return {month:m.month,grossCents,committedCents,remainingCents:Math.max(0,grossCents-committedCents),shortfallCents:Math.max(0,committedCents-grossCents),employerCents:m.employerCents,actualAvailable:!!actualMonths[i]&&!unmappedSources.length};
  });
  add('remaining','Unassigned in this view · before tax',rows.map(r=>r.remainingCents),'#dbe7da');
  const events=[];
  const retirement=(key,name,settings,finish)=>{
    const funded=settings.ytdCents>=settings.limitCents;
    events.push({key,name,startDate:plan.startDate,date:funded?plan.startDate:finish,targetDate:settings.targetDate,status:funded?'Already funded':finish?'Contributions finish':'Target not reached',finished:funded||!!finish});
  };
  retirement('401k','Employee 401(k)',input.k401,plan.k401FinishDate);
  retirement('ira','Roth IRA',input.ira,plan.iraFinishDate);
  for(const loan of plan.loans){const settings=input.loans.find(l=>l.id===loan.id);events.push({key:`loan:${loan.id}`,name:loan.name,startDate:plan.startDate,date:loan.payoffDate,targetDate:settings?.targetDate,status:loan.payoffDate?'Paid off':`Not paid off · ${money(loan.remainingCents)} remains at target`,finished:!!loan.payoffDate});}
  for(const goal of plan.goals??[])events.push({key:`goal:${goal.id}`,name:goal.name,startDate:plan.startDate,date:goal.reachedDate,targetDate:null,status:goal.reachedDate?(goal.balanceCents>=goal.targetCents?'Already funded':'Savings target reached'):'Not reached within 50 years',finished:!!goal.reachedDate});
  const lastEmployer=plan.rows.filter(r=>r.employerCents>0).at(-1)?.date;
  if(lastEmployer)events.push({key:'employer',name:'Employer contributions',startDate:plan.startDate,date:lastEmployer,targetDate:null,status:'Last contribution in this plan',finished:false});
  return {year:plan.year,startDate:plan.startDate,rows,series,events,hasActual:!!relevantActual,unmappedSources,missingMonths:rows.filter((r,i)=>!actualMonths[i]).map(r=>r.month)};
}
export function wageSplit(overview,month='all'){
  const indices=overview.rows.map((r,i)=>i).filter(i=>month==='all'||overview.rows[i].month===month);
  const grossCents=sum(indices.map(i=>overview.rows[i].grossCents));
  const parts=overview.series.map(s=>({...s,amountCents:sum(indices.map(i=>s.values[i]))}));
  const committedCents=sum(parts.filter(s=>s.key!=='remaining').map(s=>s.amountCents));
  const remainder=parts.find(s=>s.key==='remaining');if(remainder)remainder.amountCents=Math.max(0,grossCents-committedCents);
  for(const part of parts)part.percent=grossCents>0?part.amountCents/grossCents*100:null;
  return {grossCents,committedCents,parts,netRemainderCents:grossCents-committedCents,shortfallCents:Math.max(0,committedCents-grossCents),monthlyShortfallCents:sum(indices.map(i=>overview.rows[i].shortfallCents)),employerCents:sum(indices.map(i=>overview.rows[i].employerCents)),incomplete:indices.some(i=>!overview.rows[i].actualAvailable)};
}
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function svgNode(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function svgRoot(width,height,label){return svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':label,class:'overview-svg'});}
function title(node,text){node.append(svgNode('title',{},text));}
function legendPart(color,label){const item=el('span',undefined,'overview-legend-item'),swatch=svgNode('svg',{viewBox:'0 0 12 12','aria-hidden':'true',class:'overview-swatch'});swatch.append(svgNode('rect',{width:12,height:12,rx:3,fill:color}));item.append(swatch,document.createTextNode(label));return item;}
export function renderOverview(plan,input,actual){
  const overview=buildOverview(plan,input,actual),root=document.getElementById('overview'),bottom=document.getElementById('wage-split');root.hidden=false;bottom.hidden=false;
  const charts=document.getElementById('overview-charts');charts.replaceChildren();
  const coverage=el('p',undefined,'note');coverage.textContent=overview.unmappedSources.length?`Map ${overview.unmappedSources.join(', ')} to Actual categories in Populate below. Until then, existing Actual expense allocations are excluded to avoid counting the same commitment twice. This graph currently shows modeled plan items only.`:overview.missingMonths.length?`Actual allocations unavailable for ${overview.missingMonths.join(', ')}. These months show modeled plan items only; unassigned amounts are incomplete.`:'Includes existing Actual allocations outside your mapped plan categories.';charts.append(coverage);
  charts.append(el('p',`From ${plan.startDate}. Forecast contributions replace mapped category amounts in this view, while other positive Actual allocations are included. Partial-month protection is handled separately in the budget preview. Taxes and benefits are not modeled.`,'muted'));
  const selected=document.getElementById('wage-scope'),previousScope=selected.value;selected.replaceChildren(new Option('All planned dates','all'),...overview.rows.map(r=>new Option(r.month,r.month)));if([...selected.options].some(option=>option.value===previousScope))selected.value=previousScope;
  const detail=el('div',undefined,'overview-detail');detail.setAttribute('aria-live','polite');
  const redrawSplit=()=>{
    const month=selected.value,split=wageSplit(overview,month),holder=document.getElementById('wage-split-content');holder.replaceChildren();
    holder.append(el('p',`${month==='all'?`Planned ${plan.year} wages from ${plan.startDate}`:month} · ${money(split.grossCents)} gross wage. Percentages use this amount as 100%.`));
    if(!split.grossCents)holder.append(el('p','No wage is scheduled in this selection. Percentages are unavailable.','note'));
    if(split.incomplete)holder.append(el('p',overview.unmappedSources.length?'Incomplete: map the active plan sources to Actual categories to include existing expenses without double-counting. Unassigned amounts must still cover those costs, taxes and benefits.':'Incomplete: some Actual allocations could not be read. Unassigned amounts still need to cover missing costs, taxes and benefits.','note'));
    const total=sum(split.parts.map(p=>p.amountCents)),max=Math.max(split.grossCents,total,1),bar=svgRoot(960,88,'Percentage allocation of planned gross wage');bar.classList.add('wage-percentage-bar');let x=0;
    for(const part of split.parts){const width=part.amountCents/max*920;if(!width)continue;const rect=svgNode('rect',{x:20+x,y:12,width,height:36,fill:part.color,tabindex:0,role:'img','aria-label':`${part.label}: ${money(part.amountCents)}, ${part.percent===null?'no wage':part.percent.toFixed(1)+'%'}`});title(rect,rect.getAttribute('aria-label'));bar.append(rect);x+=width;}
    const boundary=20+split.grossCents/max*920;bar.append(svgNode('line',{x1:boundary,x2:boundary,y1:7,y2:55,stroke:'#183834','stroke-width':2}),svgNode('text',{x:Math.min(920,Math.max(40,boundary)),y:75,'text-anchor':'end','font-size':13,fill:'#183834'},split.grossCents?'100% of wage':'No wage'));holder.append(bar);
    if(split.shortfallCents)holder.append(el('p',`Overallocated by ${money(split.shortfallCents)} (${split.grossCents?(split.shortfallCents/split.grossCents*100).toFixed(1)+'% of wage':'no scheduled wage'}). The bar extends beyond the 100% marker.`,'overview-shortfall'));
    if(month==='all'&&split.monthlyShortfallCents)holder.append(el('p',`Individual months have ${money(split.monthlyShortfallCents)} of combined shortfalls before taxes and benefits. Annual totals can mask these timing gaps.`,'overview-shortfall'));
    const breakdown=el('div',undefined,'wage-breakdown');
    for(const part of split.parts){const row=el('div',undefined,'wage-part');row.append(legendPart(part.color,part.label),el('strong',part.percent===null?'—':`${part.percent.toFixed(1)}%`),el('span',money(part.amountCents)));breakdown.append(row);}holder.append(breakdown);
    holder.append(el('p',`Employer contributions: ${money(split.employerCents)} extra, shown separately and excluded from wage percentages. Unassigned money is not take-home pay. This chart is a forecast, not a confirmation that allocations were applied.`,'muted'));
    detail.textContent=month==='all'?`All planned dates: ${money(split.grossCents)} gross wages; ${money(split.committedCents)} planned allocations; ${money(split.netRemainderCents)} net unassigned before taxes and benefits.`:`${month}: ${money(split.grossCents)} gross wages; ${money(split.committedCents)} planned allocations; ${money(split.netRemainderCents)} net unassigned before taxes and benefits.`;
  };
  selected.onchange=redrawSplit;
  charts.append(el('h3','Monthly wage & allocation forecast'),el('p','Select a month in the chart to inspect its wage percentages below. Hover or focus a bar for amounts.','muted'));
  const monthly=svgRoot(960,360,'Monthly wage breakdown, gross wage line and separate employer contributions');monthly.setAttribute('role','group');
  const peak=Math.max(1,...overview.rows.map(r=>Math.max(r.grossCents,r.committedCents,r.employerCents))),tickBase=10**Math.floor(Math.log10(peak/4)),max=Math.ceil(peak/4/tickBase)*tickBase*4,plot={left:88,top:20,width:840,height:270};
  const y=v=>plot.top+plot.height-v/max*plot.height;
  for(let i=0;i<=4;i++){const v=max*i/4;monthly.append(svgNode('line',{x1:plot.left,y1:y(v),x2:928,y2:y(v),stroke:'#dce4da'}),svgNode('text',{x:78,y:y(v)+4,'text-anchor':'end','font-size':12,fill:'#53786b'},money(v)));}
  const step=plot.width/overview.rows.length,points=[],employerPoints=[];
  overview.rows.forEach((row,i)=>{
    const x=plot.left+i*step+step*.18,width=step*.64,g=svgNode('g',{tabindex:0,role:'button','aria-label':`${row.month}: gross ${money(row.grossCents)}, planned ${money(row.committedCents)}, unassigned ${money(row.grossCents-row.committedCents)}. Select wage breakdown.`});
    let accumulated=0;for(const s of overview.series){const v=s.values[i];if(v){g.append(svgNode('rect',{x,y:y(accumulated+v),width,height:v/max*plot.height,fill:s.color}));accumulated+=v;}}
    const choose=()=>{selected.value=row.month;redrawSplit();};g.addEventListener('click',choose);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
    title(g,`${row.month}\n${overview.series.map(s=>`${s.label}: ${money(s.values[i])}`).join('\n')}\nGross wage: ${money(row.grossCents)}\nEmployer extra: ${money(row.employerCents)}${row.actualAvailable?'':'\nActual allocations incomplete'}`);monthly.append(g);
    const cx=x+width/2;points.push([cx,y(row.grossCents)]);employerPoints.push([cx,y(row.employerCents)]);monthly.append(svgNode('text',{x:cx,y:316,'text-anchor':'middle','font-size':12,fill:'#53786b'},new Date(row.month+'-01T00:00:00Z').toLocaleString('en-US',{month:'short',timeZone:'UTC'})+(row.actualAvailable?'':'*')));
    if(row.shortfallCents)monthly.append(svgNode('text',{x:cx,y:y(row.committedCents)-7,'text-anchor':'middle','font-size':11,fill:'#ad3c39'},'Over'));
  });
  for(const [pointsList,color,dash]of [[points,'#183834',''],[employerPoints,'#b3872b','5 4']])monthly.append(svgNode('path',{d:pointsList.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' '),fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':dash,'pointer-events':'none'}));
  monthly.append(svgNode('text',{x:88,y:345,'font-size':12,fill:'#53786b'},`${plan.year} · * Actual allocations incomplete · Dark line: gross wage · Dashed gold: employer extra`));
  const scroller=el('div',undefined,'overview-scroll');scroller.append(monthly);charts.append(scroller);
  const legend=el('div',undefined,'overview-legend');for(const s of overview.series)legend.append(legendPart(s.color,s.label));charts.append(legend,detail);
  charts.append(el('h3','When contributions, loans & goals finish'),el('p','Solid dots show projected finishes. Open circles show requested target dates. Employer dates mark only the last contribution within this plan.','muted'));
  const start=Date.parse(plan.startDate),yearEnd=Date.parse(`${plan.year}-12-31`),last=Math.max(yearEnd,...overview.events.flatMap(e=>[e.date,e.targetDate].filter(Boolean).map(Date.parse))),domain=Math.max(86400000,last-start),timeline=svgRoot(1040,80+overview.events.length*46,'Finish timeline for retirement contributions, each loan and each savings goal');
  const tx=d=>235+(Math.max(start,Date.parse(d))-start)/domain*470;
  for(let i=0;i<=4;i++){const day=new Date(start+domain*i/4).toISOString().slice(0,10),x=tx(day);timeline.append(svgNode('text',{x,y:24,'text-anchor':'middle','font-size':11,fill:'#53786b'},day),svgNode('line',{x1:x,x2:x,y1:33,y2:65+overview.events.length*46,stroke:'#e1e7dc'}));}
  overview.events.forEach((event,i)=>{const y=58+i*46,color=overview.series.find(s=>s.key===event.key)?.color||'#b3872b',name=event.name.length>27?event.name.slice(0,26)+'…':event.name,label=svgNode('text',{x:12,y:y+4,'font-size':13,fill:'#183834'},name);title(label,event.name);timeline.append(label);
    const end=event.date||event.targetDate||`${plan.year}-12-31`;timeline.append(svgNode('line',{x1:235,x2:tx(end),y1:y,y2:y,stroke:color,'stroke-width':7,'stroke-dasharray':event.date?'':'5 4'}));
    if(event.targetDate){const target=svgNode('circle',{cx:tx(event.targetDate),cy:y,r:7,fill:'#fff',stroke:color,'stroke-width':2});title(target,`${event.name} requested target: ${event.targetDate}`);timeline.append(target);}
    if(event.date){const dot=svgNode('circle',{cx:tx(event.date),cy:y,r:5,fill:color});title(dot,`${event.name}: ${event.status} ${event.date}`);timeline.append(dot);}
    const statusText=event.date?`${event.date} · ${event.status}`:event.status;const status=svgNode('text',{x:725,y:y+4,'font-size':12,fill:'#53786b'},statusText.length>43?statusText.slice(0,42)+'…':statusText);title(status,`${event.name}: ${event.status}${event.targetDate?' · requested '+event.targetDate:''}`);timeline.append(status);
  });
  const timelineScroll=el('div',undefined,'overview-scroll overview-timeline');timelineScroll.append(timeline);charts.append(timelineScroll);
  const details=el('details'),summary=el('summary','Accessible finish dates & monthly figures'),table=el('table'),head=el('tr');for(const name of ['Item','Projected finish','Requested target','Status'])head.append(el('th',name));table.append(head);for(const event of overview.events){const row=el('tr');for(const value of [event.name,event.date||'Not reached',event.targetDate||'—',event.status])row.append(el('td',value));table.append(row);}details.append(summary,table);const figures=el('div',undefined,'scroll'),monthlyTable=el('table'),mh=el('tr');for(const value of ['Month','Gross wage',...overview.series.map(s=>s.label),'Employer extra','Shortfall'])mh.append(el('th',value));monthlyTable.append(mh);overview.rows.forEach((r,i)=>{const tr=el('tr');for(const v of [r.month,money(r.grossCents),...overview.series.map(s=>money(s.values[i])),money(r.employerCents),money(r.shortfallCents)])tr.append(el('td',v));monthlyTable.append(tr);});figures.append(monthlyTable);details.append(figures);charts.append(details);
  redrawSplit();
}
