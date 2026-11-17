/* 浏览器与 Node 共用的题库校验和学习逻辑。 */
const Quiz = (() => {
  'use strict';
  const DAY = 86400000;
  const EXAM_LENGTH = 40;
  const EXAM_MS = 40 * 60000;
  const MAX_FILE = 300 * 1024 * 1024;
  const own = (obj, key) => Object.hasOwn(obj, key);
  const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const str = (v, max = 4000) => typeof v === 'string' && v.length <= max && !!v.trim();
  const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(x) && !own(Object.prototype,x) && x!=='prototype';
  const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
  function date(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(+d) && d.toISOString().slice(0,10) === v;
  }
  function koreaDay(now = Date.now()) {
    return new Date(now + 9 * 3600000).toISOString().slice(0,10);
  }
  function https(value) {
    try { const u = new URL(value); return str(value, 2048) && u.protocol === 'https:' && !u.username && !u.password; }
    catch { return false; }
  }
  const require = (ok, msg) => { if (!ok) throw Error(msg); };
  const uniq = xs => new Set(xs).size === xs.length;
  const tags = x => Array.isArray(x) && x.length <= 24 && x.every(t => str(t, 80)) && uniq(x);
  const encode = x => new TextEncoder().encode(x);
  async function sha(bytes) {
    if (globalThis.crypto?.subtle) {
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
    }
    // 本地文件的 WebView 可能没有 SubtleCrypto。仅用于校验公开指纹。
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Int32Array(64), rot = (n,r) => n >>> r | n << (32-r);
    const end = Math.ceil((bytes.length + 9)/64)*64;
    const size = bytes.length * 8;
    for (let i=0; i<end; i+=64) {
      for (let j=0; j<16; j++) {
        let n=0;
        for(let b=0;b<4;b++) {
          const p=i+j*4+b;
          n = n<<8 | (p<bytes.length ? bytes[p] : p===bytes.length ? 128 : p>=end-8 ? Math.floor(size / 256**(end-1-p)) & 255 : 0);
        }
        w[j]=n;
      }
      for(let j=16;j<64;j++) {
        const a=w[j-15], b=w[j-2];
        w[j]=w[j-16]+(rot(a,7)^rot(a,18)^(a>>>3))+w[j-7]+(rot(b,17)^rot(b,19)^(b>>>10));
      }
      let [a,b,c,d,e,f,g,h]=H;
      for(let j=0;j<64;j++){
        const t=(h+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+K[j]+w[j])|0;
        const u=((rot(a,2)^rot(a,13)^rot(a,22))+((a&b)^(a&c)^(b&c)))|0;
        [a,b,c,d,e,f,g,h]=[(t+u)|0,a,b,c,(d+t)|0,e,f,g];
      }
      [a,b,c,d,e,f,g,h].forEach((n,j)=>H[j]=(H[j]+n)|0);
    }
    return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
  }
  const digest = x => sha(encode(JSON.stringify(x)));
  function base64(value){
    if(Uint8Array.fromBase64)return Uint8Array.fromBase64(value);
    const raw=atob(value), bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
  const core = q => [q.question_id,q.question_type,q.prompt_zh,q.options.map(o=>[o.id,o.text]),q.correct_answers,q.evidence?.page ?? null,q.media_kind];
  function decodeAsset(asset, kind) {
    const m = /^data:(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset);
    require(m && m[1].startsWith(kind+'/') && m[2].length%4===0,'素材必须是内嵌的 PNG/JPEG/WebP 图片或 MP4/WebM 视频');
    const blob = base64(m[2]);
    const sig = String.fromCharCode(...blob.slice(0,12));
    const ok = m[1]==='image/png' ? sig.startsWith('\x89PNG\r\n\x1a\n') :
      m[1]==='image/jpeg' ? sig.startsWith('\xff\xd8\xff') :
      m[1]==='image/webp' ? sig.startsWith('RIFF')&&sig.endsWith('WEBP') :
      m[1]==='video/mp4' ? sig.slice(4,8)==='ftyp' : sig.startsWith('\x1a\x45\xdf\xa3');
    require(ok,'素材声明格式与文件内容不符');
    return blob;
  }
  async function validateBank(input, manifests = {}) {
    require(record(input) && input.schema_version==='1.0','题库格式版本必须为 1.0');
    require(id(input.bank_version) && date(input.effective_date),'题库版本或生效日期无效');
    require(input.source_url==='' || https(input.source_url),'来源地址必须是 HTTPS');
    require(Array.isArray(input.questions) && integer(input.questions.length,1,5000),'题库必须含 1–5000 道题');
    require(input.attachment_sha256==null || hex(input.attachment_sha256),'原件 SHA-256 无效');
    const manifest = own(manifests,input.bank_version) ? manifests[input.bank_version] : null;
    const matchedSource = manifest && input.effective_date===manifest.effective_date &&
      input.attachment_sha256===manifest.attachment_sha256 && input.source_url===manifest.source_url;
    const questions=[], seen=new Set(), trusted=Object.create(null), ready=Object.create(null), media=Object.create(null);
    for (const [i,item] of input.questions.entries()) {
      const f = (ok,msg) => require(ok,'第 '+(i+1)+' 条：'+msg);
      f(record(item)&&id(item.question_id)&&!seen.has(item.question_id),'题号无效或重复');
      seen.add(item.question_id);
      const q={question_id:item.question_id,question_type:item.question_type,prompt_zh:item.prompt_zh};
      f(['single','multiple'].includes(item.question_type)&&str(item.prompt_zh,8000),'题型或题干无效');
      f(Array.isArray(item.options)&&integer(item.options.length,2,10)&&item.options.every(o=>record(o)&&id(o.id)&&str(o.text,4000))&&uniq(item.options.map(o=>o.id)),'选项内容或编号无效');
      q.options=item.options.map(o=>({id:o.id,text:o.text}));
      f(Array.isArray(item.correct_answers)&&uniq(item.correct_answers)&&item.correct_answers.every(a=>q.options.some(o=>o.id===a)),'答案重复或引用了不存在的选项');
      f(item.question_type==='single'?item.correct_answers.length===1:item.correct_answers.length>=2,'答案数与题型不一致');
      q.correct_answers=q.options.filter(o=>item.correct_answers.includes(o.id)).map(o=>o.id);
      f(item.points===null || integer(item.points,1,100),'分值只能是空值或 1–100 的整数');
      q.points=item.points;
      f(['none','image','video'].includes(item.media_kind),'必须声明素材类型');
      q.media_kind=item.media_kind;
      f((item.image_asset===null || (q.media_kind==='image'&&typeof item.image_asset==='string')) &&
          (item.video_asset===null || (q.media_kind==='video'&&typeof item.video_asset==='string')),'素材与声明类型不符');
      q.image_asset=item.image_asset;
      q.video_asset=item.video_asset;
      f(Array.isArray(item.legal_refs)&&item.legal_refs.length<=12&&item.legal_refs.every(x=>record(x)&&str(x.label,300)&&https(x.url)),'法规引用无效');
      q.legal_refs=item.legal_refs.map(x=>({label:x.label,url:x.url}));
      f(tags(item.trap_tags)&&tags(item.topics),'专题或易错标签无效');
      q.trap_tags=item.trap_tags; q.topics=item.topics;
      f(typeof item.explanation_zh==='string'&&item.explanation_zh.length<=8000,'解析格式无效');
      q.explanation_zh=item.explanation_zh;
      f(['verified','pending'].includes(item.verification_status),'申报的核验状态无效');
      f(['unverified','personal_only','redistributable'].includes(item.copyright_status),'版权状态无效');
      q.verification_status=item.verification_status; q.copyright_status=item.copyright_status;
      f(item.evidence==null || (record(item.evidence)&&integer(item.evidence.page,1,10000)&&str(item.evidence.method,300)),'证据页码或方法无效');
      q.evidence=item.evidence ? {page:item.evidence.page,method:item.evidence.method} : null;
      if(item.official_explanation_ko!=null){
        f(str(item.official_explanation_ko,8000)&&integer(item.evidence?.ko_page,1,10000),'韩文解析的内容或页码无效');
        q.official_explanation_ko=item.official_explanation_ko;
        q.evidence.ko_page=item.evidence.ko_page;
      }
      const asset = item.image_asset || item.video_asset;
      let assetHash = null;
      if (asset !== null) {
        try { assetHash=await sha(decodeAsset(asset,q.media_kind)); }
        catch (e) { f(false,e.message); }
      }
      const hash=await digest(core(q));
      const m=matchedSource&&manifest.questions[q.question_id];
      trusted[q.question_id]=!!m && m[0]===hash;
      if(q.official_explanation_ko && (!trusted[q.question_id] ||
        m[2]!==await digest([q.official_explanation_ko,q.evidence.ko_page]))){
        delete q.official_explanation_ko;
        delete q.evidence.ko_page;
      }
      media[q.question_id]=q.media_kind==='none'?'无素材':!assetHash?'缺素材':
        trusted[q.question_id] && m[1]===assetHash ? '素材已核验':'素材未核验';
      ready[q.question_id]=trusted[q.question_id] && (q.media_kind==='none'||media[q.question_id]==='素材已核验');
      questions.push(q);
    }
    const bank={schema_version:'1.0',bank_version:input.bank_version,effective_date:input.effective_date,source_url:input.source_url,attachment_sha256:input.attachment_sha256??null,questions};
    // 未知题库的每次内容修改都是独立题库。已知题库只在所有题号与文字受信时按原件身份合并。
    const entirelyTrusted=matchedSource&&questions.every(q=>trusted[q.question_id]);
    const key=bank.bank_version+'@'+(entirelyTrusted ? bank.attachment_sha256 : await digest(bank));
    return {bank,key,trusted,ready,media,manifest:entirelyTrusted?manifest:null};
  }
  function sameAnswer(answer,correct) {
    return Array.isArray(answer)&&answer.length===correct.length&&uniq(answer)&&correct.every(id=>answer.includes(id));
  }
  function shuffled(xs,rng=Math.random) {
    const ys=[...xs];
    for(let i=ys.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [ys[i],ys[j]]=[ys[j],ys[i]]; }
    return ys;
  }
  const initial = () => ({attempts:0,correct:0,wrong:0,streak:0,last:0,due:0,favorite:false});
  function attempt(previous, correct, now=Date.now()) {
    const old=previous||initial();
    const streak=correct ? old.streak+1 : 0;
    const gap=correct ? [1,3,7,14,30,60][Math.min(streak-1,5)]*DAY : 10*60000;
    return {...old,attempts:old.attempts+1,correct:old.correct+Number(correct),
      wrong:old.wrong+Number(!correct),streak,last:now,due:now+gap};
  }
  function practicePool(pack, progress, mode, filter={}, now=Date.now()) {
    const r=q=>progress[q.question_id]||initial();
    let qs=pack.bank.questions.filter(q=>(filter.topic==null||q.topics.includes(filter.topic))&&
      (filter.trap==null||q.trap_tags.includes(filter.trap))&&
      (filter.media==null||q.media_kind===filter.media)&&
      (filter.audit==='all'||(filter.audit==='pending'?!pack.trusted[q.question_id]:pack.trusted[q.question_id]))&&
      (filter.incomplete||q.media_kind==='none'||q.image_asset||q.video_asset));
    const priority=(a,b)=>r(b).wrong-r(a).wrong||r(a).due-r(b).due;
    if(mode==='wrong') qs=qs.filter(q=>r(q).wrong).sort(priority);
    if(mode==='due') qs=qs.filter(q=>r(q).attempts&&r(q).due<=now).sort(priority);
    if(mode==='favorite') qs=qs.filter(q=>r(q).favorite);
    if(mode==='random') qs=shuffled(qs);
    if(mode==='intensive') qs=qs.filter(q=>r(q).wrong || q.trap_tags.length || r(q).attempts&&r(q).due<=now).sort(priority).slice(0,40);
    return qs;
  }
  function examPool(pack, day=koreaDay(), rng=Math.random) {
    require(pack.manifest,'模拟考试需要整份导入内容通过官方原件指纹比对');
    require(pack.bank.effective_date<=day,'这个版本尚未生效，只能预习');
    const scope = pack.manifest.ordinary_ranges;
    const eligible=pack.bank.questions.filter(q=>pack.ready[q.question_id]&&scope.some(([a,b])=>+q.question_id>=a&&+q.question_id<=b));
    const videos=eligible.filter(q=>q.media_kind==='video');
    const rest=eligible.filter(q=>q.media_kind!=='video');
    const selected=shuffled(rest,rng).slice(0,EXAM_LENGTH-Number(!!videos.length));
    if(videos.length) selected.push(shuffled(videos,rng)[0]);
    require(selected.length===EXAM_LENGTH,'本版通过核验且素材齐全的普通驾照题不足 40 道');
    return shuffled(selected,rng);
  }
  function result(questions,answers) {
    const rows=questions.map(q=>{
      const selected=answers[q.question_id]||[];
      return {id:q.question_id,selected,correct:sameAnswer(selected,q.correct_answers),blank:!selected.length};
    });
    return {rows,total:rows.length,correct:rows.filter(r=>r.correct).length,blank:rows.filter(r=>r.blank).length};
  }
  function validStat(x) {
    return record(x)&&['attempts','correct','wrong','streak','last','due'].every(k=>integer(x[k],0,Number.MAX_SAFE_INTEGER))&&
      x.attempts===x.correct+x.wrong&&x.streak<=x.correct&&typeof x.favorite==='boolean';
  }
  return {DAY,EXAM_LENGTH,EXAM_MS,MAX_FILE,validateBank,date,koreaDay,core,sha,digest,base64,sameAnswer,shuffled,initial,attempt,practicePool,examPool,result,validStat,own};
})();
if (typeof module !== 'undefined') module.exports = Quiz;
