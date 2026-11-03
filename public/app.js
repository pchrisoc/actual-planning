const $=id=>document.getElementById(id),form=$('plan');
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
let categoryMappings=new Map(),actualRequest=0,planRevision=0,calculationRequest=0,previewRequest=0,recalculateTimer;
let goalId=0,loanId=0,current=null,actual=null,preview=null,config={actualWriteEnabled:false},requestKey=null;
function message(text,error=false){$('message').hidden=false;$('message').textContent=text;$('message').className=error?'error':'success';}
async function api(path,data){const response=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const result=await response.json();if(!response.ok)throw new Error(result.error||result.message||`Request failed (${response.status})`);return result;}
function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function table(target,headers,rows){const t=el('table'),head=el('thead'),r=el('tr');headers.forEach(h=>r.append(el('th',h)));head.append(r);t.append(head);const body=el('tbody');for(const values of rows){const row=el('tr');values.forEach(v=>row.append(el('td',v)));body.append(row);}t.append(body);target.replaceChildren(t);}
function clearPreview(){previewRequest++;preview=null;requestKey=null;$('apply').disabled=true;$('download-budget').disabled=true;$('apply-controls').hidden=true;$('preview').replaceChildren();}
function invalidate(){planRevision++;current=null;clearPreview();$('goal-results').hidden=true;if(!$('results').hidden)$('period-count').textContent='Inputs changed — recalculating';}
function scheduleCalculate(){clearTimeout(recalculateTimer);if($('results').hidden&&!$('goals').children.length)return;recalculateTimer=setTimeout(()=>{if(form.checkValidity())calculate().catch(e=>{if(e.name!=='PlanChangedError')message(e.message,true);});},250);}
function loanField(label,key,type,value){const l=el('label',label),i=el('input');i.type=type;i.dataset.field=key;i.value=value??'';if(type==='number'){i.min='0';i.step='.01';}if(key!=='monthlyPayment')i.required=true;if(key==='monthlyPayment')i.placeholder='Calculate automatically';l.append(i);return l;}
function addLoan(data){const id=data?.id||`loan-${++loanId}-${Date.now()}`;const card=el('div',undefined,'loan');card.dataset.id=id;const row=el('div',undefined,'fields loan-fields');const year=form.elements.year.value;for(const f of [['Loan name','name','text',data?.name||`Loan ${$('loans').children.length+1}`],['Outstanding balance ($)','balance','number',data?data.balanceCents/100:0],['APR (%)','apr','number',data?.aprPct??5.5],['Desired payoff date','targetDate','date',data?.targetDate||`${year}-12-31`],['Monthly payment override ($)','monthlyPayment','number',data?.monthlyPaymentCents?data.monthlyPaymentCents/100:'']])row.append(loanField(...f));const remove=el('button','Remove','text-button');remove.type='button';remove.onclick=()=>{categoryMappings.delete(`loan:${card.dataset.id}`);card.remove();invalidate();renderMappings();scheduleCalculate();};card.append(row,remove);$('loans').append(card);invalidate();renderMappings();}

