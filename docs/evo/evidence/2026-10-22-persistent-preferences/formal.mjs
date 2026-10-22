import {webkit} from '/Users/sun/Code/repos/rah_os/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='/Users/sun/.loom/reviews/2026-10-22-persistent-preferences',target=JSON.parse(await readFile(root+'/target.json','utf8'));
const browser=await webkit.launch(),results=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[],mutations=[];page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/(patch|revise|create|instantiate|reset|restore|manage|remove|delete|update)$/.test(new URL(r.url()).pathname))mutations.push(r.url());});
 await page.goto('http://127.0.0.1:4176/?room='+target.channel);await page.getByTestId('loom-channel-control-trigger').click();
 const sheet=page.getByTestId('loom-channel-control-sheet'),collapse=sheet.getByTestId('channel-settings-collapse-switch');await collapse.waitFor();await collapse.scrollIntoViewIfNeeded();assert.equal(await collapse.isEnabled(),true);
 await page.screenshot({animations:'disabled',path:`${root}/collapse-${width}.png`});await sheet.getByRole('button',{name:'取消',exact:true}).click();
 await page.goto('http://127.0.0.1:4176/?view=settings&settings=notifications');
 const mute=page.getByRole('checkbox',{name:/静音此服务器/});await mute.waitFor();await mute.scrollIntoViewIfNeeded();assert.equal(await mute.isEnabled(),true);
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
 await page.screenshot({animations:'disabled',path:`${root}/mute-${width}.png`});assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);results.push({width,collapseControl:true,workspaceMuteNativeForm:true,unchangedSaveDisabled:true,noBusinessWrites:true});await context.close();
}}finally{await browser.close();}
await writeFile(root+'/formal.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
