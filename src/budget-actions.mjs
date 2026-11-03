export async function inspectAllocations(api, allocations) {
  if(!Array.isArray(allocations)||!allocations.length||allocations.length>500)throw new Error('Provide 1–500 budget cells');
  const categories=await api.getCategories();
  const groups=api.getCategoryGroups?await api.getCategoryGroups():[];
  const incomeGroups=new Set(groups.filter(g=>g.is_income).map(g=>g.id));
  const valid=new Set(categories.filter(c=>!c.hidden&&!c.is_income&&!incomeGroups.has(c.group_id)).map(c=>c.id));
  const months=new Map(),seen=new Set();
  const cells=[];
  for(const cell of allocations){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(cell.month)||!valid.has(cell.categoryId)||!Number.isSafeInteger(cell.amountCents)||cell.amountCents<0||cell.amountCents>1e12)throw new Error('Invalid budget allocation');
    const key=`${cell.month}/${cell.categoryId}`;if(seen.has(key))throw new Error('Duplicate budget cell');seen.add(key);
    if(!months.has(cell.month)){
      try{months.set(cell.month,await api.getBudgetMonth(cell.month));}catch{months.set(cell.month,null);}
    }
    const category=months.get(cell.month)?.categoryGroups?.flatMap(g=>g.categories).find(c=>c.id===cell.categoryId);
    const beforeCents=Number.isSafeInteger(category?.budgeted)?category.budgeted:null;
    const forecastAmountCents=cell.forecastAmountCents??cell.amountCents;
    const preserved=cell.preserveExisting===true&&beforeCents!==null&&beforeCents>0;
    const amountCents=preserved?beforeCents:forecastAmountCents;
    cells.push({...cell,amountCents,forecastAmountCents,preserved,note:preserved?'Existing allocation kept: the plan starts partway through this month.':'',categoryName:categories.find(c=>c.id===cell.categoryId).name,beforeCents,deltaCents:beforeCents===null?null:amountCents-beforeCents,status:beforeCents===null?'unavailable':'read'});
  }
  return {cells,canApply:cells.every(c=>c.status==='read'),needsOverwrite:cells.some(c=>c.beforeCents!==0&&c.deltaCents!==0)};
}
export async function applyAllocations(api, preview, {allowOverwrite, backup}) {
  if(!preview.canApply)throw new Error('Unreadable months cannot be applied');
  const current=await inspectAllocations(api,preview.cells);
  if(!current.canApply||current.cells.some((c,i)=>c.beforeCents!==preview.cells[i].beforeCents))throw new Error('Actual changed since preview. Generate a new preview.');
  if(current.needsOverwrite&&!allowOverwrite)throw new Error('Confirm replacement of existing nonzero allocations');
  const artifact=await backup(api);
  for(const c of current.cells.filter(c=>c.deltaCents!==0))await api.setBudgetAmount(c.month,c.categoryId,c.amountCents);
  await api.sync();
  const after=await inspectAllocations(api,preview.cells);
  const verified=after.cells.every(c=>c.beforeCents===c.amountCents);
  return {status:verified?'verified':'verification-incomplete',backup:artifact,before:current.cells,after:after.cells};
}
