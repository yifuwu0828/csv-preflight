import {FIELDS, ANCHORS, CURRENCIES, parseCSV, exactMapping, semanticMapping, auditCSV} from './core.mjs';
import {HOLDOUT_FIXTURES} from './holdout-fixtures.mjs';
const $ = (id) => document.getElementById(id);
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const sample = 'stock reference,merchandise name,selling price,money denomination\nMUG-01,"Ceramic mug, blue",12.50,USD\nMUG-01,Travel cup,-4,USD\n,Desk mat,Infinity,SAR\nPAD-03,,9.20,ZZZ\nBOOK-04,"Notebook\nlimited edition",6.00,GBP\n';
let parsed, proposals, lastReport, extractorPromise, anchorsPromise, loadMs;
$('currency-list').textContent = `Supported codes: ${[...CURRENCIES].join(', ')}.`;

const reset = () => {parsed = null; proposals = null; lastReport = null; $('confirm').checked = false; $('confirm').disabled = true; $('audit').disabled = true; $('download').disabled = true; $('mappings').replaceChildren(Object.assign(document.createElement('div'), {className:'empty', textContent:'Suggest mappings again after changing the CSV.'})); $('mapping-badge').textContent='Waiting for CSV'; $('report').replaceChildren();};
$('csv').addEventListener('input', reset);
$('sample').addEventListener('click', () => {reset(); $('file').value=''; $('csv').value = sample; $('status').textContent = 'Synthetic sample loaded; five records.';});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  if (file.size > 1024 * 1024) {$('status').textContent = 'Prototype limit: 1 MB CSV.'; return;}
  reset(); $('csv').value = await file.text(); $('status').textContent = `${file.name} read locally.`;
});

