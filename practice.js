(function(){
'use strict';
const API=window.MathAnalyzeExtensionAPI;
if(!API)return;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentPaperId='',lastStudent='',renderToken=0,imageUrls=[];
function releaseImages(){imageUrls.forEach(u=>URL.revokeObjectURL(u));imageUrls=[];}
function selectedTopics(){return [...document.querySelectorAll('#practiceTopics input:checked')].map(el=>el.value);}
function selectedStudent(){return $('practiceStudent').value;}
function snapshot(){return API.snapshot();}
function toast(s,isError){API.toast(s,!!isError);}
function answeredCount(p){
 const a=snapshot().practiceDrafts[p.id]?.answers||{};
 return p.questionIds.filter(id=>['A','B','C','D'].includes(a[id])).length;
}
function todayStudentResults(student){
 const s=snapshot(),pById=new Map(s.papers.map(p=>[p.id,p]));
 return s.results.filter(r=>r.student===student&&pById.get(r.paperId)?.isSelfPractice).map(r=>({record:r,paper:pById.get(r.paperId)})).sort((a,b)=>String(b.paper.trainingDate).localeCompare(String(a.paper.trainingDate)));
}
function renderStatus(){
 const student=selectedStudent();
 const box=$('practiceTodayStatus'),other=$('practiceRecent');
 if(!student){box.innerHTML='<p class="hint">先從左邊選擇座號。</p>';other.innerHTML='';return;}
 const day=API.today(),used=API.practiceUsed(student,day),remain=Math.max(0,15-used);
 const current=snapshot().practiceDrafts;
 box.innerHTML='<div class="grid grid-2"><div class="kpi"><div class="k">今日已完成</div><div class="num">'+used+' / 15</div></div><div class="kpi"><div class="k">還能練習</div><div class="num">'+remain+' 題</div></div></div>'+
  '<p class="hint">日期：'+esc(day)+'｜只統計「每日自主練習」，不限制教師建立的紙本試卷。</p>';
 $('practiceQuota').textContent=remain?'今天剩餘 '+remain+' 題。選擇座號後開始；未完成草稿會保留。':'今天已達15題上限，明天才會開放下一次自主練習。';
 $('practiceStart').disabled=!snapshot().ready||!remain;
 if(remain>0){$('practiceCount').max=String(remain);const value=Number($('practiceCount').value);if(!Number.isInteger(value)||value<1||value>remain)$('practiceCount').value=String(remain);}
 const recent=todayStudentResults(student).slice(0,12);
 other.innerHTML=recent.length?recent.map(x=>{
  const n=x.paper.questionIds.length,correct=n-(x.record.wrong||[]).length-(x.record.blank||[]).length;
  return '<div class="item"><div><strong>'+esc(x.paper.trainingDate)+'</strong><p class="hint">'+esc(x.paper.title)+'</p></div><span class="chip '+(correct/n>=.8?'ok':'wait')+'">'+correct+'/'+n+'</span></div>';
 }).join(''):'<p class="hint">尚無已完成的每日自主練習。</p>';
}
async function renderQuestions(){
 const s=snapshot(),student=selectedStudent(),draft=API.getPracticeDraft(student,API.today());
 const box=$('practiceQuestions'),submit=$('practiceSubmitWrap'),feedback=$('practiceFeedback');
 const token=++renderToken;releaseImages();
 if(!draft){currentPaperId='';submit.style.display='none';box.innerHTML='<p class="hint">目前沒有進行中的練習。請選擇座號與題數，然後按「開始／繼續練習」。</p>';return;}
 currentPaperId=draft.id;submit.style.display='flex';
 const answers=s.practiceDrafts[draft.id]?.answers||{};
 box.innerHTML='<div class="actions" style="justify-content:space-between"><strong>'+esc(draft.title)+'</strong><span class="chip">共 '+draft.questionIds.length+' 題</span></div>'+
  draft.questionIds.map((id,i)=>{
   const opt=['A','B','C','D'].map(a=>'<label class="practice-option"><input type="radio" name="practice-'+i+'" data-practice-q="'+esc(id)+'" value="'+a+'"'+(answers[id]===a?' checked':'')+'><span>'+a+'</span></label>').join('');
   return '<article class="practice-question"><h4>第 '+(i+1)+' 題</h4><div class="practice-image" data-image-id="'+esc(id)+'"><p class="hint">題圖載入中…</p></div><div class="practice-options">'+opt+'</div></article>';
  }).join('');
 $('practiceAnswered').textContent='已選答案 '+answeredCount(draft)+' / '+draft.questionIds.length+' 題；未選題視為空白。';
 feedback.innerHTML='';
 for(const id of draft.questionIds){
  const blob=await API.imageBlob(id);if(token!==renderToken)return;
  const el=[...box.querySelectorAll('[data-image-id]')].find(x=>x.dataset.imageId===id);
  if(!el)continue;
  if(!blob){el.innerHTML='<p class="notice warn">缺少題圖 '+esc(id)+'，請教師重新匯入題圖包。</p>';continue;}
  const url=URL.createObjectURL(blob);imageUrls.push(url);
  const im=document.createElement('img');im.alt='練習題圖 '+id;im.src=url;el.replaceChildren(im);
 }
}
function refresh(){
 const s=snapshot(),selector=$('practiceStudent');if(!selector)return;
 const previous=selector.value||lastStudent;
 selector.innerHTML='<option value="">請選擇座號</option>'+s.students.map(id=>'<option value="'+esc(id)+'">'+esc(id)+'</option>').join('');
 if(s.students.includes(previous))selector.value=previous;
 lastStudent=selector.value;
 const topicsBox=$('practiceTopics');
 if(!topicsBox.dataset.initialized){
  topicsBox.innerHTML=s.topics.map(t=>'<label class="topic-opt"><input type="checkbox" value="'+esc(t[0])+'" checked> '+esc(t[1])+'</label>').join('');
  topicsBox.dataset.initialized='true';
 }
 renderStatus();
 const next=API.getPracticeDraft(selector.value,API.today())?.id||'';
 if(next!==currentPaperId)renderQuestions();
}
function start(){
 const student=selectedStudent(),count=Number($('practiceCount').value),topics=selectedTopics();
 try{
  const paper=API.createSelfPractice({student,count,topics});
  currentPaperId='';renderQuestions();renderStatus();
  toast('開始練習：'+paper.questionIds.length+'題。作答會暫存於本機。');
  $('practiceWorkspace').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){toast(e.message,true);}
}
function submit(){
 const s=snapshot(),p=s.papers.find(x=>x.id===currentPaperId);if(!p)return toast('請先開始練習。',true);
 const answered=answeredCount(p),miss=p.questionIds.length-answered;
 if(miss&&!confirm('還有 '+miss+' 題未選答案，將記錄為空白題。確定提交？'))return;
 if(!confirm('確認提交 '+p.questionIds.length+' 題？提交後將自動登記，不能重複提交。'))return;
 try{
  const result=API.submitSelfPractice(p.id);
  currentPaperId='';renderQuestions();renderStatus();
  $('practiceFeedback').innerHTML='<div class="notice success"><strong>已完成 '+esc(result.student)+' 本次練習</strong><p>答對 '+result.correct+'/'+result.total+' 題、答錯 '+result.wrong+' 題、空白 '+result.blank+' 題。紀錄已儲存在這個瀏覽器，教師可至「錯題登記」依日期檢視。</p><p class="small">自動判分使用題庫原始答案，尚未獨立核對；如有疑義請交由教師覆核。</p></div>';
  toast('作答已儲存，已計入今日練習進度。');
 }catch(e){toast(e.message,true);}
}
$('practiceStart').addEventListener('click',start);
$('practiceSubmit').addEventListener('click',submit);
$('practiceStudent').addEventListener('change',()=>{lastStudent=selectedStudent();currentPaperId='';renderStatus();renderQuestions();$('practiceFeedback').innerHTML='';});
$('practiceQuestions').addEventListener('change',e=>{
 const input=e.target.closest('[data-practice-q]');if(!input||!currentPaperId)return;
 try{API.choosePractice(currentPaperId,input.dataset.practiceQ,input.value);
 const p=snapshot().papers.find(p=>p.id===currentPaperId);
 if(p)$('practiceAnswered').textContent='已選答案 '+answeredCount(p)+' / '+p.questionIds.length+' 題；未選題視為空白。';
 }catch(err){toast(err.message,true);}
});
window.MathAnalyzePractice={refresh};refresh();
})();
