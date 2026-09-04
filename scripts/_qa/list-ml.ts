import { chromium } from 'playwright';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
(async()=>{
  const b=await chromium.launch({channel:'chrome'}).catch(()=>chromium.launch());
  const ctx=await b.newContext({userAgent:UA}); const p=await ctx.newPage();
  await p.goto('https://bid.memorylaneinc.com/Lots/Gallery',{waitUntil:'domcontentloaded',timeout:45000});
  for(let i=0;i<20;i++){ await p.waitForTimeout(1000); if(await p.locator('select[name*="Auction"]').count()) break; }
  const opts=await p.$$eval('select[name*="Auction"] option',(os:any[])=>os.map(o=>({v:o.value,t:(o.textContent||'').trim()})));
  console.log(JSON.stringify(opts,null,0));
  await b.close();
})();
