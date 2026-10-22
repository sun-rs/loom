import {webkit} from '/Users/sun/Code/repos/rah_os/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='/Users/sun/.loom/reviews/2026-10-22-preferences-sender',target=JSON.parse(await readFile(root+'/target.json','utf8'));
const browser=await webkit.launch(),results=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390}),page=await context.newPage(),errors=[],mutations=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/(patch|revise|create|instantiate|reset|restore|manage|remove|delete|update)$/.test(new URL(r.url()).pathname))mutations.push(r.url());});
 await page.goto('http://127.0.0.1:4176/?room='+target.channel);
 await page.getByTestId('loom-channel-control-trigger').click();
 const sheet=page.getByTestId('loom-channel-control-sheet');
 const pin=sheet.getByTestId('channel-settings-pin-switch');await pin.waitFor();await pin.scrollIntoViewIfNeeded();assert.equal(await pin.isEnabled(),true);
 assert.equal(await sheet.getByTestId('channel-overflow-mute-switch').isEnabled(),true);
 await page.screenshot({animations:'disabled',path:`${root}/preferences-${width}.png`});
 await sheet.getByRole('button',{name:'取消',exact:true}).click();await sheet.waitFor({state:'hidden'});
 const avatar=page.getByTestId('loom-message-timeline').locator('[data-avatar-kind]').first();await avatar.waitFor();await avatar.scrollIntoViewIfNeeded();await avatar.focus();await avatar.click({button:'right'});
 const menu=page.getByRole('menu',{name:'发送者菜单',exact:true});await menu.waitFor();await menu.getByText('复制名称',{exact:true}).waitFor();
 await page.screenshot({animations:'disabled',path:`${root}/sender-${width}.png`});await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);results.push({width,preferences:true,avatarMenu:true,escape:true,noBusinessWrites:true});await context.close();
}}finally{await browser.close();}
await writeFile(root+'/formal.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
