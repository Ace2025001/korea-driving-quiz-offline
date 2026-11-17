const QuizStore = (() => {
  const NAME='kr-driving-quiz-1', STATE=NAME+'-study', BANKS=NAME+'-banks';
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  async function connect() {
    try {
      const db=await new Promise((resolve,reject)=>{
        const open=indexedDB.open(NAME,1);
        const timer=setTimeout(()=>reject(Error('本地数据库打开超时')),2500);
        open.onupgradeneeded=()=>{open.result.createObjectStore('banks');open.result.createObjectStore('state');};
        open.onsuccess=()=>{clearTimeout(timer);resolve(open.result);};
        open.onerror=()=>{clearTimeout(timer);reject(open.error);};
      });
      const tx=(stores,mode,fn)=>{
        const t=db.transaction(stores,mode);
        return new Promise((resolve,reject)=>{
          t.oncomplete=()=>resolve(); t.onabort=()=>reject(t.error||Error('写入中断')); t.onerror=()=>reject(t.error);
          try { fn(t); } catch(e){t.abort();reject(e);}
        });
      };
      await tx('state','readwrite',t=>t.objectStore('state').put(1,'probe'));
      return {label:'IndexedDB',
        load:async()=>({banks:await request(db.transaction('banks').objectStore('banks').getAll()),
          study:await request(db.transaction('state').objectStore('state').get('study'))}),
        bank:(key,bank)=>tx('banks','readwrite',t=>t.objectStore('banks').put(bank,key)),
        study:study=>tx('state','readwrite',t=>t.objectStore('state').put(study,'study')),
        restore:(packs,study)=>tx(['state','banks'],'readwrite',t=>{
          const b=t.objectStore('banks');b.clear();packs.forEach(p=>b.put(p.bank,p.key));
          t.objectStore('state').put(study,'study');
        })
      };
    } catch {
      let storage;
      try { storage=localStorage;storage.setItem(NAME+'-probe','1');storage.removeItem(NAME+'-probe'); } catch { storage=null; }
      if (!storage) return {label:'仅本次打开',load:async()=>({banks:[]}),bank:async()=>{},study:async()=>{},restore:async()=>{}};
      const get=(key,fallback)=>JSON.parse(storage.getItem(key)||fallback);
      const set=(key,value)=>storage.setItem(key,JSON.stringify(value));
      // 完整恢复只改一个键，避免写入两份数据时留下半份备份。
      const base=()=>get(BANKS,'{"banks":[],"revision":null}');
      return {label:'localStorage',
        load:async()=>{const b=base(),s=get(STATE,'null');return {banks:b.banks.map(([,value])=>value),study:s&&s.revision===b.revision?s.study:b.study};},
        bank:async(key,bank)=>{const b=base(),m=new Map(b.banks);m.set(key,bank);set(BANKS,{...b,banks:[...m]});},
        study:async study=>set(STATE,{study,revision:base().revision}),
        restore:async(packs,study)=>set(BANKS,{banks:packs.map(p=>[p.key,p.bank]),study,revision:String(Date.now())+'-'+Math.random()})};
    }
  }
  return {connect};
})();
