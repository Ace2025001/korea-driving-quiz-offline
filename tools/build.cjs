const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const json=file=>JSON.parse(read(file));
const args=process.argv.slice(2);
const next=flag=>{const i=args.indexOf(flag); return i<0?null:args[i+1];};
const output=next('--output') || path.join(root,'index.html');
const inputs=args.flatMap((v,i)=>v==='--bank'?[args[i+1]]:[]);
const translationPath=next('--translations');
if(inputs.some(x=>!x||x.startsWith('--')))throw Error('--bank 后需要一个本地题库 JSON 路径');
const data={manifests:json('data/official-manifest.json'),rules:json('data/rules.json'),coaching:json('data/coaching.json'),
  explanationNotes:json('data/explanation-notes.json'),
  banks:inputs.map(x=>JSON.parse(fs.readFileSync(x,'utf8'))),assets:[],translations:{}};
if ((inputs.length||translationPath) && path.resolve(output)===path.join(root,'index.html')) throw Error('私人题库和译文不能写入公共 index.html');
if(args.includes('--translations')&&(!translationPath||translationPath.startsWith('--')))throw Error('--translations 后需要一个本地译文 JSON 路径');
if(translationPath){
  if(!data.banks.length)throw Error('译文必须和对应的私人题库一起打包');
  const bundle=JSON.parse(fs.readFileSync(translationPath,'utf8'));
  if(bundle.format!=='kr-coaching-translation-v1'||!bundle.banks)throw Error('中文译文格式不对');
  const hand=new Set(data.coaching.flatMap(c=>c.order));
  for(const bank of data.banks){
    const version=bank.bank_version, known=data.manifests[version], copy=bundle.banks[version];
    if(!known||!copy||known.attachment_sha256!==bank.attachment_sha256)throw Error(version+'：缺少对应版本的中文译文');
    const required=bank.questions.filter(q=>!hand.has(q.question_id)&&known.ordinary_ranges.some(([a,b])=>+q.question_id>=a&&+q.question_id<=b));
    const lesson={};
    for(const q of required){
      const id=q.question_id,row=copy[id];
      if(row?.fingerprint!==known.questions[id]?.[0]||!['ko','none'].includes(row.source)||
        !Array.isArray(row.translated)||!Array.isArray(row.checks)||!Array.isArray(row.check_segments)||
        !row.translated.every(pair=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&typeof pair[1]==='string')||
        !row.check_segments.every(index=>Number.isInteger(index)&&index>=0&&index<row.translated.length)||
        (row.source==='ko'&&!row.translated.some(([,s])=>s.trim()))||(row.source==='none'&&(known.questions[id]?.[2]||!data.explanationNotes[id]?.why)))
        throw Error(version+' 第 '+id+' 题：译文缺失或与该卷不匹配');
      lesson[id]=row;
    }
    data.translations[version]=lesson;
    console.log(version+'：'+Object.keys(lesson).length+' 题加入私人中文讲解');
  }
}
// 同一视频和未变更图片只写入私人 HTML 一次。
const refs=new Map();
for(const bank of data.banks)for(const q of bank.questions)for(const field of ['image_asset','video_asset']){
  if(field==='video_asset'&&args.includes('--no-videos')){q[field]=null;continue;}
  const asset=q[field];
  if(!asset)continue;
  if(!refs.has(asset)){refs.set(asset,data.assets.length);data.assets.push(asset);}
  q[field]=refs.get(asset);
}
const safeJson=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const js=['src/core.js','src/coach.js','src/explain.js','src/storage.js','src/app.js'].map(read).join('\n');
const html=read('src/template.html').replace('/*CSS*/',()=>read('src/style.css')).replace('/*DATA*/',()=>safeJson).replace('/*JS*/',()=>js);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log('离线文件：'+output+'（'+fs.statSync(output).size+' 字节）');
