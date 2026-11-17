const fs=require('node:fs');
const assert=require('node:assert/strict');
const Q=require('../src/core.js');
const manifests=require('../data/official-manifest.json');
(async()=>{
  const packs=[];
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
    packs.push(p);
    console.log(p.bank.bank_version,JSON.stringify({total:q.length,single:q.filter(x=>x.question_type==='single').length,
      multi:q.filter(x=>x.question_type==='multiple').length,images,videos,ko:q.filter(x=>x.official_explanation_ko).length}));
  }
  if(packs.length===2){
    const [old,next]=packs.map(p=>p.bank.questions);
    const result={prompt:0,options:0,answers:0,content:0,newQuestions:next.length-old.length};
    old.forEach((q,i)=>{
      const n=next[i];
      const p=q.prompt_zh!==n.prompt_zh,o=JSON.stringify(q.options)!==JSON.stringify(n.options),a=JSON.stringify(q.correct_answers)!==JSON.stringify(n.correct_answers);
      result.prompt+=p;result.options+=o;result.answers+=a;result.content+=p||o||a;
    });
    console.log('相同题号下的内容变化（各列可重叠）',JSON.stringify(result));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
