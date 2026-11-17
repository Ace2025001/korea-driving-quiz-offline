const fs=require('node:fs');
const assert=require('node:assert/strict');
const Q=require('../src/core.js');
const Coach=require('../src/coach.js');
const chapters=require('../data/coaching.json');
const notes=require('../data/explanation-notes.json');
const manifests=require('../data/official-manifest.json');
(async()=>{
  const packs=[];
  const translations=process.env.QUIZ_TRANSLATIONS?JSON.parse(fs.readFileSync(process.env.QUIZ_TRANSLATIONS,'utf8')):null;
  for(const file of process.argv.slice(2)){
    const p=await Q.validateBank(JSON.parse(fs.readFileSync(file,'utf8')),manifests);
    const q=p.bank.questions, m=p.manifest;
    assert(m && Object.values(p.trusted).every(Boolean));
    assert.equal(q.length,m.expected_questions);
    assert.equal(q.filter(x=>x.official_explanation_ko).length,m.media_counts.ko_explanation);
    const images=q.filter(x=>x.media_kind==='image'&&p.ready[x.question_id]).length;
    const videos=q.filter(x=>x.media_kind==='video'&&p.ready[x.question_id]).length;
    assert.equal(images,m.media_counts.image-(m.media_counts.image_missing||0));
    assert.equal(videos,m.media_counts.video);
    assert.equal(new Set(chapters.flatMap(ch=>ch.order)).size,26);
    for(const ch of chapters){
      const lessons=Coach.chapterQuestions(p,ch);
      assert.equal(lessons.length,ch.order.length);
      assert.deepEqual(new Set(ch.order),new Set(Object.keys(ch.items)));
      for(const item of lessons)assert.equal(ch.items[item.question_id].options.length,item.options.length);
    }
    if(translations){
      const translated=translations.banks[p.bank.bank_version];
      const hand=new Set(chapters.flatMap(c=>c.order));
      const ordinary=q.filter(q=>m.ordinary_ranges.some(([a,b])=>+q.question_id>=a&&+q.question_id<=b));
      const needed=ordinary.filter(q=>!hand.has(q.question_id));
      assert.equal(Object.keys(translated).length,needed.length);
      for(const q of needed){
        const row=translated[q.question_id];
        assert.equal(row.fingerprint,m.questions[q.question_id][0]);
        if(row.source==='none'){
          assert(notes[q.question_id]?.why);
          assert(!q.official_explanation_ko);
        }else{
          assert(q.official_explanation_ko);
          assert(row.translated.some(([,text])=>/[\u3400-\u9fff]/.test(text)));
        }
      }
      console.log(p.bank.bank_version,'二类普通讲解',ordinary.length+'/'+ordinary.length,
        '其中 26 道逐项人工讲解；待核对机译条数',needed.filter(q=>translated[q.question_id].checks.length>0).length);
    }
    packs.push(p);
    console.log(p.bank.bank_version,JSON.stringify({total:q.length,single:q.filter(x=>x.question_type==='single').length,
      multi:q.filter(x=>x.question_type==='multiple').length,images,videos,ko:q.filter(x=>x.official_explanation_ko).length}));
  }
  if(packs.length===2){
    const [old,next]=packs.map(p=>p.bank.questions);
    for(const id of chapters.flatMap(ch=>ch.order)){
      const a=old.find(q=>q.question_id===id),b=next.find(q=>q.question_id===id);
      assert.deepEqual([a.prompt_zh,a.options,a.correct_answers],[b.prompt_zh,b.options,b.correct_answers],
        '手写解析必须与两版同号题的文字、选项序列和答案一致：'+id);
    }
    for(const [id,note] of Object.entries(notes)){
      const shape=q=>[q.prompt_zh,q.options,q.correct_answers];
      const a=old.find(q=>q.question_id===id),b=next.find(q=>q.question_id===id);
      if(!note.versions)assert.deepEqual(shape(a),shape(b),'复核讲解跨版本错位：'+id);
      else for(const v of note.versions)assert(packs.find(p=>p.bank.bank_version===v)?.trusted[id]);
    }
    const result={prompt:0,options:0,answers:0,content:0,newQuestions:next.length-old.length};
    old.forEach((q,i)=>{
      const n=next[i];
      const p=q.prompt_zh!==n.prompt_zh,o=JSON.stringify(q.options)!==JSON.stringify(n.options),a=JSON.stringify(q.correct_answers)!==JSON.stringify(n.correct_answers);
      result.prompt+=p;result.options+=o;result.answers+=a;result.content+=p||o||a;
    });
    console.log('相同题号下的内容变化（各列可重叠）',JSON.stringify(result));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
