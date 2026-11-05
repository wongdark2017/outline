import { fileURLToPath } from 'node:url';
import { openBrowser } from './browser-tools.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.TIKZ_FIXTURE_PATH || '/tmp/outline-tikz-acceptance-private.json','utf8'));
const b=await openBrowser();
const dir=fileURLToPath(new URL('./validation', import.meta.url));
await mkdir(dir,{recursive:true});
try {
  await b.send('Network.setCookie',{name:'accessToken',value:fixture.adminToken,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
  await b.navigate('https://127.0.0.1:4117'+fixture.documentPath+'/edit');
  await b.pause(4000);
  console.log('all-editables',await b.evaluate(`({editables:[...document.querySelectorAll('[contenteditable]')].map(e=>e.outerHTML.slice(0,2000)),classes:[...document.querySelectorAll('[role="textbox"]')].map(e=>e.outerHTML.slice(0,1500))})`));
  console.log('editor-ready',await b.evaluate(`({title:document.title,body:document.body.innerText.slice(-1600),buttons:[...document.querySelectorAll('button')].map(e=>[e.textContent,e.getAttribute('aria-label')])})`));
  console.log('dom-editors',await b.evaluate(`({pm:document.querySelector('.ProseMirror')?.outerHTML.slice(0,1200),editable:[...document.querySelectorAll('[contenteditable]')].map(e=>e.outerHTML.slice(0,300))})`));
  console.log('reader-engine-requests',b.requests.filter(r=>/tikzjax-|TikzEditor/.test(r.url)));
  await b.click('.ProseMirror[contenteditable="true"]');
  await b.key('a','KeyA',2);
  await b.send('Input.insertText',{text:'TikZ browser acceptance fixture.'});
  await b.key('End');
  await b.key('Enter');
  for (const char of '/tikz') {await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:char,text:char});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:char});await b.pause(80);}
  await b.pause(600);
  console.log('slash-menu',await b.evaluate(`document.body.innerText.slice(-1200)`));
  console.log('tikz-item-dom',await b.evaluate(`([...document.querySelectorAll('button,a,[role="option"]')].filter(e=>e.textContent==='TikZ 图表').map(e=>e.outerHTML.slice(0,1700)))`));
  await b.evaluate(`([...document.querySelectorAll('button,a,[role="option"]')].find(e=>e.textContent==='TikZ 图表')).setAttribute('data-open-tikz','true')`);
  await b.click('[data-open-tikz]');
  await b.waitFor(`document.querySelector('[role="dialog"] .cm-content')`);
  await b.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(e=>e.textContent==='保存'&&!e.disabled)`,20000);
  console.log('preview-ready',await b.evaluate(`({dialog:document.querySelector('[role="dialog"]').innerText,focus:document.activeElement.className})`));
  await b.screenshot(dir+'/01-create.png');
  await b.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent==='保存').setAttribute('data-test-save','true')`);
  await b.click('[data-test-save]');
  await b.waitFor(`!document.querySelector('[role="dialog"]')&&document.querySelector('.ProseMirror img[data-source="tikz"]')`,20000);
  console.log('saved',await b.evaluate(`({images:[...document.querySelectorAll('.ProseMirror img')].map(e=>({src:e.getAttribute('src'),source:e.dataset.source,loaded:e.complete&&e.naturalWidth>0})),body:document.body.innerText.slice(-500)})`));
  await b.pause(1200);
  await b.screenshot(dir+'/02-saved.png');
  await writeFile(dir+'/initial-browser.json',JSON.stringify({steps:['editor ready','zero reader runtime before open','slash dialog','real preview','attachment saved'],requests:b.requests.filter(r=>/tikzjax-|attachments\.|TikzEditor/.test(r.url)),errors:b.errors},null,2));
} catch(error) {
  console.log('FAILED',error.message);
  console.log('state',await b.evaluate(`({url:location.pathname,title:document.title,body:document.body.innerText.slice(-2500)})`).catch(()=>null));
  console.log('errors',b.errors);
  console.log('failed-http',b.responses.filter(r=>r.status>=400));
  await b.screenshot(dir+'/failure.png').catch(()=>{});
  process.exitCode=1;
} finally {await b.close();}
