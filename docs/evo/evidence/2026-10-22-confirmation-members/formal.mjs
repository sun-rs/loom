import {webkit} from '/Users/sun/Code/repos/rah_os/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='/Users/sun/.loom/reviews/2026-10-22-confirmation-members';
const browser=await webkit.launch(), results=[];
try {for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390}), page=await context.newPage(),errors=[],mutations=[];
 page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/\/(revise|create|instantiate|reset|restore|manage|remove|delete)$/.test(new URL(r.url()).pathname))mutations.push(r.url());});
 await page.goto('http://127.0.0.1:4176/?view=computers');
 if(width===390)await page.getByTestId('computer-mobile-row').click();
 const list=page.getByTestId('computer-instances'),rows=list.getByTestId('computer-instance-row');
 await rows.first().waitFor();assert.ok(await rows.count()<=6);
 const expand=list.getByRole('button',{name:/展开全部 .* 个实例/});
 let expanded=false;
 if(await expand.count()){
  const group=await expand.evaluate(el=>{let p=el.parentElement;while(p){if(p.querySelector('[data-testid="computer-instance-row"]'))return getComputedStyle(p).borderTopWidth; p=p.parentElement;}return null;});
  assert.ok(group&&parseFloat(group)>0,'toggle and rows share border');
  await expand.click();assert.ok(await rows.count()>6);expanded=true;
  await list.getByRole('button',{name:'收起',exact:true}).click();
 }
 await list.getByRole('button',{name:'选择',exact:true}).click();await rows.first().click();
 await list.getByRole('button',{name:'重启／重置',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'重启／重置所选实例',exact:true}).waitFor();
 const cancel=dialog.getByRole('button',{name:'取消',exact:true});
 await page.screenshot({path:`${root}/confirmation-${width}.png`});
 await cancel.click();await dialog.waitFor({state:'hidden'});
 await list.getByRole('button',{name:'取消',exact:true}).click();
 await page.screenshot({path:`${root}/computer-${width}.png`});
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 results.push({width,realService:true,expanded,confirmationCancelled:true,noMutations:true,noPageErrors:true,noOverflow:true});await context.close();
}await writeFile(root+'/formal.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