function addGoal(data){
  const card=el('div',undefined,'loan');card.dataset.id=data?.id||`goal-${++goalId}-${Date.now()}`;
  const row=el('div',undefined,'fields goal-fields');
  for(const f of [['Goal name','name','text',data?.name||'House Savings'],['Target amount ($)','target','number',data?data.targetCents/100:50000],['Current savings ($)','balance','number',data?data.balanceCents/100:0],['Expected APR (%)','apr','number',data?.aprPct??0],['Contribution each period ($)','contribution','number',data?data.contributionCents/100:500]])row.append(loanField(...f));
  for(const [label,key,options,value]of [['Contribution frequency','frequency',[['weekly','Weekly'],['biweekly','Biweekly (every 2 weeks)'],['monthly','Monthly']],data?.frequency||'monthly']]){
    const l=el('label',label),select=el('select');select.dataset.field=key;for(const [v,t]of options)select.append(new Option(t,v));select.value=value;select.dataset.saved=value;l.append(select);row.append(l);
  }
  const remove=el('button','Remove goal','text-button');remove.type='button';remove.onclick=()=>{categoryMappings.delete(`goal:${card.dataset.id}`);card.remove();invalidate();renderMappings();scheduleCalculate();};
  card.append(row,remove);$('goals').append(card);if(data?.categoryId&&!categoryMappings.has(`goal:${card.dataset.id}`))categoryMappings.set(`goal:${card.dataset.id}`,data.categoryId);renderMappings();invalidate();
}
function mappingInputs(){return [...$('mapping').querySelectorAll('select')].filter(s=>s.value).map(s=>({source:s.dataset.source,categoryId:s.value}));}
function mappingName(source){const select=[...$('mapping').querySelectorAll('select')].find(s=>s.dataset.source===source);return select?.value?select.selectedOptions[0]?.textContent||'':'';}
function goalInputs(){return [...$('goals').children].map(card=>{const v=k=>card.querySelector(`[data-field="${k}"]`).value;return {id:card.dataset.id,name:v('name'),categoryId:categoryMappings.get(`goal:${card.dataset.id}`)||'',categoryName:mappingName(`goal:${card.dataset.id}`),targetCents:Math.round(Number(v('target'))*100),balanceCents:Math.round(Number(v('balance'))*100),aprPct:Number(v('apr')),contributionCents:Math.round(Number(v('contribution'))*100),frequency:v('frequency')};});}
function goalChart(goal){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 280');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${goal.name}: projected balance over time. ${goal.reachedDate?'Target reached '+goal.reachedDate:'Target not reached within 50 years'}.`);
  const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
  const rows=goal.rows,start=Date.parse(goal.startDate),end=Math.max(start+86400000,Date.parse(rows.at(-1).date)),max=Math.max(goal.targetCents,...rows.map(r=>r.balanceCents),1);
  const x=date=>80+(Date.parse(date)-start)/(end-start)*650,y=value=>230-value/max*200;
  for(let i=0;i<=4;i++){const v=max*i/4;add('line',{x1:80,y1:y(v),x2:730,y2:y(v),stroke:'#dce4da'});add('text',{x:72,y:y(v)+4,'text-anchor':'end','font-size':11,fill:'#53786b'},money(v));}
  const sample=rows.filter((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/350))===0);
  add('line',{x1:80,y1:y(goal.targetCents),x2:730,y2:y(goal.targetCents),stroke:'#9a7131','stroke-dasharray':'5 4'});
  add('path',{d:sample.map((r,i)=>`${i?'L':'M'}${x(r.date)},${y(goal.balanceCents+r.totalContributionsCents)}`).join(' '),fill:'none',stroke:'#8caa98','stroke-width':2});
  add('path',{d:sample.map((r,i)=>`${i?'L':'M'}${x(r.date)},${y(r.balanceCents)}`).join(' '),fill:'none',stroke:'#205d4b','stroke-width':3});
  for(const r of sample){const dot=add('circle',{cx:x(r.date),cy:y(r.balanceCents),r:3,fill:'#205d4b'}),title=document.createElementNS(ns,'title');title.textContent=`${r.date}: ${money(r.balanceCents)}; added ${money(r.contributionCents)}`;dot.append(title);}
  add('text',{x:80,y:257,'font-size':12,fill:'#53786b'},goal.startDate);add('text',{x:730,y:257,'text-anchor':'end','font-size':12,fill:'#53786b'},rows.at(-1).date);
  return svg;
}
function renderGoals(goals){
  $('goal-results').hidden=!goals.length;$('goal-forecasts').replaceChildren();
  for(const goal of goals){const card=el('article',undefined,'goal-forecast');card.append(el('h3',goal.name));
    card.append(el('p',goal.reachedDate?`Expected goal reached: ${goal.reachedDate}`:'Goal not reached within the 50-year forecast. Increase contributions or review the target.','goal-date'));
    const category=actual?.categories.find(c=>c.id===goal.categoryId);
    card.append(el('p',`${money(goal.balanceCents)} starting savings + ${money(goal.totalContributionsCents)} contributions + ${money(goal.interestCents)} forecast interest. ${money(goal.contributionCents)} ${goal.frequency}. Category: ${category?.name||(goal.categoryId?'Saved category':'Not selected — forecast only')}.`));
    card.append(goalChart(goal),el('p','Dark green: forecast balance · Light green: starting savings + contributions · Dashed gold: target','muted'),el('p',goal.assumption,'muted'));
    const details=el('details'),summary=el('summary','Contribution dates, balances & interest'),holder=el('div',undefined,'scroll');details.append(summary,holder);
    details.addEventListener('toggle',()=>{if(details.open&&!holder.children.length)table(holder,['Date','Contribution','Total contributed','Interest earned','Forecast balance'],goal.rows.map(r=>[r.date,...['contributionCents','totalContributionsCents','interestCents','balanceCents'].map(k=>money(r[k]))]));});card.append(details);$('goal-forecasts').append(card);
  }
}

