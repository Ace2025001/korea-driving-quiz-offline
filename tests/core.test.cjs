const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const Q=require('../src/core.js');
const {make,manifest}=require('./fixture.cjs');
test('核验 SHA-256：没有 SubtleCrypto 时与 Node 结果一致',async()=>{
  const context={module:{},TextEncoder};
  vm.runInNewContext(fs.readFileSync('src/core.js','utf8'),context);
  for(const x of ['', 'abc','测试 🚦'.repeat(21),'x'.repeat(56),'y'.repeat(64),'媒体'.repeat(5000)]){
    const expected=createHash('sha256').update(JSON.stringify(x)).digest('hex');
    assert.equal(await context.module.exports.digest(x),expected);
    assert.equal(await Q.digest(x),expected);
  }
});
test('不接受 JSON 自称的核验状态；题文、分项答案或页码变动均不能入模拟',async()=>{
  const bank=make(), trusted=await manifest(bank);
  const p=await Q.validateBank(bank);
  assert.equal(p.trusted['1'],false);
  assert.throws(()=>Q.examPool(p,'2026-11-17'),/官方/);
  for(const mutate of [q=>q.prompt_zh+='！',q=>q.correct_answers=['1'],q=>q.evidence.page=2]){
    const next=structuredClone(bank);
    mutate(next.questions[0]);
    const p=await Q.validateBank(next,trusted);
    assert.equal(p.trusted['1'],false);
    assert.throws(()=>Q.examPool(p,'2026-11-17'),/官方/);
  }
});
test('严格拒绝重复题号、不合法答案、题型冲突、假生效日期及伪装素材',async()=>{
  for(const [mutate, msg] of [
    [b=>b.questions[1].question_id='1',/重复/],
    [b=>b.questions[0].correct_answers=['4'],/不存在/],
    [b=>b.questions[0].correct_answers=['2','3'],/题型/],
    [b=>b.effective_date='2026-02-30',/日期/],
    [b=>Object.assign(b.questions[0],{media_kind:'image',image_asset:'data:image/png;base64,YWJj'}),/格式/],
    [b=>b.questions[0].question_id='toString',/题号/],
    [b=>b.questions[0].legal_refs=[{label:'测试',url:'javascript:alert(1)'}],/法规/]
  ]){
    const bank=make();
    mutate(bank);
    await assert.rejects(Q.validateBank(bank),msg);
  }
});
test('图片素材独立核对：缺失或指纹不符的题目不进卷',async()=>{
  const bank=make();
  bank.questions[0].media_kind='image';
  bank.questions[1].media_kind='image';
  bank.questions[1].image_asset='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2uoAAAAASUVORK5CYII=';
  const m=await manifest(bank);
  m[bank.bank_version].questions['2'][1]='2'.repeat(64);
  const p=await Q.validateBank(bank,m);
  assert.equal(p.trusted['1'],true);
  assert.equal(p.media['1'],'缺素材');
  assert.equal(p.media['2'],'素材未核验');
  const exam=Q.examPool(p,'2026-11-17',()=>0.5);
  assert.equal(exam.length,40);
  assert.equal(new Set(exam.map(x=>x.question_id)).size,40);
  assert(!exam.some(x=>['1','2'].includes(x.question_id)));
});
test('韩国午夜控制新版解锁，跨版本学习键分离',async()=>{
  const a=make(), b=make('2026-11-30');
  const p=await Q.validateBank(a,await manifest(a)), next=await Q.validateBank(b,await manifest(b));
  assert.notEqual(p.key,next.key);
  assert.equal(Q.koreaDay(Date.parse('2026-11-29T14:59:59Z')),'2026-11-29');
  assert.equal(Q.koreaDay(Date.parse('2026-11-29T15:00:00Z')),'2026-11-30');
  assert.throws(()=>Q.examPool(next,'2026-11-29'),/尚未生效/);
  assert.equal(Q.examPool(next,'2026-11-30').length,40);
});
test('精确多选、计时卷未答、复习优先级与到期',async()=>{
  const bank=make(), p=await Q.validateBank(bank,await manifest(bank));
  assert(Q.sameAnswer(['3','1'],['1','3']));
  assert(!Q.sameAnswer(['1'],['1','3']));
  assert(!Q.sameAnswer(['1','1'],['1','3']));
  const r=Q.result(p.bank.questions.slice(0,3),{'1':['2'],'2':['1']});
  assert.deepEqual([r.correct,r.blank,r.total],[1,1,3]);
  const now=1e12, wrong=Q.attempt(null,false,now), repeated=Q.attempt(wrong,false,now+60000);
  assert.equal(repeated.wrong,2);
  const progressed={'1':wrong,'2':repeated,'3':Q.attempt(null,true,now)};
  assert.deepEqual(Q.practicePool(p,progressed,'wrong',{},now).map(q=>q.question_id),['2','1']);
  assert.deepEqual(Q.practicePool(p,progressed,'due',{},now+70e4).map(q=>q.question_id),['2','1']);
  assert.equal(Q.attempt(Q.attempt(null,true,now),true,now+Q.DAY).due,now+4*Q.DAY);
});
