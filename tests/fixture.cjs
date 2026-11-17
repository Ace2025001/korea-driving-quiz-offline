const Q = require('../src/core.js');
const make=(version='2026-03-09',size=42)=>({
  schema_version:'1.0',bank_version:version,effective_date:version,source_url:'https://example.test/fixture',
  attachment_sha256:'1'.repeat(64),questions:Array.from({length:size},(_,i)=>({
    question_id:String(i+1),question_type:i===1?'multiple':'single',prompt_zh:'测试占位符 '+(i+1)+'：请选择测试选项',
    options:[{id:'1',text:'甲'},{id:'2',text:'乙'},{id:'3',text:'丙'}],correct_answers:i===1?['1','3']:['2'],
    points:null,media_kind:'none',image_asset:null,video_asset:null,legal_refs:[],trap_tags:i===1?['测试标签']:[],
    topics:['测试专题'],explanation_zh:'仅用于软件测试，非交通考题。',verification_status:'verified',
    copyright_status:'redistributable',evidence:{page:1,method:'模拟核验，仅用于单元测试'}
  }))
});
async function manifest(bank){
  return {[bank.bank_version]:{source_url:bank.source_url,attachment_sha256:bank.attachment_sha256,
    effective_date:bank.effective_date,ordinary_ranges:[[1,bank.questions.length]],
    questions:Object.fromEntries(await Promise.all(bank.questions.map(async q=>[q.question_id,[await Q.digest(Q.core(q)),null]])))}};
}
module.exports={make,manifest};