function input(){const f=new FormData(form),n=k=>Number(f.get(k)),c=k=>Math.round(n(k)*100);return {version:2,name:$('plan-name').value.trim(),year:n('year'),annualGrossCents:c('annualGross'),firstPayDate:f.get('firstPayDate'),frequency:f.get('frequency'),goals:goalInputs(),mappings:mappingInputs(),k401:{limitCents:c('kLimit'),ytdCents:c('kYtd'),targetDate:f.get('kTarget')},ira:{limitCents:c('iraLimit'),ytdCents:c('iraYtd'),targetDate:f.get('iraTarget')},employer:{mode:f.get('employerMode'),ratePct:n('employerRate'),matchSalaryCapPct:n('matchSalaryCap'),annualCapCents:f.get('employerCap')===''?null:c('employerCap'),ytdCents:c('employerYtd')},loans:[...$('loans').children].map(card=>{const v=k=>card.querySelector(`[data-field="${k}"]`).value;return {id:card.dataset.id,name:v('name'),balanceCents:Math.round(Number(v('balance'))*100),aprPct:Number(v('apr')),targetDate:v('targetDate'),monthlyPaymentCents:Math.round(Number(v('monthlyPayment'))*100)};})};}
function render(result,plan){current={input:plan,result};$('results').hidden=false;$('period-count').textContent=`${result.rows.length} dates remaining · ${result.annualPayPeriods} in year`;$('summary').replaceChildren();for(const[label,value]of [['401(k) each period (up to)',money(result.k401RequiredPerPeriodCents)],['401(k) finishes',result.k401FinishDate||'Target not reached'],['Roth IRA each period (up to)',money(result.iraRequiredPerPeriodCents)],['Roth finishes',result.iraFinishDate||'Target not reached'],['Employer contribution',money(result.employerContributionCents)]]){const c=el('div',label,'card');c.append(el('strong',value));$('summary').append(c);}$('warnings').replaceChildren(...result.warnings.map(w=>el('p',w)));table($('monthly'),['Month','Gross pay','Employee 401(k)','Employer','Roth IRA','Loans','Savings goals'],result.monthly.map(r=>[r.month,...['grossCents','k401Cents','employerCents','iraCents','loanPaymentsCents','goalContributionsCents'].map(k=>money(r[k]))]));table($('paydays'),['Date','Gross pay','401(k)','401(k) YTD','Employer','IRA','IRA YTD'],result.rows.map(r=>[r.date,...['grossCents','k401Cents','k401YtdCents','employerCents','iraCents','iraYtdCents'].map(k=>money(r[k]))]));table($('loan-results'),['Loan','Monthly payment','Payoff date','Interest to target','Remaining at target'],result.loans.map(l=>[l.name,money(l.monthlyPaymentCents),l.payoffDate||'Not paid off',money(l.totalInterestCents),money(l.remainingCents)]));renderMonths();renderGoals(result.goals||[]);}
async function calculate(){
  clearTimeout(recalculateTimer);if(!form.reportValidity())throw new Error('Complete the plan inputs');
  const revision=planRevision,request=++calculationRequest,plan=input(),result=await api('/api/calculate',plan);
  if(revision!==planRevision||request!==calculationRequest){const error=new Error('Plan changed while calculating. Recalculate the latest inputs.');error.name='PlanChangedError';throw error;}
  render(result,plan);return current;
}
function renderMonths(){const hadMonths=$('months').children.length>0,prior=[...$('months').querySelectorAll('input:checked')].map(i=>i.value.slice(5));$('months').replaceChildren();for(let m=1;m<=12;m++){const month=`${form.elements.year.value}-${String(m).padStart(2,'0')}`,l=el('label',undefined,'month'),i=el('input');i.type='checkbox';i.value=month;i.disabled=m<Number(form.elements.firstPayDate.value.slice(5,7));i.checked=!i.disabled&&(hadMonths?prior.includes(month.slice(5)):true);i.onchange=clearPreview;l.append(i,document.createTextNode(new Date(Number(form.elements.year.value),m-1,1).toLocaleString('en-US',{month:'short'})));$('months').append(l);}}
function renderMappings(){
  $('mapping').replaceChildren();
  const sources=[{id:'ira',name:'Roth IRA'},...[...$('loans').children].map(card=>({id:`loan:${card.dataset.id}`,name:card.querySelector('[data-field="name"]').value})),...[...$('goals').children].map(card=>({id:`goal:${card.dataset.id}`,name:`Savings goal: ${card.querySelector('[data-field="name"]').value||'Unnamed goal'}`}))];
  for(const source of sources){
    const label=el('label',source.name),select=el('select');select.dataset.source=source.id;select.setAttribute('aria-label',source.name);
    select.append(new Option(actual?'Do not populate':'Load Actual categories first',''));
    for(const c of actual?.categories.filter(c=>!c.hidden&&!c.is_income)||[]){const group=actual.groups.find(g=>g.id===c.group_id);select.append(new Option(`${group?.name||'Category'} / ${c.name}`,c.id));}
    const selected=categoryMappings.get(source.id)||'';
    if(selected&&![...select.options].some(o=>o.value===selected))select.append(new Option(actual?'Saved category unavailable — choose another':'Saved category — refresh Actual to verify',selected));
    select.value=selected;
    select.onchange=()=>{categoryMappings.set(source.id,select.value);invalidate();scheduleCalculate();};
    label.append(select);$('mapping').append(label);
  }
}
async function loadActual(){
  const b=$('read'),request=++actualRequest,year=Number(form.elements.year.value);b.disabled=true;
  try{
    const state=await api(`/api/actual/state?year=${year}`);
    if(request!==actualRequest||year!==Number(form.elements.year.value))return;
    actual={...state,year};$('connection').textContent=`${actual.budgetName} · ${actual.mode==='snapshot'?'Local snapshot':'Live connection'} · ${year} · Fetched ${new Date(actual.fetchedAt).toLocaleString()}`;renderMappings();
    const categories=actual.categories.filter(c=>!c.hidden);table($('budget'),['Category',...actual.budgets.map(b=>b.month)],categories.map(c=>[c.name,...actual.budgets.map(b=>{const item=b.budget?.categoryGroups?.flatMap(g=>g.categories).find(x=>x.id===c.id);return item?money(item.budgeted):'Unavailable';})]));
  }catch(e){if(request===actualRequest){actual=null;renderMappings();$('connection').textContent='Could not refresh Actual categories. Retry before populating.';message(e.message,true);}}
  finally{if(request===actualRequest)b.disabled=false;}
}
$('add-goal').onclick=()=>{addGoal();scheduleCalculate();};$('add-loan').onclick=()=>{addLoan();scheduleCalculate();};$('read').onclick=()=>{invalidate();loadActual().then(scheduleCalculate);};
function syncPlanningYear(){
  const year=Number(form.elements.year.value);if(!Number.isInteger(year)||year<2000||year>2100)return;
  if(Number(form.elements.firstPayDate.value.slice(0,4))===year)return;
  for(const name of ['firstPayDate','kTarget','iraTarget']){const field=form.elements[name];if(!field.value)continue;const [,month,day]=field.value.split('-').map(Number);field.value=new Date(Date.UTC(year,month-1,Math.min(day,new Date(Date.UTC(year,month,0)).getUTCDate()))).toISOString().slice(0,10);}
  actual=null;renderMappings();renderMonths();loadActual();
}
form.addEventListener('input',e=>{invalidate();if(e.target.name==='year')syncPlanningYear();if(e.target.name==='firstPayDate')renderMonths();if(e.target.dataset.field==='name')renderMappings();scheduleCalculate();});
form.addEventListener('change',e=>{if(e.target.name==='year')syncPlanningYear();if(e.target.name==='year'||e.target.name==='firstPayDate')renderMonths();});form.onsubmit=async e=>{e.preventDefault();try{await calculate();message('Plan calculated. Choose Actual categories below to populate your budget.');}catch(e){message(e.message,true);}};
$('populate').onclick=async()=>{try{clearPreview();await calculate();const revision=planRevision,request=previewRequest;if(!actual||actual.year!==Number(form.elements.year.value))await loadActual();if(!actual||actual.year!==Number(form.elements.year.value))throw new Error('Load Actual categories first');if(revision!==planRevision||request!==previewRequest)throw new Error('Plan changed. Populate the latest values again.');const mappings=mappingInputs(),months=[...$('months').querySelectorAll('input:checked')].map(i=>i.value);const draft=await api('/api/actual/preview',{plan:current.input,mappings,months,preserveStartMonth:$('preserve-start').checked});if(revision!==planRevision||request!==previewRequest)throw new Error('Plan changed. Populate the latest values again.');preview=draft;requestKey=crypto.randomUUID();table($('preview'),['Month','Selected category','Actual now','Proposed','Change','Note'],preview.cells.map(c=>[c.month,c.categoryName,c.beforeCents===null?'Unavailable':money(c.beforeCents),money(c.amountCents),c.deltaCents===null?'Unavailable':money(c.deltaCents),c.preserved?`Kept existing; remaining-period forecast ${money(c.forecastAmountCents)}`:'']));$('apply-controls').hidden=false;$('overwrite').checked=false;$('confirm').checked=false;$('download-budget').disabled=false;updateApply();message('Selected values populated into a draft. Nothing has been written to Actual.');}catch(e){message(e.message,true);}};
function writeStatus(){
  $('write-status').replaceChildren(el('strong',config.actualWriteEnabled?'Direct apply to Actual is enabled.':'Direct apply to Actual is OFF on this server.'));
  $('write-status').append(el('p',config.actualWriteEnabled?'Populate selected values only builds a draft. Review it and confirm below before applying.':config.snapshot?'This connection is a read-only snapshot. Connect to live Actual before applying. You can still preview and export a CSV.':'You can calculate, preview and export a CSV, but the Apply button stays disabled even after checking both boxes. Open “How to enable direct apply on your server” below for the setup steps. Nothing is applied automatically.'));
}
function updateApply(){
  const reasons=[];
  if(!preview?.writeEnabled)reasons.push(config.snapshot?'This is a read-only snapshot. Connect to live Actual to apply.':'Direct apply is OFF on the server. Open “How to enable direct apply on your server” above for setup steps; checking the boxes cannot enable it. You can export the budget CSV meanwhile.');
  const unavailable=[...new Set(preview?.cells.filter(c=>c.status!=='read').map(c=>c.month)||[])];
  if(unavailable.length)reasons.push(`Cannot read Actual allocations for ${unavailable.join(', ')}. Deselect those months above, then click Populate selected values again.`);
  if(preview?.writeEnabled&&preview.canApply&&preview.needsOverwrite&&!$('overwrite').checked)reasons.push('Check “Allow replacing” to approve the nonzero allocations that will change.');
  if(preview?.writeEnabled&&preview.canApply&&!$('confirm').checked)reasons.push('Check “I reviewed this preview” to confirm these amounts.');
  $('overwrite').disabled=!preview?.writeEnabled||!preview.canApply;$('confirm').disabled=!preview?.writeEnabled||!preview.canApply;
  const blocked=reasons.length>0;$('apply').disabled=blocked;$('apply').textContent=blocked?'Apply unavailable — see reasons above':'Apply reviewed budget to Actual';$('apply').setAttribute('aria-describedby','apply-status');
  $('apply-status').replaceChildren(el('strong',blocked?'This draft cannot be applied yet':'Ready to apply this reviewed draft'));
  if(blocked){const list=el('ul');for(const reason of reasons)list.append(el('li',reason));$('apply-status').append(list);}else $('apply-status').append(el('p','Applying creates a backup, writes only these allocations, syncs and verifies. This preview expires after 30 minutes.'));
}
$('preserve-start').onchange=clearPreview;
$('confirm').onchange=updateApply;$('overwrite').onchange=updateApply;
$('apply').onclick=async()=>{if(!preview)return;$('apply').disabled=true;try{const job=await api('/api/actual/apply',{previewId:preview.id,idempotencyKey:requestKey,confirmed:$('confirm').checked,allowOverwrite:$('overwrite').checked});message(`Budget ${job.status}. Backup: ${job.backup?.file||'recorded'}`);preview=null;await loadActual();}catch(e){message(e.message,true);}};
function download(name,type,content){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
$('export').onclick=async()=>{try{await calculate();download(`actual-plan-${current.input.year}.json`,'application/json',JSON.stringify(current,null,2));}catch(e){message(e.message,true);}};
$('download-budget').onclick=()=>{if(!preview)return;const quote=v=>'"'+String(v).replaceAll('"','""')+'"';download('actual-budget-draft.csv','text/csv',[['Month','Category','Category ID','Proposed cents'],...preview.cells.map(c=>[c.month,c.categoryName,c.categoryId,c.amountCents])].map(r=>r.map(quote).join(',')).join('\n'));};
async function list(){const{scenarios}=await api('/api/scenarios');$('saved').replaceChildren(new Option('Choose a saved plan',''));for(const plan of scenarios){const date=plan.createdAt?new Date(plan.createdAt).toLocaleString():'';$('saved').append(new Option(`${plan.name}${date?' · '+date:''}`,plan.id));}}
$('save').onclick=async()=>{try{if(!$('plan-name').value.trim()){$('plan-name').focus();throw new Error('Enter a plan name before saving');}await calculate();const saved=await api('/api/scenarios',current.input);await list();$('saved').value=saved.id;$('plan-name').value=saved.name;message(`Saved “${saved.name}”. Your newest plan is first in the list.`);}catch(e){message(e.message,true);}};
$('saved').onchange=async()=>{if(!$('saved').value)return;clearTimeout(recalculateTimer);invalidate();try{const saved=await api(`/api/scenarios/${$('saved').value}`),p=saved.input;if(p.version!==2)throw new Error('This is an older savings/debt scenario. It remains saved; create a new annual plan.');$('plan-name').value=saved.name||p.name||`Plan ${p.year} - ${saved.createdAt.slice(0,10)}`;const values={year:p.year,annualGross:p.annualGrossCents/100,firstPayDate:p.firstPayDate,frequency:p.frequency,kLimit:p.k401.limitCents/100,kYtd:p.k401.ytdCents/100,kTarget:p.k401.targetDate,iraLimit:p.ira.limitCents/100,iraYtd:p.ira.ytdCents/100,iraTarget:p.ira.targetDate,employerMode:p.employer.mode,employerRate:p.employer.ratePct,matchSalaryCap:p.employer.matchSalaryCapPct,employerCap:p.employer.annualCapCents===null?'':p.employer.annualCapCents/100,employerYtd:p.employer.ytdCents/100};for(const[k,v]of Object.entries(values))form.elements[k].value=v;categoryMappings=new Map((p.mappings||[]).map(m=>[m.source,m.categoryId]));$('loans').replaceChildren();$('goals').replaceChildren();p.loans.forEach(addLoan);(p.goals||[]).forEach(addGoal);invalidate();renderMonths();renderMappings();render(await api('/api/calculate',p),p);if(!actual||actual.year!==p.year)await loadActual();message('Saved plan loaded with its category mappings.');}catch(e){message(e.message,true);}};
renderMonths();renderMappings();api('/api/config').then(c=>{config=c;writeStatus();}).catch(()=>{});list().catch(()=>{});loadActual();

$('export-pdf').onclick=async()=>{const button=$('export-pdf');button.disabled=true;try{await calculate();const response=await fetch('/api/export/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan:current.input,previewId:preview?.id})});if(!response.ok){const error=await response.json();throw new Error(error.error||'PDF export failed');}download(`actual-plan-${current.input.year}.pdf`,'application/pdf',await response.arrayBuffer());message('Complete PDF downloaded, including every contribution date and populated budget row.');}catch(e){message(e.message,true);}finally{button.disabled=false;}};
