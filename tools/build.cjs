const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const json=file=>JSON.parse(read(file));
const args=process.argv.slice(2);
const next=flag=>{const i=args.indexOf(flag); return i<0?null:args[i+1];};
const output=next('--output') || path.join(root,'index.html');
const inputs=args.flatMap((v,i)=>v==='--bank'?[args[i+1]]:[]);
if(inputs.some(x=>!x||x.startsWith('--')))throw Error('--bank 后需要一个本地题库 JSON 路径');
const data={manifests:json('data/official-manifest.json'),rules:json('data/rules.json'),
  banks:inputs.map(x=>JSON.parse(fs.readFileSync(x,'utf8'))),assets:[]};
if (inputs.length && path.resolve(output)===path.join(root,'index.html')) throw Error('包含原题的私人版不能覆盖公共 index.html');
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
const js=['src/core.js','src/storage.js','src/app.js'].map(read).join('\n');
const html=read('src/template.html').replace('/*CSS*/',()=>read('src/style.css')).replace('/*DATA*/',()=>safeJson).replace('/*JS*/',()=>js);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log('离线文件：'+output+'（'+fs.statSync(output).size+' 字节）');
