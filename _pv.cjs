const { chromium } = require('playwright');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
(async()=>{const b=await chromium.launch();
 for (const [n,path,w,h,d] of [['home',  '/',1440,900,2],['art','/art',1440,900,2],['home-mob','/',390,844,3]]) {
  const ctx=await b.newContext({userAgent:UA,viewport:{width:w,height:h},deviceScaleFactor:d});
  const pg=await ctx.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(String(e).slice(0,70)));
  pg.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,70));});
  await pg.goto('https://lectr.bid'+path,{waitUntil:'networkidle',timeout:60000});
  await pg.waitForTimeout(3500);
  const r=await pg.evaluate(()=>({
    tapeRows:document.querySelectorAll('[class*=mtRow]').length,
    oldChart:document.querySelectorAll('[class*=layerChip]').length,
    beams:document.querySelectorAll('[class*=mtStage] [class*=beamMini]').length,
    kicker:document.querySelector('[class*=sectionKicker]')?.textContent}));
  console.log(n,JSON.stringify(r),'| errors:',errs.length,errs.slice(0,2));
  await ctx.close();
 } await b.close();})();
