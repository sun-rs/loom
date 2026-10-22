import {webkit} from '/Users/sun/Code/repos/rah_os/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='/Users/sun/.loom/reviews/2026-10-22-message-actions',target=JSON.parse(await readFile(root+'/target.json','utf8'));
const browser=await webkit.launch(),results=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[],mutations=[];page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/(fork|create|patch|revise|instantiate|reset|restore|manage|remove|delete|update)$/.test(new URL(r.url()).pathname))mutations.push(r.url());});
 await page.goto('http://127.0.0.1:4176/?room='+target.channel);
 const timeline=page.getByTestId('loom-message-timeline'),avatar=timeline.locator('[data-avatar-kind="agent"]').first();await avatar.waitFor();await avatar.scrollIntoViewIfNeeded();await avatar.click({button:'right'});
 const menu=page.getByRole('menu',{name:'发送者菜单',exact:true});await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),5);
 await page.screenshot({animations:'disabled',path:`${root}/sender-${width}.png`});
 await menu.getByRole('menuitem',{name:'Fork · 分叉为新成员',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'创建 Fork',exact:true}).waitFor();
 await page.screenshot({animations:'disabled',path:`${root}/fork-${width}.png`});
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});
 if(width===1440){const more=timeline.getByRole('button',{name:'更多消息操作',exact:true}).first();await more.focus();await more.press('Enter');const messageMenu=page.getByRole('menu',{name:'消息菜单',exact:true});await messageMenu.waitFor();await page.screenshot({animations:'disabled',path:`${root}/more-${width}.png`});await page.keyboard.press('Escape');await messageMenu.waitFor({state:'hidden'});}
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);results.push({width,senderFiveEntries:true,forkConfirmCancelled:true,keyboardMore:width===1440,noBusinessWrites:true});await context.close();
}}finally{await browser.close();}
await writeFile(root+'/formal.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
