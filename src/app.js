(() => {
  'use strict';
  const payload=document.getElementById('app-data');
  const {manifests,rules,banks:embedded,assets}=JSON.parse(payload.textContent);
  payload.remove();
  const localVideos=new Map(), loopback=location.origin==='http://127.0.0.1:8787';
  const videoKey=(version,id)=>version+'/'+id;
  for(const bank of embedded)for(const q of bank.questions)for(const field of ['image_asset','video_asset']){
    if(!Number.isInteger(q[field]))continue;
    if(loopback&&field==='video_asset')localVideos.set(videoKey(bank.bank_version,q.question_id),q[field]);
    q[field]=assets[q[field]];
  }
  assets.length=0;
  const main=document.getElementById('main');
  const empty=()=>({active:null,stats:{},exams:{},ongoing:null});
  const packs=new Map();
  let db, study=empty(), run=null, pending=false, page='', clip=null, timerNotice, saveQueue=Promise.resolve();
  let examVideo=!!document.createElement('video').canPlayType('video/mp4');
  let filters={topic:'',trap:'',media:'',audit:'verified',incomplete:false}, examView=null;
  const labels={sequence:'顺序练习',random:'随机练习',wrong:'历史错题',favorite:'我的收藏',due:'到期复习',intensive:'考前集中复习'};
  const sectionLabels={home:'练习',rules:'规则对照',data:'数据管理'};
  const scorePolicy='官方公开说明确认从题库出题，共 40 题、40 分钟；一类普通合格线 70 分，二类普通 60 分。应用从已核验且素材齐全的题目中自行随机组卷，可选择加入一道视频题。未核实官方逐题分值及题型配比，因此只报告答对、答错与未答题数。';
  const movieSite='https://www.safedriving.or.kr/subExamBoard/selectSubExamBoardMovieList.do?menuCd=MN-PO-1153';
  const route=()=>['home','rules','data','quiz','result'].includes(location.hash.slice(1))?location.hash.slice(1):'home';
  const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const t=(x)=>E(x).replace(/\r?\n/g,'<br>');
  const link=(label,url)=>'<a href="'+E(url)+'" target="_blank" rel="noopener noreferrer">'+E(label)+'</a>';
  const button=(label,action,style='',disabled=false)=>'<button class="btn '+style+'" data-do="'+E(action)+'" '+(disabled?'disabled':'')+'>'+E(label)+'</button>';
  const pill=x=>'<span class="pill">'+E(x)+'</span>';
  const note=(x,kind='')=>'<p class="callout '+kind+'">'+x+'</p>';
  const current=()=>packs.get(study.active);
  const fetchStats=(key=study.active)=>study.stats[key]||{};
  const pstats=(id,key)=>fetchStats(key)[id]||Quiz.initial();
  const number=x=>new Intl.NumberFormat('zh-CN').format(x);
  const percent=(c,n)=>n?Math.round(c*100/n)+'%':'—';
  const dateTime=x=>x?new Date(x).toLocaleString('zh-CN',{hour12:false}):'—';
  const wrongs=(x)=>x.total-x.correct-x.blank;
  const opts=(items,current)=>items.map(([v,l])=>'<option value="'+E(v)+'"'+(v===current?' selected':'')+'>'+E(l)+'</option>').join('');
  const select=(label,id,items,value)=>'<label class="control"><span class="small">'+E(label)+'</span><select id="'+id+'">'+opts(items,value)+'</select></label>';
  const manifestOptions=()=>Object.entries(manifests).sort((a,b)=>a[0].localeCompare(b[0]));
  const material=q=>q.image_asset||q.video_asset;
  const coverage=(pack)=>{
    const qs=pack.bank.questions;
    const result={total:qs.length,verified:0,images:0,imgOK:0,videos:0,vidOK:0,unverified:0};
    for(const q of qs){
      const key=q.question_id;
      if(pack.trusted[key]) result.verified++; else result.unverified++;
      if(q.media_kind==='image'){result.images++;if(pack.media[key]==='素材已核验') result.imgOK++;}
      if(q.media_kind==='video'){result.videos++;if(pack.media[key]==='素材已核验') result.vidOK++;}
    }
    return result;
  };
  function notify(msg){
    const el=document.getElementById('notice');
    el.textContent=msg;el.hidden=false;clearTimeout(timerNotice);
    timerNotice=setTimeout(()=>{el.hidden=true;},6500);
  }
  function save(){
    const snapshot=JSON.parse(JSON.stringify(study));
    saveQueue=saveQueue.catch(()=>{}).then(()=>db.study(snapshot)).catch(()=>{
      document.getElementById('storage').textContent='｜写入失败，请立即导出备份';
      notify('设备存储写入失败。请在数据管理导出备份。');
    });
    return saveQueue;
  }
  function nav(hash){
    if(route()===hash){render(true);return;}
    location.hash=hash;
  }
  function setProgress(key,id,value){
    if(!study.stats[key]) study.stats[key]={};
    study.stats[key][id]=value;
  }
  function preferred(){
    const all=[...packs.values()];
    const official=all.filter(p=>p.manifest&&p.bank.effective_date<=Quiz.koreaDay()).sort((a,b)=>b.bank.effective_date.localeCompare(a.bank.effective_date));
    return (official[0]||all[0])?.key||null;
  }
  const shownVersion=pack=>pack.bank.bank_version+(pack.manifest?
    (pack.bank.effective_date>Quiz.koreaDay()?' · 预习（未生效）':' · 官方原件校验'):' · 待核验题库 '+pack.key.split('@')[1].slice(0,6));
  function bankSelect(){
    if(!packs.size)return '';
    return select('当前题库','bank',[...packs.values()].sort((a,b)=>a.bank.effective_date.localeCompare(b.bank.effective_date))
      .map(p=>[p.key,shownVersion(p)]),study.active);
  }
  function practiceFilter(){
    return {topic:filters.topic||null,trap:filters.trap||null,media:filters.media||null,
      audit:filters.audit,incomplete:filters.incomplete};
  }
  function dashboard(){
    const pack=current();
    if(!pack) return '<section class="hero"><p class="kicker">韩国驾照 · 中文离线练习</p><h1>把官方真题带在身边</h1><p>导入韩国道路交通公团（KoROAD）的中文题库，即可离线练题、做模拟考试，并保存错题。</p></section>'+
      '<section class="panel"><h2>先添加一个题库</h2><p>公开版本不捆绑官方题目和素材。可用仓库附带的工具在本地转换两版官方 PDF；已经有私人题库 JSON 可直接导入。</p><div class="row"><a class="btn primary" href="#data">导入题库</a><a class="btn" href="#rules">先读规则对照</a></div></section>';
    const progress=fetchStats(), qs=pack.bank.questions, stats=qs.map(q=>pstats(q.question_id)), a=stats.reduce((x,s)=>x+s.attempts,0), c=stats.reduce((x,s)=>x+s.correct,0);
    const cov=coverage(pack);
    const mk=(value,label)=>'<div class="stat"><strong>'+E(value)+'</strong><span>'+label+'</span></div>';
    const multi=qs.filter(q=>q.question_type==='multiple').length;
    const available=Object.values(pack.ready).filter(Boolean).length;
    const canExam=!!pack.manifest && pack.bank.effective_date<=Quiz.koreaDay() && available>=40;
    if(!pack.manifest&&filters.audit==='verified')filters.audit='pending';
    const top=[...new Set(qs.flatMap(q=>q.topics))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const traps=[...new Set(qs.flatMap(q=>q.trap_tags))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const last=study.exams[pack.key]?.at(0);
    const historic=manifestOptions().filter(([v,m])=>m.effective_date<=Quiz.koreaDay()).at(-1)?.[0];
    const future=pack.bank.effective_date>Quiz.koreaDay();
    return '<section class="hero"><p class="kicker">学习台 · '+E(shownVersion(pack))+'</p><h1>今天练哪一组？</h1><p>用错题找弱项，用规则理解答案。学习记录按题库版本分别保存。</p></section>'+
      '<section class="grid stats" aria-label="学习统计">'+mk(number(stats.filter(s=>s.attempts).length)+' / '+number(qs.length),'已练 / 导入题数')+
      mk(percent(c,a),'累计正确率')+mk(number(stats.filter(s=>s.wrong).length),'历史错题')+mk(number(stats.filter(s=>s.attempts&&s.due<=Date.now()).length),'到期复习')+'</section>'+
      '<section class="panel"><div class="row between"><div><p class="kicker">题库练习</p><h2>选一个练习模式</h2></div>'+bankSelect()+'</div>'+
      (future?note('此版本于韩国时间 '+E(pack.bank.effective_date)+' 生效。现在可预习，不能用它开始模拟考试。'):'')+
      (!future&&pack.manifest&&historic!==pack.bank.bank_version?note('这是旧版题库。较新的已生效版本为 '+E(historic)+'；准备近期考试时请优先使用新版。'):'')+
      (cov.unverified?note('待核验题目 '+number(cov.unverified)+' 道。此类题不会进入正式模拟。'):'')+
      '<p class="muted small">已比对原件答案 '+number(cov.verified)+' 道 · 多选 '+number(multi)+' 道 · 图片 '+cov.imgOK+'/'+cov.images+' · 视频 '+cov.vidOK+'/'+cov.videos+'</p>'+
      '<div class="row">'+select('专题','topic',[['','全部专题'],...top.map(x=>[x,x])],filters.topic)+
      select('中韩易错点','trap',[['','全部易错点'],...traps.map(x=>[x,x])],filters.trap)+
      select('素材类型','media',[['','全部'],['none','文字'],['image','图片'],['video','视频']],filters.media)+
      select('核验状态','audit',[['verified','原件已核对'],['pending','待核验练习区'],['all','全部']],filters.audit)+
      '</div><label class="check"><input id="incomplete" type="checkbox" '+(filters.incomplete?'checked':'')+'>显示缺素材的题（练习）</label>'+
      '<div class="row">'+Object.entries(labels).map(([k,label],i)=>button(label,'practice:'+k,i===0?'primary':i<3?'':'soft')).join('')+'</div>'+
      '<p class="spaced small muted">筛选后共 '+number(Quiz.practicePool(pack,progress,'sequence',practiceFilter()).length)+' 道可练；考前模式优先选历史错题和易错考点，最多 40 道。</p></section>'+
      '<section class="panel"><p class="kicker">计时组卷</p><h2>模拟考试</h2><p class="muted">'+E(scorePolicy)+'</p>'+
      '<div class="row">'+select('驾照类别','license',[['1','一类普通（1종 보통）'],['2','二类普通（2종 보통）']],'2')+
      button(study.ongoing?'继续进行中的模拟':'开始 40 题模拟','exam','primary',!study.ongoing&&!canExam)+'</div>'+
      (cov.vidOK&&!study.ongoing?'<label class="check"><input id="exam-video" type="checkbox" '+(examVideo?'checked':'')+'>模拟包含视频题</label>':'')+
      (last?'<p class="spaced small">最近一次：答对 '+last.correct+'、答错 '+wrongs(last)+'、未答 '+last.blank+'。'+button('查看本次错题','history')+'</p>':'')+
      (!canExam&&!study.ongoing?note('需要已生效的官方版本，并至少有 40 道完整可用的普通驾照题。'):'')+'</section>';
  }
  function rulePage(){
    return '<section class="hero"><p class="kicker">法律与考点</p><h1>别让驾驶习惯替你答题</h1><p>从韩国条文理解常见易错情境。有中国法规对照的卡片会列出两国依据。</p></section>'+
      '<section class="panel"><h2>中韩规则对照</h2>'+rules.map((r,i)=>'<details '+(i<2?'open':'')+'><summary>'+E(r.title)+'</summary><div class="inset"><p><b>韩国：</b>'+E(r.kr)+'</p>'+
      (r.cn?'<p><b>中国：</b>'+E(r.cn)+'</p>':'')+'<p class="small">'+r.refs.map(x=>link(x.label,x.url)).join(' · ')+'</p>'+
      (r.match&&current()?button('练习这一考点','rule:'+i,'soft'):'')+'</div></details>').join('')+'</section>'+
      '<section class="panel"><h2>中国大陆驾照换领</h2><p>韩国警方 2026 年 4 月 6 日公布的认可名单列有香港、澳门、台湾，未列中国大陆。一般持有效大陆正式汽车驾照办换领，先做文件审查，通常要体检和 40 道学科考试，可选中文；符合条件可免技能及道路驾驶考试，通常换领二类普通驾照。</p><p>部分身份可免学科考试，例如 A-1/A-2/A-3、D-7/D-8/D-9、E-1/E-3/E-4/E-7、F-4，以及其配偶和未满 19 岁的未婚子女。发证地停留、取得驾照时间及在韩居留等条件要由考场结合本人文件判断。办理前带大陆驾照正副本，确认公证和出入境证明要求。</p><p class="small">'+
      link('KoROAD 换领与文件要求','https://www.safedriving.or.kr/diGuide/selectDiGuide05.do')+' · '+
      link('KoROAD 居留资格豁免','https://www.safedriving.or.kr/diGuide/selectDiGuide08.do?menuCd=MN-PO-1213')+' · '+
      link('韩国警方认可名单公告','https://www.law.go.kr/LSW/admRulInfoR.do?admRulSeq=2100000277080')+' · '+
      link('施行令第52条','https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=109888')+'</p></section>';
  }
  function dataPage(){
    const pack=current();
    return '<section class="panel"><p class="kicker">导入与迁移</p><h1>数据管理</h1><p>换手机、搬动 HTML 或清理浏览器前，先把备份存到系统文件夹。浏览器保存的内容可能被系统清理。</p>'+bankSelect()+'</section>'+
      '<section class="grid"><div class="panel import-card"><h2>导入题库</h2><p class="small muted">选择本机转换好的 JSON。应用会独立核对指纹和素材。不会访问网络。</p><label for="bank-file">题库 JSON</label><input id="bank-file" type="file" accept=".json,application/json">'+
      button('导入题库','import','primary',pending)+'</div>'+
      '<div class="panel import-card"><h2>恢复备份</h2><p class="small muted">完整备份包含题库和记录。轻量备份只包含记录，先导入相同题库再恢复。恢复会替换此设备的学习记录。</p><label for="backup-file">备份 JSON</label><input id="backup-file" type="file" accept=".json,application/json">'+button('检查并恢复','restore','',pending)+'</div></section>'+
      '<section class="panel"><h2>导出备份</h2><p class="muted">备份可跨 Windows、Android 和 iPad 使用。含官方题目的私人备份请自行保管。</p><div class="row">'+button('导出完整备份','backup','primary',pending)+button('仅导出学习记录','progress','',pending)+'</div></section>'+
      '<section class="panel"><h2>官方版本与素材</h2>'+manifestOptions().map(([v,m])=>{
        const p=[...packs.values()].find(p=>p.manifest===m), c=p?coverage(p):null;
        return '<details '+(pack===p?'open':'')+'><summary>'+E(v)+' · '+(v>Quiz.koreaDay()?'尚未生效':'已生效')+'</summary><div class="inset"><p>官方原件 '+m.expected_questions+' 道，'+m.pages+' 页。当前设备导入 '+(c?.total||0)+' 道；原件答案已核对 '+(c?.verified||0)+' 道；缺 '+(m.expected_questions-(c?.total||0))+' 道；已核验图片 '+(c?.imgOK||0)+'/'+m.media_counts.image+'，视频 '+(c?.vidOK||0)+'/'+m.media_counts.video+'。</p>'+
        '<p class="small">'+link('官方公告',m.source_url)+' · '+link('中文 1·2 类 PDF',m.download_url)+' · '+link('官方视频公告',movieSite)+'</p><p class="small muted">原件 SHA-256：<code style="overflow-wrap:anywhere">'+E(m.attachment_sha256)+'</code></p></div></details>';
      }).join('')+'<p class="small muted">官方公开下载不等于许可再分发。公共应用只附校验指纹、法规卡与转换程序。</p></section>';
  }
  function openPractice(mode){
    if(study.ongoing){notify('请先继续并结束当前模拟考试。');return;}
    const pack=current();
    if(!pack)return;
    const qs=Quiz.practicePool(pack,fetchStats(),mode,practiceFilter());
    if(!qs.length){notify('当前筛选没有可练的题目，可以切换筛选条件。');return;}
    run={kind:'practice',key:pack.key,questions:qs,index:0,answers:{},checked:{},mode};
    nav('quiz');
  }
  function examObjects(active){
    const p=packs.get(active?.key);
    if(!p?.manifest || !Array.isArray(active.ids)||active.ids.length!==40||
      new Set(active.ids).size!==40||!active.ids.every(x=>p.ready[x]&&p.manifest.ordinary_ranges.some(([a,b])=>+x>=a&&+x<=b)))return null;
    const byId=new Map(p.bank.questions.map(q=>[q.question_id,q]));
    return {kind:'exam',key:active.key,index:active.index,answers:active.answers,questions:active.ids.map(i=>byId.get(i))};
  }
  function startExam(){
    if(!study.ongoing){
      const pack=current();
      const qs=Quiz.examPool(pack,Quiz.koreaDay(),Math.random,examVideo);
      study.ongoing={key:pack.key,license:document.getElementById('license').value,ends:Date.now()+Quiz.EXAM_MS,
        ids:qs.map(q=>q.question_id),index:0,answers:{}};
      save();
    }
    run=examObjects(study.ongoing);
    if(!run)throw Error('题库缺失，无法继续这场考试。');
    if(Date.now()>=study.ongoing.ends){submitExam(true);return;}
    nav('quiz');
  }
  function move(index){
    if(!run||index<0||index>=run.questions.length)return;
    run.index=index;
    if(run.kind==='exam'){study.ongoing.index=index;save();}
    render(true);
  }
  function choose(el){
    if(!run)return;
    const q=run.questions[run.index];
    if(run.kind==='exam'&&Date.now()>=study.ongoing.ends){submitExam(true);return;}
    if(run.kind==='practice'&&run.checked[q.question_id])return;
    run.answers[q.question_id]=[...main.querySelectorAll('input[data-answer]:checked')].map(o=>o.value);
    if(run.kind==='exam'){
      save();
      const mark=main.querySelector('[data-do="jump:'+run.index+'"]');
      if(mark)mark.classList.toggle('filled',run.answers[q.question_id].length>0);
      const done=main.querySelector('#answered');
      if(done)done.textContent=run.questions.filter(q=>run.answers[q.question_id]?.length).length;
    }else{
      const submit=main.querySelector('[data-do="check"]');
      if(submit)submit.disabled=!run.answers[q.question_id].length;
    }
  }
  const answerText=(q,ids)=>ids.map(i=>q.options.find(o=>o.id===i)).filter(Boolean).map(o=>E(o.id+'．'+o.text)).join('<br>')||'未作答';
  function explanation(q){
    return '<p><b>公布答案：</b><br>'+answerText(q,q.correct_answers)+'</p>'+
      (q.explanation_zh?'<p><b>中文解析 / 关联考点：</b><br>'+t(q.explanation_zh)+'</p>':'<p class="small muted">中文原件未提供解析；上方为 PDF 公布答案。</p>')+
      (q.official_explanation_ko?'<details '+(!q.explanation_zh?'open':'')+'><summary>官方解析原文（韩文 PDF 第 '+q.evidence.ko_page+' 页）</summary><p lang="ko">'+t(q.official_explanation_ko)+'</p></details>':'')+
      (q.legal_refs.length?'<p class="small">'+q.legal_refs.map(r=>link(r.label,r.url)).join(' · ')+'</p>':'');
  }
  function questionPage(){
    if(!run)return '<section class="panel"><p>没有进行中的练习。</p><a href="#home">返回首页</a></section>';
    const q=run.questions[run.index], id=q.question_id, pack=packs.get(run.key), exam=run.kind==='exam';
    const checked=!exam&&run.checked[id], selected=run.answers[id]||[];
    const completeness=pack.media[id];
    let options=q.options.map(o=>{
      const correct=checked&&q.correct_answers.includes(o.id), picked=selected.includes(o.id);
      return '<label class="option '+(correct?'ok':checked&&picked?'miss':'')+'"><input data-answer name="answer" type="'+(q.question_type==='single'?'radio':'checkbox')+'" value="'+E(o.id)+'"'+
        (picked?' checked':'')+(checked?' disabled':'')+'><b>'+E(o.id)+'．</b><span>'+E(o.text)+(correct?' <b>✓</b>':'')+'</span></label>';
    }).join('');
    const mediaMarkup=material(q)?(q.media_kind==='image'?'<img id="asset" class="media" alt="题目附图">':'<video id="asset" class="media" controls preload="metadata" playsinline aria-label="视频题素材"></video>'):
      q.media_kind==='none'?'':note('缺少这道题的'+(q.media_kind==='image'?'图片':'视频')+'；用原件核对后再作答。'+(q.media_kind==='video'?' '+link('官方视频题库',movieSite):''));
    const stats=pstats(id,run.key);
    const answered=run.questions.filter(q=>run.answers[q.question_id]?.length).length;
    return '<section class="panel"><div class="row between"><div><p class="kicker">'+E(exam?'模拟考试 · '+(study.ongoing.license==='1'?'一类普通':'二类普通'):labels[run.mode])+'</p><b>第 '+(run.index+1)+' / '+run.questions.length+' 题</b></div>'+
      (exam?'<output id="timer" class="timer" aria-label="剩余时间"></output>':button(stats.favorite?'取消收藏':'加入收藏','favorite','soft'))+'</div>'+
      '<progress max="'+run.questions.length+'" value="'+(run.index+1)+'" aria-label="当前题位"></progress>'+
      '<div class="row">'+pill('题号 '+id)+pill(q.question_type==='single'?'单选':'多选')+
      (exam?'':pill(pack.trusted[id]?'官方原件已核对':'待核验')+(q.media_kind!=='none'?pill(completeness):''))+'</div>'+
      '<h1 class="question" id="prompt" tabindex="-1">'+E(q.prompt_zh)+'</h1>'+mediaMarkup+'<fieldset><legend>'+
      (q.question_type==='single'?'选择一项':'选择符合题意的全部选项')+'</legend>'+options+'</fieldset>'+
      (!exam?(checked?note(Quiz.sameAnswer(selected,q.correct_answers)?'<b>回答正确</b>':'<b>答错了，已记入错题</b>',Quiz.sameAnswer(selected,q.correct_answers)?'good':'bad')+
        '<div class="spaced">'+explanation(q)+'</div>':
        button('提交答案','check','primary',!selected.length)):'')+
      '<div class="row between spaced"><div class="row">'+button('上一题','prev','',!run.index)+button('下一题','next',checked?'primary':'',run.index===run.questions.length-1)+'</div>'+
      (exam?button('提前交卷','submit','danger'):'<a class="btn" href="#home">结束练习</a>')+'</div>'+
      (!exam?'<p class="small muted spaced">最近练习：'+E(dateTime(stats.last))+' · 正确率：'+percent(stats.correct,stats.attempts)+' · 下次复习：'+E(dateTime(stats.due))+'</p>'+
        (pack.trusted[id]?'<p class="small muted">原件 '+E(pack.bank.bank_version)+' · PDF 第 '+q.evidence.page+' 页 · '+link('KoROAD 公告',pack.bank.source_url)+'</p>':''):'')+'</section>'+
      (exam?'<section class="panel"><h2>答题卡</h2><p class="small">已答 <span id="answered">'+answered+'</span> / 40</p><div class="qnav">'+run.questions.map((q,i)=>'<button data-do="jump:'+i+'" aria-label="第 '+(i+1)+' 题" '+(i===run.index?'aria-current="step"':'')+' class="'+(i===run.index?'current ':'')+(run.answers[q.question_id]?.length?'filled':'')+'">'+(i+1)+'</button>').join('')+'</div></section>':'');
  }
  function resultPage(){
    if(!examView)return '<section class="panel"><p>没有打开的考试结果。</p><a href="#home">返回首页</a></section>';
    const {key,result:res}=examView;
    const pack=packs.get(key), qs=new Map(pack?.bank.questions.map(q=>[q.question_id,q])||[]);
    return '<section class="hero"><p class="kicker">'+E(examView.auto?'已到时自动交卷':'模拟结果')+'</p><h1>答对 '+res.correct+' / '+res.total+' 题</h1><p>答错 '+wrongs(res)+' 题，未答 '+res.blank+' 题。两类题都已记入错题。'+E(scorePolicy)+'</p></section>'+
      '<section class="panel"><div class="row between"><h2>本次错题与未答题</h2><a class="btn" href="#home">返回首页</a></div>'+
      (res.correct===res.total?'<p>本次全部答对。</p>':res.rows.filter(r=>!r.correct).map(r=>{
        const q=qs.get(r.id);
        return '<details><summary>'+E((r.blank?'未答':'答错')+' · 题号 '+r.id)+'</summary>'+
          (q?'<div class="inset"><p>'+E(q.prompt_zh)+'</p><p><b>你的答案：</b><br>'+answerText(q,r.selected)+'</p>'+explanation(q)+
          button('单独复习','revisit:'+r.id,'soft')+'</div>':'<p>本地没有这道题。重新导入原版本即可查看题文。</p>')+'</details>';
      }).join(''))+'</section>';
  }
  function submitExam(auto=false){
    const active=study.ongoing;
    if(!active)return;
    const exam=examObjects(active);
    if(!exam){study.ongoing=null;save();notify('考试题库不可用，无法生成结果。');return;}
    const result=Quiz.result(exam.questions,active.answers);
    if(!auto&&result.blank&&!confirm('还有 '+result.blank+' 道题未作答。现在交卷？'))return;
    const now=Date.now(), key=active.key;
    if(now>=active.ends)auto=true;
    for(const r of result.rows)setProgress(key,r.id,Quiz.attempt(pstats(r.id,key),r.correct,now));
    const history={...result,finished:now,license:active.license,auto};
    study.exams[key]=[history,...study.exams[key]||[]].slice(0,30);
    study.ongoing=null;
    if(run?.kind==='exam')run=null;
    examView={key,result:history,auto};save();nav('result');
  }
  function tick(){
    if(!study.ongoing)return;
    const secs=Math.max(0,Math.ceil((study.ongoing.ends-Date.now())/1000));
    if(!secs){submitExam(true);return;}
    const el=document.getElementById('timer');
    if(el)el.textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');
  }
  function render(focus=false){
    page=route();
    document.querySelectorAll('nav a').forEach(a=>{
      if(a.hash==='#'+(page==='quiz'||page==='result'?'home':page))a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
    if(clip){URL.revokeObjectURL(clip);clip=null;}
    if(page==='quiz'&&!run&&study.ongoing)run=examObjects(study.ongoing);
    main.innerHTML=({home:dashboard,rules:rulePage,data:dataPage,quiz:questionPage,result:resultPage})[page]();
    if(page==='quiz'&&run){
      const q=run.questions[run.index], asset=document.getElementById('asset');
      if(asset){
        const pack=packs.get(run.key),data=material(q);
        const local=q.media_kind==='video'&&pack.media[q.question_id]==='素材已核验' ?
          localVideos.get(videoKey(pack.bank.bank_version,q.question_id)) : undefined;
        const sources=local!==undefined?['/media/'+local+'.mp4',data]:[data];
        const split=data.indexOf(',');
        if(local===undefined){
          const bytes=Quiz.base64(data.slice(split+1));
          clip=URL.createObjectURL(new Blob([bytes],{type:data.slice(5,split-7)}));
          sources.unshift(clip);
        }
        asset.addEventListener('error',()=>{
          if(!asset.isConnected)return;
          if(sources.length){asset.src=sources.shift();return;}
          if(q.media_kind==='video')examVideo=false;
          notify(q.media_kind==='video'?'当前浏览器未能播放视频。下次模拟可取消「模拟包含视频题」。':'当前浏览器未能显示该图片。');
        });
        asset.src=sources.shift();
      }
    }
    if(focus){(document.getElementById('prompt')||main).focus({preventScroll:true});window.scrollTo(0,0);}
    tick();
  }
  async function readFile(id){
    const el=document.getElementById(id);
    const file=el?.files?.[0];
    if(!file)throw Error('请先选择 JSON 文件。');
    if(file.size>Quiz.MAX_FILE)throw Error('文件大于 300 MB，请按版本减少视频素材。');
    try{return JSON.parse(await file.text());}catch{throw Error('未能读取有效的 JSON 文件。');}
  }
  const saveFile=(payload,suffix)=>{
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    if(blob.size>Quiz.MAX_FILE)throw Error('完整备份超过 300 MB。请导出轻量备份，并分别保存题库文件。');
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download='韩驾学科-'+Quiz.koreaDay()+suffix+'.backup.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    notify('已准备备份文件，请确认下载成功并存到系统文件夹。');
  };
  function validateStudy(raw,destination){
    if(!raw||typeof raw!=='object'||!raw.stats||!raw.exams)throw Error('备份没有有效学习记录。');
    const clean=empty(), keyOK=k=>destination.has(k);
    const entries=x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('学习记录格式无效。');return Object.entries(x);};
    const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
    const question=(k,id)=>destination.get(k).bank.questions.find(q=>q.question_id===id);
    const validChoice=(q,selected)=>Array.isArray(selected)&&new Set(selected).size===selected.length&&
      selected.every(a=>q.options.some(o=>o.id===a))&&(q.question_type==='multiple'||selected.length<=1);
    for(const [k,value] of entries(raw.stats)){
      if(!keyOK(k))throw Error('备份需要相同内容的题库：'+k.split('@')[0]);
      clean.stats[k]={};
      for(const [id,s] of entries(value)){
        if(!question(k,id)||!Quiz.validStat(s))throw Error('发现无效的做题记录：'+id);
        clean.stats[k][id]={attempts:s.attempts,correct:s.correct,wrong:s.wrong,streak:s.streak,last:s.last,due:s.due,favorite:s.favorite};
      }
    }
    for(const [k,list] of entries(raw.exams)){
      if(!keyOK(k)||!Array.isArray(list)||list.length>30)throw Error('备份含无效考试记录或缺少相同题库。');
      clean.exams[k]=list.map(h=>{
        if(!h||!Array.isArray(h.rows)||h.rows.length!==40||!['1','2'].includes(h.license)||
          !integer(h.finished,1,8640000000000000)||new Set(h.rows.map(r=>r?.id)).size!==40)
          throw Error('考试记录格式无效。');
        const qs=h.rows.map(row=>question(k,row?.id));
        if(qs.some((q,i)=>!q||!validChoice(q,h.rows[i].selected)))throw Error('考试题号或选择无效。');
        return {...Quiz.result(qs,Object.fromEntries(h.rows.map(r=>[r.id,r.selected]))),finished:h.finished,license:h.license,auto:h.auto===true};
      });
    }
    clean.active=keyOK(raw.active)?raw.active:null;
    if(raw.ongoing){
      const {key,ids,index,answers,license,ends}=raw.ongoing;
      const p=destination.get(key);
      if(!p?.manifest||!['1','2'].includes(license)||!integer(ends,1,8640000000000000)||!integer(index,0,39)||
        !Array.isArray(ids)||ids.length!==40||new Set(ids).size!==40||
        !ids.every(id=>p.ready[id]&&p.manifest.ordinary_ranges.some(([a,b])=>+id>=a&&+id<=b))||
        !entries(answers).every(([id,a])=>ids.includes(id)&&validChoice(question(key,id),a)))throw Error('进行中的考试记录无效或缺少素材。');
      clean.ongoing={key,ids,index,answers,license,ends};
    }
    return clean;
  }
  function combine(old, next) {
    if(!old?.manifest || !next.manifest)return next;
    const qs=new Map(old.bank.questions.map(q=>[q.question_id,q]));
    for(const q of next.bank.questions){
      const before=qs.get(q.question_id);
      if(before){
        if(old.media[q.question_id]==='素材已核验'&&next.media[q.question_id]!=='素材已核验'){
          q.image_asset=before.image_asset;q.video_asset=before.video_asset;
        }
        if(before.official_explanation_ko&&!q.official_explanation_ko){
          q.official_explanation_ko=before.official_explanation_ko;q.evidence.ko_page=before.evidence.ko_page;
        }
      }
      qs.set(q.question_id,q);
    }
    return Quiz.validateBank({...next.bank,questions:[...qs.values()].sort((a,b)=>+a.question_id-+b.question_id)},manifests);
  }
  async function addBank(raw,write){
    let p=await Quiz.validateBank(raw,manifests);
    if(packs.has(p.key))p=await combine(packs.get(p.key),p);
    if(write){
      try{await db.bank(p.key,p.bank);}catch{
        notify('题库已临时加载，但设备存储写入失败。请保留原题库文件。');
        document.getElementById('storage').textContent='｜题库无法写入存储';
      }
    }
    packs.set(p.key,p);
    return p;
  }
  async function doFile(restore){
    if(pending)return;
    pending=true;
    const header=main.querySelector('h1');
    if(header)header.textContent=restore?'正在检查备份…':'正在核对题库指纹和素材…';
    try{
      const raw=await readFile(restore?'backup-file':'bank-file');
      if(!restore){
        const p=await addBank(raw,true);
        study.active=p.key;
        filters={topic:'',trap:'',media:'',audit:p.manifest?'verified':'all',incomplete:false};
        await save();
        const ct=coverage(p);
        if(document.getElementById('storage').textContent.includes('失败')||document.getElementById('storage').textContent.includes('无法'))
          notify('已临时加载 '+number(ct.total)+' 道题；请保留原 JSON，设备存储未能完整写入。');
        else notify('已加载 '+number(ct.total)+' 道题 · 原件已核对 '+number(ct.verified)+' 道');
      }else{
        if(raw?.format!=='kr-driving-quiz-backup'||raw.version!==1||!(raw.banks===null||Array.isArray(raw.banks)&&raw.banks.length<=50))
          throw Error('备份文件类型或版本无效。');
        const destination=new Map(packs);
        if(raw.banks!==null)for(const bank of raw.banks){
          let p=await Quiz.validateBank(bank,manifests);
          if(destination.has(p.key))p=await combine(destination.get(p.key),p);
          destination.set(p.key,p);
        }
        const next=validateStudy(raw.study,destination);
        if(!confirm('已校验备份。恢复会替换本设备的学习记录和进行中的考试，同时保留已导入的题库。继续？'))return;
        await saveQueue;
        await db.restore([...destination.values()],next);
        packs.clear();destination.forEach((v,k)=>packs.set(k,v));
        study=next;if(!current())study.active=preferred();
        run=null;examView=null;notify('备份恢复成功。');
      }
    } finally {pending=false;render();}
  }

  main.addEventListener('change',ev=>{
    const el=ev.target;
    if(el.matches('[data-answer]')){choose(el);return;}
    if(el.id==='exam-video'){examVideo=el.checked;return;}
    if(el.id==='bank'&&packs.has(el.value)){
      study.active=el.value;filters={topic:'',trap:'',media:'',audit:current().manifest?'verified':'all',incomplete:false};save();render();return;
    }
    if(['topic','trap','media','audit','incomplete'].includes(el.id)){
      filters[el.id]=el.id==='incomplete'?el.checked:el.value;render();document.getElementById(el.id)?.focus();
    }
  });
  main.addEventListener('click',async ev=>{
    const target=ev.target.closest('[data-do]');
    if(!target||pending)return;
    const [action,arg]=target.dataset.do.split(':');
    try{
      if(action==='practice')openPractice(arg);
      if(action==='exam')startExam();
      if(action==='next')move(run.index+1);
      if(action==='prev')move(run.index-1);
      if(action==='jump')move(+arg);
      if(action==='submit')submitExam();
      if(action==='import'||action==='restore')await doFile(action==='restore');
      if(action==='backup'||action==='progress')
        saveFile({format:'kr-driving-quiz-backup',version:1,created:new Date().toISOString(),
          banks:action==='backup'?[...packs.values()].map(p=>p.bank):null,study},action==='backup'?'完整':'进度');
      if(action==='favorite'&&run?.kind==='practice'){
        const q=run.questions[run.index], s=pstats(q.question_id,run.key);
        setProgress(run.key,q.question_id,{...s,favorite:!s.favorite});save();
        target.textContent=s.favorite?'加入收藏':'取消收藏';notify(s.favorite?'已取消收藏。':'已收藏。');
      }
      if(action==='check'&&run?.kind==='practice'){
        const q=run.questions[run.index], id=q.question_id, choices=run.answers[id];
        if(!choices?.length||run.checked[id])return;
        run.checked[id]=true;
        setProgress(run.key,id,Quiz.attempt(pstats(id,run.key),Quiz.sameAnswer(choices,q.correct_answers)));
        save();render();
      }
      if(action==='rule'&&current()){
        filters={topic:'',trap:rules[+arg].title,media:'',audit:current().manifest?'verified':'all',incomplete:false};openPractice('sequence');
      }
      if(action==='history'&&current()){
        const result=study.exams[study.active]?.[0];
        if(result){examView={key:study.active,result,auto:result.auto};nav('result');}
      }
      if(action==='revisit'&&examView){
        const q=packs.get(examView.key)?.bank.questions.find(q=>q.question_id===arg);
        if(q){run={kind:'practice',key:examView.key,index:0,questions:[q],answers:{},checked:{},mode:'wrong'};nav('quiz');}
      }
    }catch(e){notify(e.message||'操作失败。');}
  });

  (async()=>{
    db=await QuizStore.connect();
    const storageLabel=document.getElementById('storage');
    storageLabel.textContent='｜存储方式：'+db.label;
    if(db.label==='仅本次打开')notify('浏览器不允许持久保存。请在关闭页面前导出备份。');
    // 先读本机库；新私人离线文件可以补齐旧库缺失的官方素材。
    let saved;
    try {saved=await db.load();if(saved.study)study=saved.study;}
    catch{notify('本地存储读取失败。若有备份，请从数据管理恢复。');}
    for(const raw of [...saved?.banks||[],...embedded]){
      main.firstElementChild.textContent='正在核对本地题库与素材…';
      try{await addBank(raw,false);}catch{notify('一份已存在的题库无法通过校验。');}
    }
    if(!current())study.active=preferred();
    if(study.ongoing&&!examObjects(study.ongoing)){study.ongoing=null;save();notify('已保存的模拟缺少完整题库，无法继续。');}
    window.addEventListener('hashchange',()=>render(true));
    document.addEventListener('visibilitychange',tick);
    setInterval(tick,500);
    render();
  })().catch(e=>{main.textContent='启动失败：'+e.message;});
})();
