import { chromium } from 'playwright';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
(async()=>{
  const b=await chromium.launch({channel:'chrome'}).catch(()=>chromium.launch());
  const p=await (await b.newContext({userAgent:UA})).newPage();
  await p.goto('https://bid.memorylaneinc.com/Lots/Gallery',{waitUntil:'domcontentloaded',timeout:45000});
  for(let i=0;i<20;i++){ await p.waitForTimeout(1000); if(await p.locator('select[name*="Auction"]').count()) break; }
  await p.selectOption('select[name*="Auction"]','162');
  for(let i=0;i<18;i++){ await p.waitForTimeout(1000); if((await p.locator('[id^=tcb_], .item, .lot').count())>10) break; }
  const info = await p.evaluate(()=>{
    const txt=(document.body.innerText||'');
    const pagerish=Array.from(document.querySelectorAll('a')).filter(a=>/next|»|>|\d+$/i.test((a.textContent||'').trim()) && (a.getAttribute('href')||'').includes('__doPostBack')).slice(0,15).map(a=>({t:(a.textContent||'').trim().slice(0,12),href:(a.getAttribute('href')||'').slice(0,70)}));
    const counts=(txt.match(/(\d[\d,]*)\s*(items|lots|results)/gi)||[]).slice(0,5);
    const sel=Array.from(document.querySelectorAll('select')).map(s=>({name:s.getAttribute('name')||'',opts:s.options.length,val:(s as any).value}));
    return {pagerish,counts,sel,cards:document.querySelectorAll('[id^=tcb_]').length};
  });
  console.log(JSON.stringify(info,null,1));
  await b.close();
})();
