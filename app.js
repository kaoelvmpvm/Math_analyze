(function(){
'use strict';
var KEY='math-analyze-teacher-v1', BANKKEY='math-analyze-catalog-v1', DBNAME='math-analyze-question-images-v1';
var TOPICS=[['R1','根式的表示','2-2'],['R2','根式的乘法','2-2'],['R3','根式的除法','2-2'],['R4','根式的加減','2-2'],['R5','根式的四則運算','2-2'],['P1','畢氏定理','2-3'],['P2','平面上兩點的距離','2-3'],['F1','因式與倍式','3-1'],['F2','利用提公因式法因式分解','3-1'],['F3','利用乘法公式因式分解','3-1'],['X1','二次項係數為1的十字交乘法','3-2'],['X2','二次項係數不為1的十字交乘法','3-2']];
var state={students:[],papers:[],results:[],overrides:{},packVersion:''}, catalog=null, byId={}, dbPromise=null, imageUrls={}, selectedPaperId='', bankPage=0, currentRecord={wrong:[],blank:[],reasons:{}}, previewToken=0;
function $(id){return document.getElementById(id);}
function safe(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function val(id){return $(id)?$(id).value:'';}
function num(n){return Math.round((n||0)*10)/10;}
function fmt(v){return Number.isFinite(v)?num(v).toString():'—';}
function today(){return new Date().toLocaleDateString('zh-TW');}
function uid(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);}
function notify(msg,err){document.querySelectorAll('.toast').forEach(function(e){e.remove();});var x=document.createElement('div');x.className='toast'+(err?' error':'');x.textContent=msg;document.body.appendChild(x);setTimeout(function(){x.remove();},4100);}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){notify('瀏覽器儲存空間不足，請先下載紀錄備份。',true);}}
function load(){try{var t=JSON.parse(localStorage.getItem(KEY)||'null');if(t&&Array.isArray(t.students)&&Array.isArray(t.papers)&&Array.isArray(t.results))state=Object.assign(state,t);var b=JSON.parse(localStorage.getItem(BANKKEY)||'null');if(b&&Array.isArray(b.questions)&&b.questions.length)applyCatalog(b,false);}catch(e){console.warn('Unable to restore local storage',e);}}
function applyCatalog(data,persist){
 if(!data||!Array.isArray(data.questions)||!data.questions.length)throw Error('題庫缺少 questions 清單');
 var codes=new Set(TOPICS.map(function(t){return t[0];})),seen=new Set();
 data.questions.forEach(function(q){if(!q.question_id||seen.has(q.question_id)||!codes.has(q.primary_topic_code)&&q.unit!=='待審')throw Error('題庫題號重複或考點代碼無效：'+q.question_id);seen.add(q.question_id);});
 catalog=data;byId={};catalog.questions.forEach(function(q){byId[q.question_id]=q;});
 if(persist)try{localStorage.setItem(BANKKEY,JSON.stringify(catalog));}catch(e){throw Error('題庫索引無法儲存至此瀏覽器');}
}
function db(){if(dbPromise)return dbPromise;dbPromise=new Promise(function(resolve,reject){var req=indexedDB.open(DBNAME,1);req.onupgradeneeded=function(){req.result.createObjectStore('cards');};req.onsuccess=function(){resolve(req.result);};req.onerror=function(){reject(req.error);};});return dbPromise;}
async function blobFor(id){try{var d=await db();return await new Promise(function(resolve,reject){var q=d.transaction('cards','readonly').objectStore('cards').get(id);q.onsuccess=function(){resolve(q.result||null);};q.onerror=function(){reject(q.error);};});}catch(e){return null;}}
async function cardUrl(id){if(imageUrls[id])return imageUrls[id];var b=await blobFor(id);if(!b)return '';var u=URL.createObjectURL(b);imageUrls[id]=u;return u;}
function active(q){if(!q)return false;if(state.overrides[q.question_id]===false)return false;if(state.overrides[q.question_id]===true)return true;var s=q.quality_status||'';return s.indexOf('形式初篩通過')===0||s.indexOf('待驗：原圖')===0;}
function quality(q){if(state.overrides[q.question_id]===false)return 'blocked';if(state.overrides[q.question_id]===true)return 'usable';if(active(q))return 'usable';return (q.quality_status||'').indexOf('停用')>=0?'blocked':'review';}
function qname(q){return q.primary_topic||TOPICS.find(function(t){return t[0]===q.primary_topic_code;})?.[1]||'待審';}
function topicName(code){return (TOPICS.find(function(t){return t[0]===code;})||[])[1]||'未知考點';}
function optionHtml(values,choice){return values.map(function(a){return '<option value="'+safe(a[0])+'"'+(a[0]===choice?' selected':'')+'>'+safe(a[1])+'</option>';}).join('');}
function empty(title,detail){return '<div class="empty"><h3>'+safe(title)+'</h3><p>'+safe(detail||'')+'</p></div>';}
function paperOf(id){return state.papers.find(function(p){return p.id===id;});}
function resultsFor(scope){return state.results.filter(function(r){return scope==='class'||r.student===scope;});}
function summarize(scope){
 var results=resultsFor(scope),seen={},topics={},correct=0,total=0,minutes=0,confirmedCareless=0,wrongTotal=0,unanswered=0,perResult=[];
 TOPICS.forEach(function(t){topics[t[0]]={attempts:0,correct:0,questionIds:new Set(),dates:new Set(),wrong:0,blank:0};});
 results.forEach(function(r){var p=paperOf(r.paperId);if(!p)return;var wrong=new Set(r.wrong||[]),blank=new Set(r.blank||[]);var rc=0,rt=0;minutes+=Number(r.minutes)||0;
 (p.questionIds||[]).forEach(function(id){var q=byId[id];if(!q)return;var code=q.primary_topic_code, isW=wrong.has(id),isB=blank.has(id),good=!isW&&!isB;
 var z=topics[code];if(!z)return;
 z.attempts++;z.correct+=good?1:0;z.wrong+=isW?1:0;z.blank+=isB?1:0;z.dates.add(String(r.date||'').slice(0,10));z.questionIds.add(id);
 if(!seen[id])seen[id]={attempts:0,wrong:0,blank:0,last:0};seen[id].attempts++;seen[id].wrong+=isW?1:0;seen[id].blank+=isB?1:0;seen[id].last=Math.max(seen[id].last,Date.parse(r.date||'')||0);
 if(isW){wrongTotal++;if((r.reasons||{})[id]==='C')confirmedCareless++;}if(isB)unanswered++;
 total++;rt++;if(good){correct++;rc++;}
 });
 perResult.push({paper:p,record:r,correct:rc,total:rt,rate:rt?rc/rt:0,efficiency:r.minutes?rc/Number(r.minutes):0});
 });
 return {results:results,seen:seen,topics:topics,correct:correct,total:total,minutes:minutes,confirmedCareless:confirmedCareless,wrongTotal:wrongTotal,unanswered:unanswered,perResult:perResult};
}
function statCard(name,value,foot){return '<div class="card kpi"><div class="k">'+safe(name)+'</div><div class="num">'+safe(value)+'</div><div class="foot">'+safe(foot||'')+'</div></div>';}
function refreshDashboard(){
 var total=catalog?catalog.questions.length:0,ok=catalog?catalog.questions.filter(active).length:0,coverage=summarize('class');
 $('dashKpis').innerHTML=statCard('已匯入題目',String(total),'含待審及停用題')+statCard('可候選題數',String(ok),'形式初篩／已確認題圖')+statCard('產生試卷',String(state.papers.length),'可重印及核對答案')+statCard('學生作答紀錄',String(state.results.length),'累積全班登記次數');
 var html='';
 TOPICS.forEach(function(t){var z=coverage.topics[t[0]],n=z.questionIds.size;html+='<div style="margin-bottom:11px"><div class="actions" style="justify-content:space-between;margin-bottom:4px"><span class="small">'+safe(t[1])+'</span><span class="small muted">'+n+'題曾測</span></div><div class="progressline"><div class="progressfill" style="width:'+Math.min(100,n*10)+'%"></div></div></div>';});
 $('dashCoverage').innerHTML=html+'<p class="hint">長條代表是否已使用不同試題（每10題填滿），不是學生熟練度。</p>';
 var rec=state.results.slice().sort(function(a,b){return Date.parse(b.date)-Date.parse(a.date);}).slice(0,6);
 $('dashRecent').innerHTML=rec.length?rec.map(function(r){var p=paperOf(r.paperId),w=(r.wrong||[]).length,b=(r.blank||[]).length;return '<div class="item"><div><h4>'+safe(r.student)+'</h4><p>'+safe(p?p.title:'原試卷已不存在')+' · '+safe(String(r.date||'').slice(0,10))+'</p></div><span class="chip">'+(p?p.questionIds.length-w-b:0)+'題正確</span></div>';}).join(''):empty('尚無登記紀錄','建立測驗並登記錯題後，這裡會逐步顯示進展。');
}
function refreshTopics(){
 var b='<option value="all">全部考點</option>'+TOPICS.map(function(t){return '<option value="'+t[0]+'">'+safe(t[2]+' '+t[1])+'</option>';}).join('');
 if($('bankTopic').innerHTML!==b){var old=val('bankTopic');$('bankTopic').innerHTML=b;$('bankTopic').value=old||'all';}
 var selected=Array.from(document.querySelectorAll('#paperTopics input:checked')).map(function(x){return x.value;});
 if(!$('paperTopics').children.length){$('paperTopics').innerHTML=TOPICS.map(function(t){return '<label class="topic-opt"><input type="checkbox" value="'+t[0]+'" checked><span>'+safe(t[1])+'</span></label>';}).join('');}
}
function refreshBank(){
 refreshTopics();var all=catalog?catalog.questions:[],filter=val('bankSearch').trim().toLowerCase(),topic=val('bankTopic'),status=val('bankStatus');
 var list=all.filter(function(q){return (topic==='all'||q.primary_topic_code===topic)&&(status==='all'||quality(q)===status)&&(!filter||[q.question_id,q.primary_topic,q.preview_not_safe_for_print].join(' ').toLowerCase().indexOf(filter)>=0);});
 var allCount=all.length,ok=all.filter(active).length,pending=all.filter(function(q){return quality(q)==='review';}).length,stop=allCount-ok-pending;
 $('bankStats').innerHTML=statCard('題庫總數',allCount,'目前匯入的題庫')+statCard('可出題候選',ok,'非答案已獨立驗證')+statCard('待審／停用',pending+' / '+stop,'可由教師逐題調整');
 var pages=Math.max(1,Math.ceil(list.length/20));bankPage=Math.min(bankPage,pages-1);var start=bankPage*20;
 $('bankRows').innerHTML=list.slice(start,start+20).map(function(q){var z=quality(q);return '<tr><td><strong>'+safe(q.question_id)+'</strong></td><td>'+safe(qname(q))+'</td><td>'+safe(q.answer_as_provided||'?')+'</td><td><span class="chip '+(z==='usable'?'ok':z==='blocked'?'bad':'wait')+'">'+(z==='usable'?'候選可用':z==='blocked'?'已停用':'待審')+'</span></td><td><button class="btn" data-open-q="'+safe(q.question_id)+'">查看／覆核</button></td></tr>';}).join('');
 $('bankPagination').textContent='顯示 '+(list.length?start+1:0)+'～'+Math.min(list.length,start+20)+' / '+list.length+' 題';
 $('bankPrev').disabled=bankPage===0;$('bankNext').disabled=bankPage>=pages-1;
 $('candidateCount').textContent=catalog?'目前'+ok+'題可參與選題':'請先匯入完整題庫ZIP';
}
async function showQuestion(id){var q=byId[id];if(!q)return;var box=$('bankDetail'),u=await cardUrl(id);
 box.style.display='block';box.innerHTML='<div class="head"><div><h3 style="margin:0">題庫 '+safe(id)+'｜'+safe(qname(q))+'</h3><p>來源：'+safe(q.source_file||'')+'　原題第'+safe(q.source_question_number||'?')+'題</p></div><button class="btn" id="closeDetail">關閉</button></div>'+
 (u?'<img style="width:100%;max-width:790px" alt="來源題圖 '+safe(id)+'" src="'+u+'">':'<p class="notice warn">尚未匯入這道題的原始題圖，不能直接印製。</p>')+
 '<p class="hint">來源答案：'+safe(q.answer_as_provided)+'｜原有品質註記：'+safe(q.quality_status)+'｜覆核說明：'+safe(q.review_flags||'無')+'</p>'+
 '<div class="actions"><button class="btn primary" data-set-q="'+safe(id)+'" data-q-ok="yes">教師核准可用</button><button class="btn danger" data-set-q="'+safe(id)+'" data-q-ok="no">停用此題</button><button class="btn" data-set-q="'+safe(id)+'" data-q-ok="reset">恢復來源狀態</button></div>';
 $('closeDetail').onclick=function(){box.style.display='none';};box.scrollIntoView({behavior:'smooth',block:'start'});
}
function studentOptions(target,emptyFirst){
 var old=val(target);var opts=(emptyFirst?'<option value="class">全班彙整</option>':'<option value="">請選擇學生</option>')+state.students.map(function(s){return '<option value="'+safe(s)+'">'+safe(s)+'</option>';}).join('');$(target).innerHTML=opts;if(old&&Array.from($(target).options).some(function(o){return o.value===old;}))$(target).value=old;
}
function refreshStudents(){
 $('studentsList').innerHTML=state.students.length?state.students.map(function(s){return '<span class="pill">'+safe(s)+' <button title="移除" data-remove-student="'+safe(s)+'">×</button></span>';}).join(''):'<span class="hint">尚未新增學生</span>';
 ['paperStudent','recordStudent'].forEach(function(id){studentOptions(id,false);});studentOptions('reportScope',true);
}
function historySeen(id,scope){var x=summarize(scope).seen[id];return x;}
function weightFor(q,stats,week,recent){var x=stats.seen[q.question_id],w=1;var days=x?Math.max(0,(Date.now()-x.last)/864e5):100;
 if(!x){w=week==1?5.5:week==2?5:3.3;}else{
 var miss=(x.wrong+x.blank)/x.attempts;
 w+=Math.min(6,miss*7)+Math.min(2.3,days/3)+(x.attempts<=1?1:0);
 if(week==3||week==6)w+=miss*3;
 if(week==4||week==5)w+=x.attempts>=2&&miss<.15?1:0;
 }
 if(recent.has(q.question_id))w*=.055;
 if(q.classification_confidence==='低')w*=.2;
 return Math.max(.01,w);
}
function selectQuestions(count,topicCodes,scope,week){
 var chosen=[],used=new Set(),stats=summarize(scope),recent=new Set();
 state.papers.slice(-2).forEach(function(p){if(scope==='class'||p.mode==='class'||p.student===scope)(p.questionIds||[]).forEach(function(id){recent.add(id);});});
 var groups={};topicCodes.forEach(function(c){groups[c]=[];});
 catalog.questions.forEach(function(q){if(active(q)&&groups[q.primary_topic_code])groups[q.primary_topic_code].push(q);});
 var pool=Object.values(groups).flat();if(pool.length<count)throw Error('可用題數不足：候選 '+pool.length+' 題，需求 '+count+' 題。');
 var maxPerTopic=Math.max(2,Math.ceil(count*.35)),distribution={};topicCodes.forEach(function(t){distribution[t]=0;});
 while(chosen.length<count){
 var options=[];topicCodes.forEach(function(t){
  if(distribution[t]>=maxPerTopic)return;
  var qs=groups[t].filter(function(q){return !used.has(q.question_id);});if(!qs.length)return;
  var prev=stats.topics[t],uncovered=prev&&prev.attempts===0?1.45:1,weak=prev&&prev.attempts>=2?(1-prev.correct/prev.attempts)*2:0.5;
  var balance=(1+weak)*uncovered/(1+distribution[t]*1.7);
  if(distribution[t]===0)balance*=2.5;
  options.push({t:t,q:qs,w:balance});
 });
 if(!options.length)break;
 var t=weighted(options,function(x){return x.w;});var picked=weighted(t.q,function(q){return weightFor(q,stats,week,recent);});
 if(!picked)break;chosen.push(picked.question_id);used.add(picked.question_id);distribution[t.t]++;
 }
 if(chosen.length!==count)throw Error('題型與每考點上限限制下，只能抽出'+chosen.length+'題。請減少題數或增加考點。');
 return chosen;
}
function weighted(arr,fn){if(!arr.length)return null;var values=arr.map(function(x){return Math.max(.01,fn(x));});var sum=values.reduce(function(a,b){return a+b;},0),pick=Math.random()*sum;for(var i=0;i<arr.length;i++){pick-=values[i];if(pick<=0)return arr[i];}return arr[arr.length-1];}
function makePaper(){
 if(!catalog||!state.packVersion)return notify('請先在「設定與備份」匯入完整780題原圖包。',true);
 var count=parseInt(val('paperCount'),10),minutes=parseInt(val('paperMinutes'),10),week=parseInt(val('paperWeek'),10),mode=val('paperMode'),student=mode==='individual'?val('paperStudent'):'';
 var topics=Array.from(document.querySelectorAll('#paperTopics input:checked')).map(function(x){return x.value;});
 if(!topics.length)return notify('請至少勾選一個考點。',true);
 if(!Number.isInteger(count)||count<4||count>45)return notify('題數必須在4至45之間。',true);
 if(mode==='individual'&&!student)return notify('請先新增並選擇學生。',true);
 var qs;try{qs=selectQuestions(count,topics,mode==='individual'?student:'class',week);}catch(e){return notify(e.message,true);}
 var p={id:uid(),title:val('paperTitle').trim()||('第'+week+'週 '+minutes+'分鐘數學測驗 '+(state.papers.length+1)),date:new Date().toISOString(),minutes:minutes,week:week,mode:mode,student:student,questionIds:qs};
 state.papers.push(p);selectedPaperId=p.id;save();notify('已產生 '+count+' 題；可預覽與列印。');refreshAll();switchTab('papers');
}
function paperList(){
 $('paperList').innerHTML=state.papers.length?state.papers.slice().reverse().map(function(p){return '<div class="item"><div><h4>'+safe(p.title)+'</h4><p>'+safe(String(p.date).slice(0,10))+' · '+p.questionIds.length+'題 · '+p.minutes+'分鐘 · '+(p.mode==='individual'?safe(p.student):'全班')+'</p></div><button class="btn'+(p.id===selectedPaperId?' primary':'')+'" data-paper-id="'+safe(p.id)+'">查看</button></div>';}).join(''):empty('還沒有考卷','請先匯入題圖包，再從左側設定考點與測驗時間。');
 $('recordPaper').innerHTML='<option value="">請選擇試卷</option>'+state.papers.slice().reverse().map(function(p){return '<option value="'+safe(p.id)+'">'+safe(p.title)+'</option>';}).join('');
}
async function renderPreview(){
 var token=++previewToken,p=paperOf(selectedPaperId);
 $('printPaper').disabled=!p;$('downloadAnswers').disabled=!p;
 if(!p){$('paperPreview').innerHTML=empty('尚未選擇考卷','出卷後會顯示題圖。');$('paperSelectedLabel').textContent='尚未選擇考卷';return;}
 $('paperSelectedLabel').textContent=p.title+'｜'+p.questionIds.length+'題｜'+p.minutes+'分鐘';
 $('paperPreview').innerHTML='<p class="hint">正在載入來源題圖……</p>';
 var texts=[];
 for(var i=0;i<p.questionIds.length;i++){
  var id=p.questionIds[i],q=byId[id],u=await cardUrl(id);
  texts.push('<article class="question-card"><div class="question-meta"><span>第 '+(i+1)+' 題 · '+safe(q?qname(q):'來源不存在')+'</span><span>'+safe(id)+'</span></div>'+(u?'<img alt="第'+(i+1)+'題" src="'+u+'">':'<div class="missing-asset">缺少題圖 '+safe(id)+'，不可直接列印</div>')+'</article>');
 }
 if(token===previewToken)$('paperPreview').innerHTML=texts.join('');
}
function csvDownload(name,rows){var csv='\ufeff'+rows.map(function(r){return r.map(function(cell){var s=String(cell==null?'':cell);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');download(name,'text/csv;charset=utf-8',csv);}
function download(name,mime,content){var url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},500);}
function answersCsv(){var p=paperOf(selectedPaperId);if(!p)return;csvDownload('答案_'+p.title+'.csv',[['新題號','題庫編號','考點','標準答案（來源未全面獨立驗算）']].concat(p.questionIds.map(function(id,i){return [i+1,id,qname(byId[id]),byId[id].answer_as_provided];})));}
async function printCurrent(){
 var p=paperOf(selectedPaperId);if(!p)return;
 var cards=[];for(var i=0;i<p.questionIds.length;i++){var id=p.questionIds[i],u=await cardUrl(id);if(!u){notify('缺少原題圖：'+id+'，請重新匯入題包。',true);return;}cards.push('<div class="print-q"><div class="num">第 '+(i+1)+' 題</div><img src="'+u+'" alt="第'+(i+1)+'題"></div>');}
 $('print-root').innerHTML='<div class="print-hdr"><h2>'+safe(p.title)+'</h2><p>座號：＿＿＿＿　姓名：＿＿＿＿　　測驗時間：'+p.minutes+' 分鐘　　共 '+p.questionIds.length+' 題</p></div>'+cards.join('')+'<div class="answerpage"><h2>教師用答案卷（來源答案，請覆核）</h2><p>'+safe(p.title)+'</p><div class="answergrid">'+p.questionIds.map(function(id,i){return '<div>'+(i+1)+'. '+safe(byId[id].answer_as_provided)+'</div>';}).join('')+'</div></div>';
 var imgs=Array.from($('print-root').querySelectorAll('img'));
 await Promise.all(imgs.map(function(im){return im.complete?Promise.resolve():new Promise(function(ok){im.onload=im.onerror=ok;});}));
 window.print();
}
function resetRecordForm(){currentRecord={wrong:[],blank:[],reasons:{}};var p=paperOf(val('recordPaper'));$('recordMinutes').value=p?p.minutes:'';refreshRecordGrid();}
function refreshRecordGrid(){
 var p=paperOf(val('recordPaper'));if(!p){$('recordGrid').innerHTML=empty('尚未選擇考卷','先在「智能出卷」產生一份考卷');$('reasonBox').innerHTML='';$('recordCount').textContent='';return;}
 $('recordGrid').innerHTML=p.questionIds.map(function(id,i){var wrong=currentRecord.wrong.indexOf(id)>=0,blank=currentRecord.blank.indexOf(id)>=0;
 return '<div class="record-question"><span class="q-label">'+(i+1)+'題</span><button class="r-btn wrong'+(wrong?' selected':'')+'" data-rq="'+safe(id)+'" data-rtype="wrong">答錯</button><button class="r-btn blank'+(blank?' selected':'')+'" data-rq="'+safe(id)+'" data-rtype="blank">空白</button></div>';}).join('');
 $('recordCount').textContent='錯'+currentRecord.wrong.length+'題／空白'+currentRecord.blank.length+'題／正確'+(p.questionIds.length-currentRecord.wrong.length-currentRecord.blank.length)+'題';
 $('reasonBox').innerHTML=currentRecord.wrong.length?'<div class="group-label" style="margin:15px 0 8px">逐題錯因（選填；不會自動判定粗心）</div>'+currentRecord.wrong.map(function(id){var n=p.questionIds.indexOf(id)+1,v=currentRecord.reasons[id]||'U';return '<div class="reason-row"><span>'+n+'題 · '+safe(topicName(byId[id]?.primary_topic_code))+'</span><select class="control" data-reason="'+safe(id)+'">'+optionHtml([['U','未判定'],['K','知識不熟'],['P','推理／方法錯'],['C','審題／抄寫／運算失誤（已確認）'],['T','時間不足']],v)+'</select></div>';}).join(''):'';
}
function loadExistingRecord(){var paper=val('recordPaper'),student=val('recordStudent');var r=state.results.find(function(x){return x.paperId===paper&&x.student===student;});
 currentRecord=r?{wrong:(r.wrong||[]).slice(),blank:(r.blank||[]).slice(),reasons:Object.assign({},r.reasons||{})}:{wrong:[],blank:[],reasons:{}};
 $('recordMinutes').value=r?String(r.minutes):String(paperOf(paper)?.minutes||'');refreshRecordGrid();
}
function saveRecord(){
 var p=paperOf(val('recordPaper')),student=val('recordStudent'),time=Number(val('recordMinutes'));if(!p||!student)return notify('先選擇考卷與學生。',true);
 if(!(time>0&&time<=180))return notify('請輸入實際作答分鐘數（1～180）。',true);
 if(p.mode==='individual'&&p.student!==student&&!window.confirm('這份題卷原本為'+p.student+'設計，仍要記錄其他學生嗎？'))return;
 var r={paperId:p.id,student:student,minutes:time,wrong:currentRecord.wrong.slice(),blank:currentRecord.blank.slice(),reasons:Object.assign({},currentRecord.reasons),date:new Date().toISOString()};
 state.results=state.results.filter(function(x){return !(x.paperId===r.paperId&&x.student===r.student);});state.results.push(r);save();notify('已儲存 '+student+' 的結果；下一回出卷會自動參考。');refreshAll();
}
function refreshRecordHistory(){
 var rec=state.results.slice().reverse();
 $('recordHistory').innerHTML=rec.length?rec.slice(0,30).map(function(r){var p=paperOf(r.paperId),count=p?p.questionIds.length:0,correct=count-(r.wrong||[]).length-(r.blank||[]).length;return '<div class="item"><div><h4>'+safe(r.student)+' · '+safe(p?.title||'舊測驗')+'</h4><p>'+safe(String(r.date||'').slice(0,10))+' · '+r.minutes+'分鐘 · '+count+'題</p></div><span class="chip '+(count&&correct/count>=.8?'ok':'wait')+'">'+correct+'/'+count+'</span></div>';}).join(''):empty('尚無作答紀錄','選好考卷與學生後，只需標記錯題與空白題。');
}
function pct(n){return (100*n).toFixed(1)+'%';}
function report(){
 var scope=val('reportScope')||'class',s=summarize(scope);
 var count=s.perResult.length,eff=s.minutes?s.correct/s.minutes:0,rate=s.total?s.correct/s.total:0;
 $('reportKpis').innerHTML=statCard('整體正確率',s.total?pct(rate):'—','作答 '+s.total+' 題')+statCard('正確題／分鐘',s.minutes?fmt(eff):'—','依每回實際總耗時計算')+statCard('教師確認粗心',s.confirmedCareless,'僅計已標記C的錯題')+statCard('測驗紀錄數',count,'學生 × 考卷');
 var all=s.perResult.slice().sort(function(a,b){return Date.parse(a.record.date)-Date.parse(b.record.date);}).slice(-15);
 $('reportTrend').innerHTML=all.length?all.map(function(x){var share=Math.max(0,Math.min(100,x.rate*100));return '<div style="margin-bottom:14px"><div class="actions" style="justify-content:space-between"><span class="small">'+safe(x.record.student)+' · '+safe(x.paper.title)+'</span><span class="small">'+pct(x.rate)+' ｜ '+fmt(x.efficiency)+'/分</span></div><div class="progressline"><div class="progressfill" style="width:'+share+'%"></div></div></div>';}).join(''):empty('尚無結果','完成至少一次錯題登記後才有趨勢。');
 var counts={K:0,P:0,C:0,T:0,U:0};s.results.forEach(function(r){(r.wrong||[]).forEach(function(id){var type=r.reasons?.[id]||'U';counts[type]=(counts[type]||0)+1;});});
 var names={K:'知識不熟',P:'推理／方法錯',C:'已確認非知識性失誤',T:'時間不足',U:'尚未判定'};
 $('reportReasons').innerHTML=Object.keys(names).map(function(k){return '<div class="item"><span>'+names[k]+'</span><strong>'+counts[k]+' 題</strong></div>';}).join('')+'<p class="hint">未作答題另計 '+s.unanswered+' 題。不能把未分類錯題視為粗心。</p>';
 $('reportTopics').innerHTML=TOPICS.map(function(t){var z=s.topics[t[0]],a=z.attempts,p=z.correct/(a||1),cov=z.questionIds.size,mastered=a>=3&&z.dates.size>=2&&p>=.8;
 var advice=a===0?'未測量：優先擴充':a<3?'樣本不足：繼續測試':p<.7?'需要補弱':p<.8?'持續追蹤':mastered?'暫定熟練（維持回刷）':'跨日驗證不足';
 return '<tr><td>'+safe(t[1])+'</td><td class="num">'+a+'</td><td class="num">'+(a?pct(p):'—')+'</td><td class="num">'+cov+'</td><td><span class="chip '+(mastered?'ok':p<.7&&a>0?'bad':'wait')+'">'+advice+'</span></td></tr>';}).join('');
}
function exportReport(){var scope=val('reportScope')||'class',s=summarize(scope);
 csvDownload('考點分析_'+scope+'.csv',[['考點代碼','考點','累積作答數','答對數','正確率','已測不同題數','已測日期數']].concat(TOPICS.map(function(t){var z=s.topics[t[0]];return [t[0],t[1],z.attempts,z.correct,z.attempts?(100*z.correct/z.attempts).toFixed(1)+'%':'',z.questionIds.size,z.dates.size];})));}
async function importZip(file){
 if(!window.JSZip)throw Error('ZIP 解壓元件載入失敗，請確認網路可連線後重新整理。');
 var progress=$('importProgress');progress.textContent='正在讀取 ZIP……';
 var zip=await window.JSZip.loadAsync(file);var item=zip.file('catalog.json');if(!item)throw Error('缺少 catalog.json，請選擇專用的780題題圖包。');
 var data=JSON.parse(await item.async('string'));if(data.questions.length!==780)throw Error('題庫預期780題，實際'+data.questions.length+'題。');
 var ids=data.questions.map(function(q){return q.question_id;});if(ids.some(function(id){return !zip.file('cards/'+id+'.webp');}))throw Error('ZIP 內缺少部分原始題圖，請勿匯入不完整版本。');
 // Validate metadata first, but only activate when all images have been saved.
 var codes=new Set(TOPICS.map(function(t){return t[0];}));if(ids.some(function(id,i){return !id||(!codes.has(data.questions[i].primary_topic_code)&&data.questions[i].unit!=='待審');}))throw Error('分類代碼含未知值，請檢查索引。');
 var files=[];for(var i=0;i<ids.length;i++){
  var raw=await zip.file('cards/'+ids[i]+'.webp').async('blob');
  files.push([ids[i],raw]);if((i+1)%80===0){progress.textContent='已解壓 '+(i+1)+'/780 題……';await new Promise(function(ok){setTimeout(ok,0);});}
 }
 progress.textContent='正在保存780張題圖至本機……';
 var database=await db();await new Promise(function(resolve,reject){var tx=database.transaction('cards','readwrite'),store=tx.objectStore('cards');files.forEach(function(row){store.put(row[1],row[0]);});tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error||Error('存入題圖失敗'));};tx.onabort=function(){reject(tx.error||Error('題庫交易取消'));};});
 applyCatalog(data,true);state.packVersion='v1-source-rendered';save();progress.textContent='780張題圖匯入完成。';notify('已成功匯入780題及全部題圖。');refreshAll();
}
function exportBackup(){var data={format:'math-analyze-records-v1',exported_at:new Date().toISOString(),state:state};download('MathAnalyze_教師紀錄備份_'+new Date().toISOString().slice(0,10)+'.json','application/json;charset=utf-8',JSON.stringify(data,null,2));notify('已下載備份。題圖需另外保留原始 ZIP。');}
function importBackupFile(file){
 file.text().then(function(text){var obj=JSON.parse(text);if(obj.format!=='math-analyze-records-v1'||!obj.state||!Array.isArray(obj.state.papers)||!Array.isArray(obj.state.results)||!Array.isArray(obj.state.students))throw Error('不是支援的教師備份格式');
 if(!window.confirm('匯入將取代這個瀏覽器目前的學生、考卷與作答紀錄。確認繼續？'))return;
 state={students:obj.state.students,papers:obj.state.papers,results:obj.state.results,overrides:obj.state.overrides||{},packVersion:state.packVersion};
 save();selectedPaperId=state.papers.at(-1)?.id||'';refreshAll();notify('已還原紀錄。請確認題圖包也已在本機匯入。');
 }).catch(function(e){notify('備份匯入失敗：'+e.message,true);});
}
function settings(){
 var len=catalog?catalog.questions.length:0;
 $('packStatus').className='notice '+(state.packVersion&&len?'success':'warn');
 $('packStatus').textContent=len&&state.packVersion?'已載入 '+len+' 題。題圖與紀錄均在此瀏覽器；更換裝置請重新匯入。':'尚未匯入完整題圖包。先匯入後才能排版列印與產生試卷。';
}
function refreshAll(){refreshStudents();refreshTopics();refreshDashboard();refreshBank();paperList();refreshRecordHistory();report();settings();renderPreview();refreshRecordGrid();}
function switchTab(name){
 document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x.id===name);});
 document.querySelectorAll('.nav-btn').forEach(function(x){x.classList.toggle('active',x.dataset.target===name);});
 window.scrollTo({top:0,behavior:'smooth'});
}
function addStudent(name){var v=String(name||'').trim();if(!v)return notify('請輸入座號或學生代號。',true);if(state.students.includes(v))return notify('這個學生代號已存在。',true);state.students.push(v);state.students.sort();save();refreshAll();$('studentInput').value='';notify('已新增 '+v);}
function events(){
 document.addEventListener('click',function(e){var nav=e.target.closest('[data-target]');if(nav){switchTab(nav.dataset.target);return;}
 var open=e.target.closest('[data-open-q]');if(open){showQuestion(open.dataset.openQ);return;}
 var set=e.target.closest('[data-set-q]');if(set){var id=set.dataset.setQ;var v=set.dataset.qOk;state.overrides[id]=v==='reset'?undefined:v==='yes';if(v==='reset')delete state.overrides[id];save();refreshBank();showQuestion(id);notify('已更新題目 '+id+' 的狀態');return;}
 var sel=e.target.closest('[data-paper-id]');if(sel){selectedPaperId=sel.dataset.paperId;paperList();renderPreview();return;}
 var rem=e.target.closest('[data-remove-student]');if(rem){var name=rem.dataset.removeStudent;if(state.results.some(function(r){return r.student===name;}))return notify('該學生已有測驗紀錄，請先保留代號避免歷史紀錄失聯。',true);if(window.confirm('移除學生代號 '+name+'？')){state.students=state.students.filter(function(x){return x!==name;});save();refreshAll();}return;}
 var rq=e.target.closest('[data-rq]');if(rq){var id=rq.dataset.rq,k=rq.dataset.rtype;var list=currentRecord[k];if(list.includes(id))currentRecord[k]=list.filter(function(x){return x!==id;});else{currentRecord[k].push(id);currentRecord[k==='wrong'?'blank':'wrong']=currentRecord[k==='wrong'?'blank':'wrong'].filter(function(x){return x!==id;});}refreshRecordGrid();return;}
 });
 document.addEventListener('change',function(e){var r=e.target.closest('[data-reason]');if(r)currentRecord.reasons[r.dataset.reason]=r.value;});
 ['bankSearch','bankTopic','bankStatus'].forEach(function(id){$(id).addEventListener(id==='bankSearch'?'input':'change',function(){bankPage=0;refreshBank();});});
 $('bankPrev').onclick=function(){bankPage--;refreshBank();};$('bankNext').onclick=function(){bankPage++;refreshBank();};
 $('quickGenerate').onclick=function(){switchTab('papers');};
 $('paperMode').onchange=function(){$('paperStudent').disabled=val('paperMode')!=='individual';};
 $('paperMinutes').onchange=function(){if(val('paperMinutes')==='45')$('paperCount').value='25';else if(val('paperMinutes')==='15')$('paperCount').value='10';else $('paperCount').value='15';};
 $('paperTopics').addEventListener('change',function(){var n=Array.from(document.querySelectorAll('#paperTopics input:checked')).length;$('candidateCount').textContent='已選 '+n+' 個考點';});
 $('makePaper').onclick=makePaper;$('printPaper').onclick=printCurrent;$('downloadAnswers').onclick=answersCsv;
 $('recordPaper').onchange=loadExistingRecord;$('recordStudent').onchange=loadExistingRecord;$('saveRecord').onclick=saveRecord;
 $('reportScope').onchange=report;$('exportReport').onclick=exportReport;
 $('importPack').onclick=function(){$('importInput').click();};$('importInput').onchange=async function(){var file=this.files[0];if(!file)return;$('importPack').disabled=true;try{await importZip(file);}catch(e){notify('題庫匯入失敗：'+e.message,true);$('importProgress').textContent=e.message;}finally{$('importPack').disabled=false;this.value='';}};
 $('addStudent').onclick=function(){addStudent(val('studentInput'));};$('studentInput').addEventListener('keydown',function(e){if(e.key==='Enter')addStudent(val('studentInput'));});
 $('addClassBatch').onclick=function(){var prefix=window.prompt('輸入班級代碼（建立 01～35 號，僅作匿名識別）','815');if(prefix===null)return;prefix=prefix.trim().slice(0,20);if(!prefix)return;for(var i=1;i<=35;i++){var v=prefix+'-'+String(i).padStart(2,'0');if(!state.students.includes(v))state.students.push(v);}state.students.sort();save();refreshAll();notify('學生代號已更新');};
 $('exportBackup').onclick=exportBackup;$('importBackup').onclick=function(){$('backupInput').click();};$('backupInput').onchange=function(){if(this.files[0])importBackupFile(this.files[0]);this.value='';};
 $('resetData').onclick=function(){if(window.confirm('確定清空本機所有學生、考卷與作答紀錄？此動作不可復原，請先下載備份。')&&window.confirm('再次確認：清除所有學生、考卷、錯題紀錄與教師覆核狀態？')){state={students:[],papers:[],results:[],overrides:{},packVersion:state.packVersion};selectedPaperId='';save();refreshAll();notify('已清除本機登記紀錄。');}};
}
load();events();refreshAll();
})();