async function extractor() {
  if (!extractorPromise) extractorPromise = (async () => {
    const start = performance.now();
    const {pipeline, env} = await import('./vendor/transformers.web.js');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL('./models/', import.meta.url).href;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.wasmPaths = new URL('./vendor/onnx/', import.meta.url).href;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    const run = await pipeline('feature-extraction', MODEL, {device:'wasm', dtype:'q8'});
    loadMs = performance.now() - start;
    return run;
  })().catch((err) => {extractorPromise = null; anchorsPromise = null; throw err;});
  return extractorPromise;
}
async function vectors(texts) {const run = await extractor(); return (await run(texts, {pooling:'mean', normalize:true})).tolist();}
async function anchorVectors() {
  if (!anchorsPromise) anchorsPromise = (async () => {
    const flat = FIELDS.flatMap((f) => ANCHORS[f]);
    const embedding = await vectors(flat); let offset = 0;
    return Object.fromEntries(FIELDS.map((field) => {const values = embedding.slice(offset, offset + ANCHORS[field].length); offset += ANCHORS[field].length; return [field, values];}));
  })();
  return anchorsPromise;
}
function showRuntime(extra = {}) {
  const resources = performance.getEntriesByType('resource').map((r) => ({url:r.name, durationMs:Math.round(r.duration), transferBytes:r.transferSize}));
  $('runtime-evidence').textContent = JSON.stringify({model:MODEL, modelRevision:REVISION, runtime:'Transformers.js 3.8.1 / ONNX WASM', remoteModelsAllowed:false, firstModelLoadMs:Math.round(loadMs ?? 0), pageOrigin:location.origin, resources, ...extra}, null, 2);
}
function renderMappings() {
  const container = $('mappings'); container.replaceChildren();
  for (const p of proposals) {
    const row = document.createElement('div'); row.className = 'mapping';
    const label = document.createElement('label'); label.htmlFor = `map-${p.field}`; label.textContent = p.field;
    const body = document.createElement('div'), select = document.createElement('select'); select.id = `map-${p.field}`;
    select.add(new Option('Choose a column…', ''));
    parsed.headers.forEach((h, i) => select.add(new Option(h, String(i))));
    select.value = p.index === null ? '' : String(p.index);
    const note = document.createElement('small'); note.textContent = p.method + (p.score === null ? '' : ` · similarity ${p.score.toFixed(3)}, margin ${p.gap.toFixed(3)}`);
    select.addEventListener('change', () => {$('confirm').checked=false; $('audit').disabled=true; lastReport=null; $('download').disabled=true; $('report').replaceChildren();});
    body.append(select, note); row.append(label, body); container.append(row);
  }
  $('confirm').disabled = false; $('mapping-badge').textContent = `${parsed.headers.length} columns · review needed`;
}
$('map').addEventListener('click', async () => {
  try {
    reset();
    if ($('csv').value.length > 1024 * 1024) throw new Error('Prototype limit: 1 MB CSV.');
    parsed = parseCSV($('csv').value);
    if (parsed.headers.length > 30 || parsed.rows.length > 5000) throw new Error('Prototype limit: 30 columns and 5,000 records.');
    $('map').disabled=true; $('sample').disabled=true; $('file').disabled=true; $('csv').readOnly=true; $('status').textContent='Loading local model and comparing column meanings…';
    const start = performance.now();
    proposals = semanticMapping(parsed.headers, await vectors(parsed.headers), await anchorVectors());
    renderMappings(); showRuntime({mappingInferenceMs:Math.round(performance.now()-start), vectorDimensions:384});
    $('status').textContent='Model suggestions ready. Check all four mappings.';
  } catch (err) {$('status').textContent=err.message;}
  finally {$('map').disabled=false; $('sample').disabled=false; $('file').disabled=false; $('csv').readOnly=false;}
});
$('confirm').addEventListener('change', () => {$('audit').disabled=!$('confirm').checked;});
$('audit').addEventListener('click', async () => {
  try {
    if (!$('confirm').checked) throw new Error('Please review the mappings.');
    const mapping = Object.fromEntries(FIELDS.map((f) => [f, $(`map-${f}`).value === '' ? null : Number($(`map-${f}`).value)]));
    lastReport = auditCSV(parsed, mapping);
    const bytes = new TextEncoder().encode($('csv').value);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2,'0')).join('');
    Object.assign(lastReport, {generatedAt:new Date().toISOString(), inputTextSha256:hash, hashBasis:'UTF-8 text as parsed in the browser; not a claim about original file encoding.', mappingReviewConfirmed:true, mappingProposals:proposals, model:{id:MODEL,revision:REVISION,runtime:'Transformers.js 3.8.1',threshold:0.35,margin:0.08}, supportedCurrencies:[...CURRENCIES]});
    const report = $('report'); report.replaceChildren();
    const metrics = document.createElement('div'); metrics.className='metrics';
    for (const [label,value] of [['Records',lastReport.recordCount],['Issues',lastReport.issueCount],['Affected records',lastReport.affectedRecords]]) {const box=document.createElement('div'), strong=document.createElement('strong'), caption=document.createElement('span'); strong.textContent=value; caption.textContent=label; box.append(strong,caption); metrics.append(box);}
    report.append(metrics);
    if (lastReport.issues.length) {
      const table = document.createElement('table'), head=document.createElement('tr');
      for (const t of ['Source line','Field','Finding']) {const th=document.createElement('th');th.textContent=t;head.append(th);}table.append(head);
      for (const issue of lastReport.issues) {const tr=document.createElement('tr');for(const val of [issue.sourceLine,issue.field ?? 'row',issue.message]){const td=document.createElement('td');td.textContent=val;tr.append(td);}table.append(tr);}report.append(table);
    } else {const p=document.createElement('p');p.textContent='No findings under these prototype checks. Confirm importer-specific requirements separately.';report.append(p);}
    const raw=document.createElement('details'), summary=document.createElement('summary'), pre=document.createElement('pre');summary.textContent='View audit JSON'; pre.id='audit-json';pre.textContent=JSON.stringify(lastReport,null,2);raw.append(summary,pre);report.append(raw);
    $('download').disabled=false; $('mapping-badge').textContent='Review confirmed'; $('status').textContent='Audit complete; source data was not modified.';showRuntime({auditedRecords:lastReport.recordCount});
  } catch (err) {$('status').textContent=err.message;}
});
$('download').addEventListener('click', () => {if(!lastReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='csv-preflight-audit.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

// Frozen before the first model run; no fixture-specific model outputs are hardcoded.
const fixtures = [
  {name:'canonical',headers:['sku','title','price','currency'],expected:[0,1,2,3]},
  {name:'semantic A',headers:['stock reference','merchandise name','selling price','money denomination'],expected:[0,1,2,3]},
  {name:'semantic B shuffled',headers:['monetary unit','retail selling amount','catalogue item name','inventory identifier'],expected:[3,2,1,0]},
  {name:'irrelevant columns',headers:['warehouse location','supplier email','photo link','shipping weight'],expected:[null,null,null,null]},
  {name:'ambiguous price',headers:['sku','title','retail price','sale price','currency'],expected:[0,1,null,4]},
  {name:'one column collision',headers:['value'],expected:[null,null,null,null]},
];
$('validation').addEventListener('click', async () => {
  $('validation').disabled=true; $('validation-output').textContent='Running real local embeddings on development and holdout fixtures…';
  try {
    const start=performance.now(), results=[];
    for(const f of [...fixtures.map((f)=>({...f,suite:'development'})),...HOLDOUT_FIXTURES.map((f)=>({...f,suite:'holdout'}))]){const began=performance.now();const baseline=exactMapping(f.headers).map((p)=>p.index);const actual=semanticMapping(f.headers,await vectors(f.headers),await anchorVectors());results.push({...f,baseline,actual:actual.map((p)=>p.index),details:actual,inferenceMs:Math.round(performance.now()-began)});}
    const score=(key)=>results.reduce((n,r)=>n+r.expected.filter((v,i)=>v===r[key][i]).length,0);
    const suiteScores=Object.fromEntries(['development','holdout'].map((suite)=>{const rows=results.filter((r)=>r.suite===suite);return [suite,{fixtures:rows.length,decisions:rows.length*4,exactAliasCorrect:rows.reduce((n,r)=>n+r.expected.filter((v,i)=>v===r.baseline[i]).length,0),modelMappingCorrect:rows.reduce((n,r)=>n+r.expected.filter((v,i)=>v===r.actual[i]).length,0)}];}));
    const completed={model:MODEL,revision:REVISION,frozenFixtures:results.length,fieldDecisions:results.length*4,exactAliasCorrect:score('baseline'),modelMappingCorrect:score('actual'),suiteScores,elapsedMs:Math.round(performance.now()-start),results,limitations:'Small synthetic test; not general accuracy or customer evidence. Development tests informed an explicit ambiguity guard; holdout fixtures were frozen after that change and were not used to tune it. Abstentions count as correct only where expected.'};
    $('validation-output').textContent=JSON.stringify(completed,null,2);showRuntime({validationComplete:true});
  }catch(err){$('validation-output').textContent=`Validation failed: ${err.message}`;}
  finally{$('validation').disabled=false;}
});
