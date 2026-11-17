const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {make}=require('./fixture.cjs');
const root=path.join(__dirname,'..');
const link=(file,hash='')=>pathToFileURL(path.resolve(root,file)).href+hash;
(async()=>{
  const name=process.env.QUIZ_BROWSER||'msedge';
  const browser=await (name==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:name,headless:true}));
  const errors=[];
  try{
    const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:390,height:844}});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const network=[];
    const loopback=process.env.QUIZ_PRIVATE_URL;
    page.on('request',r=>{if(/^https?:/.test(r.url())&&!(loopback&&r.url().startsWith(loopback)))network.push(r.url());});
    await page.clock.install({time:new Date('2026-11-17T10:00:00+09:00')});
    const click=action=>page.locator('[data-do="'+action+'"]').click({timeout:12000});
    const text=(part)=>page.getByText(part,{exact:false}).first().waitFor({state:'visible',timeout:12000});
    const waitMedia=async(selector,prop,limit)=>{
      const media=page.locator(selector);
      try { await media.waitFor({state:'visible',timeout:4500}); }
      catch(e){throw Error(e.message+'\n'+(await page.locator('main').innerText()).slice(0,1100)+'\n'+(await page.locator('#notice').textContent()));}
      const until=Date.now()+12000;
      do {
        const value=await media.evaluate((x,key)=>x[key],prop);
        if(value>=limit)return;
        await new Promise(r=>setTimeout(r,90));
      } while(Date.now()<until);
      throw Error('素材未能播放：'+selector+' '+(await page.locator('#notice').textContent()));
    };
    await page.goto(link('index.html'));
    await text('先添加一个题库');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('nav a[href="#rules"]').click();
    await text('无保护左转看绿灯');
    await page.locator('nav a[href="#data"]').click();
    await page.locator('#bank-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(make()))});
    await click('import');
    await text('已加载 42 道题');
    await page.locator('nav a[href="#home"]').click();
    await text('待核验题目 42 道');
    assert(await page.locator('[data-do="exam"]').isDisabled());
    await click('practice:sequence');
    await page.locator('input[data-answer][value="1"]').check();
    await click('favorite');
    await click('check');
    await text('答错了，已记入错题');
    await click('next');
    assert.equal(await page.locator('input[type=checkbox][data-answer]').count(),3);
    await page.locator('input[data-answer][value="1"]').check();
    await page.locator('input[data-answer][value="3"]').check();
    await click('check');
    await text('回答正确');
    await page.locator('nav a[href="#home"]').click();
    await click('practice:wrong');
    await text('测试占位符 1');
    await page.locator('nav a[href="#data"]').click();
    const [download]=await Promise.all([page.waitForEvent('download'),click('backup')]);
    assert(download.suggestedFilename().endsWith('.backup.json'));
    const downloadPath=await download.path();
    await page.reload();
    await text('数据管理');
    await page.locator('nav a[href="#home"]').click();
    await click('practice:favorite');
    await text('测试占位符 1');
    const destination=await browser.newContext({offline:true});
    const restore=await destination.newPage();
    restore.on('dialog',d=>d.accept());
    await restore.goto(link('index.html','#data'));
    await restore.locator('#backup-file').setInputFiles(downloadPath);
    await restore.locator('[data-do="restore"]').click();
    await restore.getByText('备份恢复成功。').waitFor();
    await restore.locator('nav a[href="#home"]').click();
    await restore.locator('[data-do="practice:favorite"]').click();
    await restore.getByText('测试占位符 1：请选择测试选项').waitFor();
    await destination.close();
    console.log('离线 '+name+'：公开版、题库导入、单选、多选、收藏、错题、持久保存、跨会话完整恢复通过');
    if(process.env.QUIZ_PRIVATE_HTML||loopback){
      if(loopback){
        assert.equal(loopback,'http://127.0.0.1:8787/');
        await page.route(/^https?:\/\//,r=>r.request().url().startsWith(loopback)?r.continue():r.abort());
        await context.setOffline(false);
      }
      await page.goto(loopback||link(process.env.QUIZ_PRIVATE_HTML),{timeout:60000});
      await page.getByText('今天练哪一组？').waitFor({timeout:55000});
      const bank=page.locator('#bank');
      await bank.selectOption({label:(await bank.locator('option').allTextContents()).find(x=>x.startsWith('2026-11-30'))});
      await text('未生效');
      assert(await page.locator('[data-do="exam"]').isDisabled());
      await bank.selectOption({label:(await bank.locator('option').allTextContents()).find(x=>x.startsWith('2026-03-09')&&x.includes('官方原件校验'))});
      await page.locator('#media').selectOption('image');
      await click('practice:sequence');
      await waitMedia('img.media','naturalWidth',1);
      await page.locator('nav a[href="#home"]').click();
      if(!process.env.QUIZ_SKIP_VIDEO_TEST){
        await page.locator('#media').selectOption('video');
        await click('practice:sequence');
        await waitMedia('video.media','readyState',1);
        await page.locator('video').evaluate(v=>{v.play().catch(()=>{});});
        await waitMedia('video.media','currentTime',0.01);
        if(loopback)assert((await page.locator('video').evaluate(v=>v.currentSrc)).startsWith(loopback+'media/'));
        await page.locator('nav a[href="#home"]').click();
      }else{
        await page.locator('#exam-video').uncheck();
      }
      await click('exam');
      await text('第 1 / 40 题');
      assert.equal(await page.getByText('公布答案：').count(),0);
      await page.locator('input[data-answer]').first().check();
      await click('next');
      await page.reload();
      await text('第 2 / 40 题');
      await page.clock.fastForward(40*60000+1000);
      await text('已到时自动交卷');
      assert.equal(await page.getByText('本次错题与未答题').count(),1);
      await page.locator('nav a[href="#home"]').click();
      await page.locator('#license').selectOption('1');
      await click('exam');
      await text('模拟考试 · 一类普通');
      page.once('dialog',d=>d.accept());
      await click('submit');
      await text('答对 0 / 40 题');
      for(const size of [{width:744,height:1133},{width:1280,height:800}]){
        await page.setViewportSize(size);
        await page.locator('nav a[href="#home"]').click();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      console.log('真实题库离线体验：图片、'+(process.env.QUIZ_SKIP_VIDEO_TEST?'无视频组卷':'视频播放')+'、新版锁定、40 题组卷、刷新续考、自动/提前交卷、三档视口通过');
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(network,[]);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
