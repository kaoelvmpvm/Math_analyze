(function(){
'use strict';
const API=window.MathAnalyzeExtensionAPI;
if(!API)return;
const PDF_ENGINE_VERSION='v15-20261019-imagefix';
window.MathAnalyzePdfEngineVersion=PDF_ENGINE_VERSION;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const reasonNames={K:'知識不熟',P:'推理／方法錯',C:'已確認非知識性失誤',T:'時間不足',U:'未判定'};
let generating=false, initialized=false, selectedIds=new Set(), imageCache=new Map(), detailList=[];
function toast(message,err){API.toast(message,!!err);}
function snapshot(){return API.snapshot();}
function selectedTopics(){return Array.from(document.querySelectorAll('#paperTopics input:checked')).map(x=>x.value);}
function bulkCandidates(){return snapshot().papers.filter(p=>p.mode==='individual'&&p.batchId);}
function batchGroups(){
 const groups=new Map();
 bulkCandidates().forEach(p=>{if(!groups.has(p.batchId))groups.set(p.batchId,[]);groups.get(p.batchId).push(p);});
 return [...groups.entries()].reverse();
}
function renderStudents(){
 const s=snapshot(),container=$('bulkStudentList');
 if(!container)return;
 const current=new Set(s.students);
 for(const id of [...selectedIds])if(!current.has(id))selectedIds.delete(id);
 if(!initialized&&s.students.length){selectedIds=new Set(s.students);initialized=true;}
 container.innerHTML=s.students.length?s.students.map(id=>'<label class="batch-student"><input type="checkbox" data-bulk-student="'+esc(id)+'" '+(selectedIds.has(id)?'checked':'')+'><span>'+esc(id)+'</span></label>').join(''):'<div class="notice warn">目前尚未建立學生代號。請先到「設定與備份」新增學生。</div>';
 $('bulkSelectedCount').textContent='已選 '+selectedIds.size+'／'+s.students.length+' 位';
 $('bulkDownload').disabled=generating||!selectedIds.size||!s.ready;
 if($('bulkGenerateAll'))$('bulkGenerateAll').disabled=generating||!s.students.length||!s.ready;
 $('bulkMergeExisting').disabled=generating||!selectedIds.size||!s.ready||!s.papers.some(p=>p.mode==='individual'&&selectedIds.has(p.student));
}
function renderBatches(){
 const box=$('bulkHistory');if(!box)return;
 const groups=batchGroups();
 box.innerHTML=groups.length?groups.slice(0,10).map(([id,papers])=>{
  let dt=papers[0]?.date||'';
  return '<div class="batch-history-item"><span><strong>'+esc(papers[0].title.replace(/｜[^｜]+$/,''))+'</strong><small>'+esc(papers[0].trainingDate||dt.slice(0,10))+' · '+papers.length+' 位 · '+papers[0].questionIds.length+'題／人</small></span><span class="actions"><button class="btn" data-bulk-redownload="'+esc(id)+'">下載合併PDF</button><button class="btn" data-bulk-answers="'+esc(id)+'">答案CSV</button></span></div>';
 }).join(''):'<p class="hint">尚無已建立的批次個別卷。按上方「批次產生並下載」即可開始。</p>';
}
function setBusy(on,message){
 generating=on;$('bulkDownload').disabled=on||!selectedIds.size||!snapshot().ready;
 if($('bulkGenerateAll'))$('bulkGenerateAll').disabled=on||!snapshot().students.length||!snapshot().ready;
 $('bulkMergeExisting').disabled=on||!selectedIds.size||!snapshot().ready;
 if($('bulkProgress'))$('bulkProgress').textContent=message||'';
 document.querySelectorAll('[data-bulk-redownload]').forEach(btn=>btn.disabled=on);
}
function downloadBlob(blob,filename){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function csv(rows,filename){
 const body='\ufeff'+rows.map(row=>row.map(value=>{
  let s=String(value==null?'':value);
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 }).join(',')).join('\r\n');
 downloadBlob(new Blob([body],{type:'text/csv;charset=utf-8'}),filename);
}
function answerRows(papers){
 const rows=[['學生代號','試卷名稱','題號','題庫編號','教師分類','原題庫答案']];
 papers.forEach(p=>p.questionIds.forEach((id,i)=>{
   const q=API.question(id)||{};
   rows.push([p.student,p.title,i+1,id,q.teacher_category_label||q.primary_topic||'分類待核對',q.answer_as_provided||'待核對']);
 }));
 return rows;
}
function batchAnswers(papers){csv(answerRows(papers),'MathAnalyze_個別卷答案_'+papers.length+'人_'+new Date().toISOString().slice(0,10)+'.csv');}
function headerPng(p,continued){
 const c=document.createElement('canvas');
 c.width=1500;c.height=215;const ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1500,215);ctx.fillStyle='#152d47';
 ctx.font='bold 51px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText((p.title||'數學個別卷').slice(0,31),22,67,1440);
 ctx.font='34px "Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillText('訓練日期：'+(p.trainingDate||String(p.date||'').slice(0,10))+'    學生代號：'+p.student+'    時間：'+p.minutes+'分鐘    題數：'+p.questionIds.length+'題'+(continued?'    （續頁）':''),22,127,1440);
 ctx.strokeStyle='#92a5b8';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(22,165);ctx.lineTo(1470,165);ctx.stroke();
 return c.toDataURL('image/png');
}
// 每張個別卷專屬的答案頁；中文排版轉成圖片，避免 jsPDF 預設字型缺字。
// 只使用該卷 questionIds 的實際排序；不對來源答案進行擅自推論。
// Compact answer strip: fitted at the foot of the student's final question page.
function answerStrip(p){
 const colCount=5,rows=Math.ceil((p.questionIds||[]).length/colCount);
 const canvas=document.createElement('canvas');
 canvas.width=1500;canvas.height=124+rows*56;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('無法建立答案表畫布');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#a9b6c5';ctx.lineWidth=2;
 ctx.beginPath();ctx.moveTo(52,15);ctx.lineTo(1450,15);ctx.stroke();
 const font='"Microsoft JhengHei","Noto Sans TC",sans-serif';
 ctx.fillStyle='#18283e';ctx.font='bold 43px '+font;
 ctx.fillText('本卷答案',56,64,330);
 ctx.font='27px '+font;ctx.fillStyle='#4b5e72';
 ctx.fillText('學生：'+String(p.student||'全班')+'　日期：'+String(p.trainingDate||String(p.date||'').slice(0,10)),400,61,1020);
 const left=54,top=88,colWidth=280;
 for(let i=0;i<p.questionIds.length;i++){
  const q=API.question(p.questionIds[i]);
  const answer=q?.answer_as_provided==null?'待覆核':String(q.answer_as_provided).trim()||'待覆核';
  const x=left+(i%colCount)*colWidth,y=top+Math.floor(i/colCount)*56;
  ctx.fillStyle=i%2?'#f8fafc':'#f2f5fa';ctx.fillRect(x,y,colWidth-10,48);
  ctx.font='26px '+font;ctx.fillStyle='#536477';ctx.fillText((i+1)+'.',x+11,y+34,56);
  ctx.font='bold 30px '+font;ctx.fillStyle='#14243a';ctx.fillText(answer,x+68,y+34,colWidth-84);
 }
 ctx.fillStyle='#66788b';ctx.font='22px '+font;
 ctx.fillText('依本卷題號排列；來源題庫答案尚待教師覆核。',56,canvas.height-13,1380);
 return {data:canvas.toDataURL('image/png'),height:canvas.height/canvas.width*182};
}
// Preflight question positions so short tests stay on at most 2 pages,
// retaining room for the answers at the bottom of the second (or first) page.
function planCompactPages(assets,answerH,scale,pageLimit){
 const top=44,bottom=278,imageW=169,space=8;
 let page=1,y=top;const positions=[];
 for(const asset of assets){
  let w=imageW*scale,h=asset.height/asset.width*w;
  const maxH=bottom-top-10;
  if(h>maxH){w*=maxH/h;h=maxH;}
  const threshold=page===pageLimit?bottom-answerH-3:bottom;
  if(y+h+9>threshold){
   page++;y=top;
  }
  if(page>pageLimit)return null;
  const pageThreshold=page===pageLimit?bottom-answerH-3:bottom;
  if(y+h+9>pageThreshold)return null;
  positions.push({page:page,y:y,w:w,h:h});
  y+=h+space;
 }
 // Do not create an answer-only sheet: move the final question onto a
 // new page with the key when it does not fit beneath all questions.
 if(y+answerH+2>bottom&&page<pageLimit){
  const last=positions.pop();
  if(!last)return null;
  page++;
  last.page=page;last.y=top;
  y=top+last.h+space;
  positions.push(last);
 }
 if(y+answerH+2>bottom)return null;
 return {positions:positions,pages:page,answerPage:page,answerY:bottom-answerH};
}
function bestCompactLayout(assets,answerH){
 const scales=[1,.98,.96,.94,.92,.90,.88,.86,.84,.82,.80,.78,.76,.74,.72];
 // Prefer 2-page layouts, then increase only if the question images require it.
 for(let maxPages=2;maxPages<=Math.max(2,assets.length+1);maxPages++){
  for(const scale of scales){
   const plan=planCompactPages(assets,answerH,scale,maxPages);
   if(plan&&plan.positions.at(-1)?.page===plan.answerPage)
    return {plan:plan,scale:scale,compact:plan.pages<=2};
  }
 }
 return null;
}
async function asJpeg(blob){
 let bitmap=null;
 try{
  bitmap=await createImageBitmap(blob);
  const sourceW=bitmap.width,sourceH=bitmap.height;
  if(!Number.isFinite(sourceW)||!Number.isFinite(sourceH)||sourceW<=0||sourceH<=0)
   throw Error('原始題圖像素尺寸無效（'+sourceW+'×'+sourceH+'）');
  const factor=Math.min(1,1600/sourceW);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(sourceW*factor));
  canvas.height=Math.max(1,Math.round(sourceH*factor));
  // Use the actual canvas dimensions, NOT the rounded pre-clamp values: very
  // wide/short images used to report height=0 despite being rendered as 1px.
  const width=canvas.width,height=canvas.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('瀏覽器無法建立題圖轉換畫布');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  ctx.drawImage(bitmap,0,0,width,height);
  const data=canvas.toDataURL('image/jpeg',0.91);
  if(!data.startsWith('data:image/jpeg'))throw Error('瀏覽器無法輸出題圖 JPEG');
  canvas.width=1;canvas.height=1;
  return {data:data,width:width,height:height,sourceWidth:sourceW,sourceHeight:sourceH};
 }finally{if(bitmap&&typeof bitmap.close==='function')bitmap.close();}
}
async function getJpeg(id){
 if(imageCache.has(id))return imageCache.get(id);
 const b=await API.imageBlob(id);if(!b)throw Error('題目 '+id+' 圖片不存在，請先重新匯入 v5 題圖包。');
 const result=await asJpeg(b);imageCache.set(id,result);return result;
}
async function combinedPdf(papers,exportLabel){
 if(!papers.length)throw Error('未選擇任何個別卷。');
 if(!snapshot().ready)throw Error('請先匯入 v5 題圖包，才能合併下載。');
 const JSPDF=window.jspdf?.jsPDF;if(!JSPDF)throw Error('PDF 組件未載入，請檢查網路連線並重新整理。');
 const pdf=new JSPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
 const imageX=28,imageW=169,top=44,bottom=278,margin=14;
 let total=0,started=false,overflow=0;
 imageCache=new Map();
 try {
  for(let k=0;k<papers.length;k++){
   const p=papers[k];
   // Validate every image BEFORE starting this student's PDF pages.
   const assets=[];
   for(const id of p.questionIds){
    let asset;
    try{asset=await getJpeg(id);}
    catch(err){throw Error('圖片 '+id+' 轉換失敗：'+err.message+'。請到題庫管理檢查原題圖。');}
    if(!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||asset.width<=0||asset.height<=0)
      throw Error('圖片 '+id+' 無效尺寸：'+asset.width+'×'+asset.height+'，請檢查來源題圖。');
    assets.push(asset);
   }
   const key=answerStrip(p);
   const compact=bestCompactLayout(assets,key.height);
   if(compact&&compact.plan.pages>2)overflow++;
   if(started)pdf.addPage();started=true;
   let page=1,y=top;
   const drawHead=()=>pdf.addImage(headerPng(p,page>1),'PNG',margin,12,182,26);
   drawHead();
   if(compact){
    for(let i=0;i<p.questionIds.length;i++){
     const id=p.questionIds[i],asset=assets[i],where=compact.plan.positions[i];
     while(page<where.page){pdf.addPage();page++;drawHead();}
     pdf.setFont('helvetica','normal');pdf.setFontSize(10);pdf.setTextColor(35,48,67);
     pdf.text(String(i+1)+'.',16,where.y+6);
     pdf.addImage(asset.data,'JPEG',imageX+(imageW-where.w)/2,where.y,where.w,where.h,'q_'+id,'FAST');
     total++;
    }
    while(page<compact.plan.answerPage){pdf.addPage();page++;drawHead();}
    pdf.addImage(key.data,'PNG',margin,compact.plan.answerY,182,key.height,undefined,'FAST');
   }else{
    // Never distort an overlong mathematical question to enforce 2 pages.
    // Keep the key with the questions when space allows, otherwise use a final page.
    overflow++;
    for(let i=0;i<p.questionIds.length;i++){
     const id=p.questionIds[i],asset=assets[i];
     let w=imageW,h=asset.height/asset.width*w;
     const maxH=bottom-top-10;
     if(h>maxH){w*=maxH/h;h=maxH;}
     if(y+h+9>bottom){pdf.addPage();page++;drawHead();y=top;}
     pdf.setFont('helvetica','normal');pdf.setFontSize(10);pdf.setTextColor(35,48,67);
     pdf.text(String(i+1)+'.',16,y+6);
     pdf.addImage(asset.data,'JPEG',imageX+(imageW-w)/2,y,w,h,'q_'+id,'FAST');
     y+=h+8;total++;
    }
    if(y+key.height+2>bottom){pdf.addPage();page++;drawHead();}
    pdf.addImage(key.data,'PNG',margin,bottom-key.height,182,key.height,undefined,'FAST');
   }
   // Release each student's decoded image references before processing the next.
   imageCache.clear();
   if((k+1)%2===0||k+1===papers.length){
    setBusy(true,'已排版 '+(k+1)+'／'+papers.length+' 位，'+total+' 題……');
    await new Promise(r=>setTimeout(r,0));
   }
  }
  const suffix=exportLabel?String(exportLabel).replace(/[^\w\u4e00-\u9fff-]/g,'_').slice(0,45)+'_':'';
  const file='MathAnalyze_個別卷合併_'+papers.length+'人_'+suffix+new Date().toISOString().slice(0,10)+'.pdf';
  setBusy(true,'PDF 已排版完成，正在準備下載……');pdf.save(file);
  toast('已產生合併PDF：'+papers.length+'位學生、'+total+'題。答案放在各卷末頁'+(overflow?'；'+overflow+'份題圖過長無法安全壓入兩頁，請檢查輸出頁數':'')+'。');
 }finally{imageCache.clear();}
}
// 一鍵全班：以教師設定的固定座號名單為準；沒有固定名單才用全部已建學生。
function classStudents(s){
 const roster=s.roster||{},students=new Set(s.students);
 if(roster.prefix&&Number.isInteger(roster.size)&&roster.size>0){
  const ids=[];
  for(let n=1;n<=roster.size;n++){
   const id=roster.prefix+'-'+String(n).padStart(2,'0');
   if(students.has(id))ids.push(id);
  }
  return ids;
 }
 return s.students.slice().sort((a,b)=>a.localeCompare(b,'zh-Hant',{numeric:true}));
}
async function generateIndividualPapers(ids,allClass){
 if(generating)return;
 const s=snapshot();
 if(!ids.length)return toast('尚無已建立的學生，請先在「設定與備份」設定固定座號名單。',true);
 if(!s.ready)return toast('請先在設定與備份匯入 v5 題圖包。',true);
 const count=Number($('paperCount').value),minutes=Number($('paperMinutes').value),
       trainingDate=$('paperDate').value,topics=selectedTopics(),title=$('paperTitle').value;
 if(!Number.isInteger(count)||count<4||count>45)return toast('請將出題數量設定為4～45題。',true);
 if(!Number.isFinite(minutes)||minutes<=0)return toast('請確認測驗時間。',true);
 if(!topics.length)return toast('至少選擇一個考點。',true);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(trainingDate))return toast('請選擇訓練日期。',true);
 // Respect the existing 40-student batch cap, and keep huge files manageable.
 const size=allClass?Math.min(40,Math.max(1,Math.floor(900/count))):40;
 if(!allClass&&ids.length>40)return toast('手動批次上限40位；若要產出整班，請使用「一鍵產生全班個別卷」。',true);
 const groups=[];for(let i=0;i<ids.length;i+=size)groups.push(ids.slice(i,i+size));
 if(allClass&&groups.length>1){
   const questionCount=ids.length*count;
   if(!confirm('全班共'+ids.length+'人，合計'+questionCount+'題。為避免單一PDF過大，將分成'+groups.length+'份下載（可能需要允許瀏覽器下載多個檔案）。繼續嗎？'))return;
 }else if(ids.length*count>700&&!confirm('此次共 '+ids.length*count+' 題，PDF 可能需要較長時間及記憶體。仍要繼續嗎？'))return;
 setBusy(true,'正在產生 '+ids.length+' 位學生的個別卷……');
 let completed=0;
 try{
  for(let i=0;i<groups.length;i++){
   const group=groups[i];
   setBusy(true,'正在處理第 '+(i+1)+'／'+groups.length+' 批，學生 '+(completed+1)+'～'+(completed+group.length)+'，合計 '+ids.length+' 人……');
   const papers=API.createBatch({students:group,count,minutes,trainingDate,topics,title});
   renderBatches();
   completed+=papers.length;
   const label=allClass?(groups.length>1?'全班_第'+(i+1)+'批':'全班'):'';
   await combinedPdf(papers,label);
  }
  setBusy(true,'完成 '+completed+'／'+ids.length+' 份個別卷，已下載 '+groups.length+' 份PDF；每位學生附專屬答案頁。');
 }catch(err){
  toast('批次作業中止：'+err.message,true);
  setBusy(true,'已建立 '+completed+'／'+ids.length+' 份試卷。若下載失敗，請從下方「歷次批次」重新下載。錯誤：'+err.message);
 }finally{setBusy(false,$('bulkProgress').textContent);}
}
async function runBatch(){const s=snapshot();return generateIndividualPapers(s.students.filter(id=>selectedIds.has(id)),false);}
async function generateAllClass(){return generateIndividualPapers(classStudents(snapshot()),true);}

async function mergeExisting(){
 if(generating)return;
 const s=snapshot(),ids=s.students.filter(id=>selectedIds.has(id));
 const latest=ids.map(id=>s.papers.filter(p=>p.mode==='individual'&&p.student===id).at(-1)).filter(Boolean);
 const missing=ids.filter(id=>!latest.some(p=>p.student===id));
 if(!latest.length)return toast('選取的學生尚未產生個別試卷。',true);
 if(missing.length&&!confirm('有 '+missing.length+' 位學生沒有已建立的個別卷（'+missing.slice(0,5).join('、')+(missing.length>5?'…':'')+'），只合併其餘 '+latest.length+' 位，確定嗎？'))return;
 if(latest.length>1&&new Set(latest.map(p=>p.minutes+'-'+(p.trainingDate||String(p.date||'').slice(0,10))+'-'+p.questionIds.length)).size>1){
 if(!confirm('這些學生最新試卷的訓練日期、題數或考試時間不完全相同，仍要合併嗎？'))return;
 }
 setBusy(true,'正在合併 '+latest.length+' 份既有個別卷……');
 try{await combinedPdf(latest);}catch(err){toast('合併失敗：'+err.message,true);}finally{setBusy(false,'');}
}

function studentData(student){
 const s=snapshot(),papers=new Map(s.papers.map(p=>[p.id,p]));
 const rec=s.results.filter(r=>r.student===student&&papers.has(r.paperId)).sort((a,b)=>new Date(b.date)-new Date(a.date));
 const topics=new Map(s.topics.map(t=>[t[0],{name:t[1],count:0,correct:0,wrong:0,blank:0,dates:new Set()}]));
 const errors=[],times=new Map(),unique=new Set();
 let total=0,correct=0,wrong=0,blank=0,minutes=0;
 rec.forEach(r=>{
  const p=papers.get(r.paperId);
  const wrongSet=new Set(r.wrong||[]),blankSet=new Set(r.blank||[]);
  minutes+=Number(r.minutes)||0;
  p.questionIds.forEach((id,index)=>{
   const q=API.question(id)||{},topic=topics.get(q.primary_topic_code);
   const status=wrongSet.has(id)?'wrong':blankSet.has(id)?'blank':'correct';
   if(topic){topic.count++;topic.dates.add(String(r.date||'').slice(0,10));}
   total++;
   if(status==='correct'){correct++;if(topic)topic.correct++;return;}
   if(status==='wrong'){wrong++;if(topic)topic.wrong++;}
   else{blank++;if(topic)topic.blank++;}
   times.set(id,(times.get(id)||0)+1);unique.add(id);
   errors.push({id,order:index+1,status,topic:q.teacher_category_label||q.primary_topic||'待核對',reason:r.reasons?.[id]||'U',paper:p.title,date:p.trainingDate||String(r.date||'').slice(0,10)});
  });
 });
 return {rec,topics,errors,times,unique,total,correct,wrong,blank,minutes};
}
function individualReport(){
 const box=$('studentWrongDetail');if(!box)return;
 const student=$('reportScope').value||'class';
 if(student==='class'){box.innerHTML='<p class="notice">請先在上方「學習分析」的下拉選單選擇某位學生，即可查看該學生的實際錯題、未作答紀錄與重複失分考點。</p>';return;}
 const data=studentData(student),topics=[...data.topics.entries()].map(([code,z])=>({code,...z})).sort((a,b)=>b.wrong+b.blank-(a.wrong+a.blank));
 const topicRows=topics.map(z=>{
  const errors=z.wrong+z.blank;
  const ratio=z.count?(100*(z.count-errors)/z.count).toFixed(0)+'%':'—';
  const tag=!z.count?'未測':errors>=2&&z.dates.size>=2?'跨回失分':errors?'須回刷':'本次未失分';
  return '<tr><td>'+esc(z.name)+'</td><td class="num">'+z.count+'</td><td class="num">'+z.wrong+'</td><td class="num">'+z.blank+'</td><td class="num">'+ratio+'</td><td><span class="chip '+(errors?'wait':'ok')+'">'+tag+'</span></td></tr>';
 }).join('');
 const errors=data.errors.map((e,i)=>{
  return '<tr><td>'+esc(e.date)+'</td><td title="'+esc(e.paper)+'">'+esc(e.paper.length>26?e.paper.slice(0,25)+'…':e.paper)+'</td><td>'+e.order+'</td><td>'+esc(e.id)+'</td><td>'+esc(e.topic)+'</td><td><span class="chip '+(e.status==='wrong'?'bad':'wait')+'">'+(e.status==='wrong'?'答錯':'未作答')+'</span></td><td>'+esc(reasonNames[e.reason]||'未判定')+'</td><td><button class="btn" data-show-wrong="'+esc(e.id)+'">看原題</button></td></tr>';
 }).join('');
 detailList=data.errors;
 const repeated=[...data.times.entries()].filter(([id,n])=>n>=2);
 box.innerHTML='<div class="actions" style="justify-content:space-between"><div><h3 class="section-title">個別錯題明細｜'+esc(student)+'</h3><p class="hint">只使用這位學生已登記的真實作答紀錄；「未作答」與「答錯」分開計算。</p></div><button class="btn" id="downloadStudentWrong" '+(data.errors.length?'':'disabled')+'>匯出個別錯題CSV</button></div>'+
 '<div class="grid grid-4" style="margin:14px 0">'+stat('累積作答',data.total+'題',data.rec.length+'回測驗')+stat('答錯',data.wrong+'題','不含未作答')+stat('未作答',data.blank+'題','獨立計算')+stat('相同原題再次失分',repeated.length+'題','按穩定題庫編號')+'</div>'+
 '<h4>九項考點的失分分布</h4><div class="table-scroll"><table><thead><tr><th>教師確認分類</th><th class="num">作答</th><th class="num">答錯</th><th class="num">未作答</th><th class="num">正確率</th><th>標記</th></tr></thead><tbody>'+topicRows+'</tbody></table></div>'+
 '<h4 style="margin-top:20px">逐題紀錄（最新在前）</h4>'+
 (data.errors.length?'<div class="table-scroll"><table><thead><tr><th>日期</th><th>試卷</th><th>題號</th><th>來源ID</th><th>考點</th><th>狀態</th><th>錯因</th><th></th></tr></thead><tbody>'+errors+'</tbody></table></div>':'<p class="notice">目前沒有已登記的答錯或未作答題目；若尚未測驗，不能視為全部考點均已熟練。</p>')+
 '<p class="hint">「跨回失分」代表該考點累積失分至少2次且出現在不同日期的測驗中；不等同重複答錯同一原題。錯因須由教師標記，未填者維持未判定。</p>';
 const dl=$('downloadStudentWrong');if(dl)dl.onclick=()=>csv([['學生代號','日期','試卷','題號','來源題庫編號','教師確認考點','作答狀態','錯誤原因']].concat(data.errors.map(e=>[student,e.date,e.paper,e.order,e.id,e.topic,e.status==='wrong'?'答錯':'未作答',reasonNames[e.reason]||'未判定'])),'MathAnalyze_個別錯題_'+student+'.csv');
}
function stat(title,value,detail){return '<div class="card kpi"><div class="k">'+esc(title)+'</div><div class="num">'+esc(value)+'</div><div class="foot">'+esc(detail)+'</div></div>';}
async function openWrong(id){
 const q=API.question(id),b=await API.imageBlob(id);
 if(!b)return toast('找不到 '+id+' 的題圖；請重新匯入 v5 題庫。',true);
 const dlg=$('wrongDialog');const url=URL.createObjectURL(b);
 dlg.querySelector('.wrong-preview-title').textContent=id+'｜'+(q?.teacher_category_label||q?.primary_topic||'');
 const img=dlg.querySelector('img');img.src=url;img.onload=()=>URL.revokeObjectURL(url);
 if(typeof dlg.showModal==='function')dlg.showModal();else{dlg.setAttribute('open','');}
}
function refresh(){renderStudents();renderBatches();individualReport();}
function init(){
 if($('bulkEngineStatus')){$('bulkEngineStatus').textContent='目前使用 PDF 引擎：'+PDF_ENGINE_VERSION+'（已修復誤判圖片尺寸）';$('bulkEngineStatus').dataset.loadedVersion=PDF_ENGINE_VERSION;}
 $('bulkSelectAll').onclick=()=>{selectedIds=new Set(snapshot().students);renderStudents();};
 $('bulkSelectNone').onclick=()=>{selectedIds.clear();initialized=true;renderStudents();};
 $('bulkStudentList').addEventListener('change',e=>{const id=e.target.dataset.bulkStudent;if(!id)return;if(e.target.checked)selectedIds.add(id);else selectedIds.delete(id);initialized=true;renderStudents();});
 $('bulkDownload').onclick=runBatch;
 $('bulkGenerateAll').onclick=generateAllClass;
 $('bulkMergeExisting').onclick=mergeExisting;
 $('bulkHistory').addEventListener('click',async e=>{
  const dl=e.target.closest('[data-bulk-redownload]'),ans=e.target.closest('[data-bulk-answers]');
  const id=dl?.dataset.bulkRedownload||ans?.dataset.bulkAnswers;if(!id)return;
  const papers=snapshot().papers.filter(p=>p.batchId===id).sort((a,b)=>a.student.localeCompare(b.student,'zh-Hant'));
  if(ans){batchAnswers(papers);return;}if(generating)return;
  setBusy(true,'正在合併既有批次 '+papers.length+' 份試卷……');
  try{await combinedPdf(papers);}catch(err){toast('下載失敗（PDF引擎 '+PDF_ENGINE_VERSION+'）：'+err.message,true);}finally{setBusy(false,'');}
 });
 $('studentWrongDetail').addEventListener('click',e=>{const btn=e.target.closest('[data-show-wrong]');if(btn)openWrong(btn.dataset.showWrong);});
 $('wrongDialogClose').onclick=()=>$('wrongDialog').close?.();
 refresh();
}
window.MathAnalyzeExtensions={refresh:refresh,studentData:studentData,answerRows:answerRows};
init();
})();