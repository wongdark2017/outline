import { fileURLToPath } from 'node:url';
import { openBrowser } from './browser-tools.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.TIKZ_FIXTURE_PATH || '/tmp/outline-tikz-acceptance-private.json','utf8'));
const dir=fileURLToPath(new URL('./validation', import.meta.url));
const b=await openBrowser({blockExternalNetwork:true});
const report={checks:[],errors:[]};
const record=(name,detail={})=>{report.checks.push({name,status:'passed',...detail});console.log('PASS',name,JSON.stringify(detail));};
const assert=(value,message)=>{if(!value)throw Error(message);};
const saveReady=`[...document.querySelectorAll('[role="dialog"] button')].some(e=>e.textContent==='保存'&&!e.disabled)`;
const tagButton=async(label)=>{await b.evaluate(`(()=>{const e=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent===${JSON.stringify(label)});if(!e)throw Error('Missing button');e.dataset.acceptButton='target';})()`);await b.click('[data-accept-button="target"]');await b.evaluate(`document.querySelector('[data-accept-button="target"]')?.removeAttribute('data-accept-button')`);};
const source=async()=>b.evaluate(`[...document.querySelectorAll('.cm-content .cm-line')].map(e=>e.textContent).join('\\n')`);
const setSource=async(text)=>{await b.click('[role="dialog"] .cm-content');await b.key('a','KeyA',2);await b.send('Input.insertText',{text});};
const preview=()=>b.evaluate(`document.querySelector('[role="dialog"] img[alt="预览"]')?.src`);
const openExisting=async()=>{
 await b.click('.ProseMirror img[data-source="tikz"]');
 await b.waitFor(`document.querySelector('button[aria-label="编辑 TikZ"]')&&!document.querySelector('button[aria-label="编辑 TikZ"]').disabled`,2500).catch(async()=>{await b.click('.ProseMirror img[data-source="tikz"]');await b.waitFor(`document.querySelector('button[aria-label="编辑 TikZ"]')&&!document.querySelector('button[aria-label="编辑 TikZ"]').disabled`,5000)});
 const selector=await b.evaluate(`(()=>{const e=document.querySelector('[role="dialog"] button[aria-label="编辑 TikZ"]')||document.querySelector('button[aria-label="编辑 TikZ"]')||[...document.querySelectorAll('button')].find(e=>e.getAttribute('data-tooltip-content')==='编辑 TikZ');if(e){e.dataset.editTikz='true';return '[data-edit-tikz]'}return null})()`);
 if(!selector){console.log('allbuttons',await b.evaluate(`[...document.querySelectorAll('button')].slice(-22).map(e=>e.outerHTML.slice(0,600))`));throw Error('Missing Edit TikZ action')}
 await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await b.waitFor(mode==='normal'?`document.querySelector('[role="dialog"] .cm-content')`:`document.querySelector('[role="dialog"]')`);
};
let mode='normal';
b.on('Fetch.requestPaused',async event=>{
 try{
 const url=new URL(event.request.url);
 if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost'){await b.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
 if(mode==='source-fail'&&url.pathname==='/api/attachments.redirect'&&event.resourceType!=='Image'){await b.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'});return;}
 if(mode==='metadata-missing'&&url.pathname==='/api/attachments.redirect'&&event.resourceType!=='Image'){await b.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>').toString('base64')});return;}
 if(mode==='upload-fail'&&url.pathname==='/api/attachments.create'){await b.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:400,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({ok:false,error:'validation_error',message:'Acceptance upload failure'})).toString('base64')});return;}
 await b.send('Fetch.continueRequest',{requestId:event.requestId});
 }catch(error){console.log('intercept-error',error.message)}
});
try{
 await b.send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
 await b.send('Network.setCookie',{name:'accessToken',value:fixture.adminToken,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
 await b.navigate('https://127.0.0.1:4117'+fixture.documentPath+'/edit');
 await b.waitFor(`document.querySelector('.ProseMirror[contenteditable="true"] img[data-source="tikz"]')?.naturalWidth>0`);await b.pause(300);
 assert(!b.requests.some(r=>/tikzjax-|TikzEditor/.test(r.url)),'Runtime loaded before editing');
 const original=await b.evaluate(`fetch(document.querySelector('.ProseMirror img[data-source="tikz"]').src).then(r=>r.text()).then(s=>new DOMParser().parseFromString(s,'image/svg+xml').querySelector('metadata script[type="text/x-tikz"]').textContent)`);
 record('saved SVG reload and original source metadata',{sourceLength:original.length});
 await openExisting();await b.waitFor(saveReady,16000);
 assert(await source()===original,'Reopened source differs');record('reopen exact source and same-origin real worker with external page requests blocked');
 const before=await preview();
 await setSource(original+'\n% debounce revision');
 assert(!await b.evaluate(saveReady),'Save stayed enabled during debounce');assert(await preview()===before,'Preview discarded while debounce');record('save disabled immediately during debounce and previous preview retained');
 await b.waitFor(saveReady,16000);
 await setSource('\\documentclass{standalone}\n% original line 2\n\\usepackage{tikz-missing-acceptance}\n\\begin{document}\n\\begin{tikzpicture}\\draw(0,0)--(1,1);\\end{tikzpicture}\n\\end{document}');
 await b.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes('第 3 行')`,16000);
 const error=await b.evaluate(`({text:document.querySelector('[role="alert"]').innerText,height:document.querySelector('[role="alert"]').getBoundingClientRect().height,maxHeight:getComputedStyle(document.querySelector('[role="alert"]')).maxHeight})`);
 assert(error.text.includes('第 3 行：渲染引擎不支持宏包 tikz-missing-acceptance。请移除该声明或改用支持的 TikZ 库。'),'Wrong E02 fixed copy');
 assert(!await b.evaluate(saveReady),'Error save enabled');assert(await preview(),'Error lost preview');record('E02 exact Chinese copy original line raw log bounded region',error);
 await b.screenshot(dir+'/03-package-error.png');
 const loop='\\begin{tikzpicture}\n\\loop\\iftrue\\repeat\n\\end{tikzpicture}';const start=Date.now();await setSource(loop);
 await b.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes('渲染超时（10 秒）。请简化代码后重试。')`,18000);
 record('E03 real infinite-loop worker timeout and responsive dialog',{milliseconds:Date.now()-start});
 await setSource('\\begin{tikzpicture}\n\\notACommandForAcceptance\n\\end{tikzpicture}');
 await b.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes('图表编译失败。请根据下方错误信息修改代码。')`,16000);record('E01 exact Chinese compile failure and TeX details');
 const full='\\documentclass[tikz,border=7pt]{standalone}\n\\usepackage{ctex}\n\\usepackage{tikz-cd}\n\\setCJKmainfont{Noto Sans CJK SC}\n\\begin{document}\n\\begin{tikzcd}\nA \\arrow[r,"f"] \\arrow[d,"g"\'] & B \\arrow[d,"h"] \\\\\nC \\arrow[r,"k"\'] & D\n\\end{tikzcd}\n\\begin{tikzpicture}\\node {中文测试};\\end{tikzpicture}\n\\end{document}';
 await setSource(full);await b.waitFor(saveReady,16000);
 const rendered=await b.evaluate(`decodeURIComponent(document.querySelector('[role="dialog"] img[alt="预览"]').src.split(',').slice(1).join(','))`);
 const embedded=await b.evaluate(`new DOMParser().parseFromString(${JSON.stringify(rendered)},'image/svg+xml').querySelector('metadata script[type="text/x-tikz"]').textContent`);
 assert(embedded===full,'Full source not preserved');record('full standalone TikZ-CD Chinese font skip border and original metadata',{status:await b.evaluate(`document.querySelector('[role="dialog"]').innerText.slice(-450)`)});
 await b.screenshot(dir+'/04-full-document.png');
 mode='upload-fail';await tagButton('保存');await b.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes('图表保存失败。代码和预览已保留。')`,12000);
 assert(await source()===full&&await preview(),'Upload failure lost source/preview');record('E05 failed attachment save retains source preview and original document');mode='normal';
 await setSource(full+'\n% saved revision');await b.waitFor(saveReady,16000);await tagButton('保存');
 await b.waitFor(`!document.querySelector('[role="dialog"]')`);await b.pause(1300);record('edit uploaded through actual attachment API');
 await b.navigate('https://127.0.0.1:4117'+fixture.documentPath+'/edit?theme=dark');await b.waitFor(`document.querySelector('.ProseMirror[contenteditable="true"] img[data-source="tikz"]')?.naturalWidth>0`);
 const filtered=await b.evaluate(`getComputedStyle(document.querySelector('.ProseMirror img[data-source="tikz"]')).filter`);assert(filtered.includes('invert(1)'),'Dark image filter absent');
 await b.send('Emulation.setEmulatedMedia',{media:'print'});assert(await b.evaluate(`getComputedStyle(document.querySelector('.ProseMirror img[data-source="tikz"]')).filter`)==='none','Print retained dark filter');await b.screenshot(dir+'/13-print.png');const pdf=await b.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});await writeFile(dir+'/printed-document.pdf',Buffer.from(pdf.data,'base64'));await b.send('Emulation.setEmulatedMedia',{media:'screen'});record('dark screen image filter and light print PDF');
 await openExisting();await b.waitFor(saveReady,16000);
 assert((await source())===full+'\n% saved revision','Saved full source did not survive reload');
 const white=await b.evaluate(`getComputedStyle(document.querySelector('[role="dialog"] img[alt="预览"]').parentElement).backgroundColor`);assert(white==='rgb(255, 255, 255)','Dark preview not white');record('exact edited full source after save reload and white dark-mode preview');await b.screenshot(dir+'/05-dark-editor.png');
 await setSource('');await b.waitFor(`document.querySelector('[role="dialog"] [role="alert"]')?.innerText.includes('未生成有效图表。请检查代码后重试。')`,16000);record('E08 real no-output compilation exact Chinese copy');await tagButton('取消');
 report.errors=b.errors;report.cspErrors=b.errors.filter(s=>/Content Security Policy|Refused to/.test(s));assert(!report.cspErrors.length,'CSP violation');record('production CSP has no violations');
} catch(error){report.failure=error.message;console.log('FAIL',error.message);console.log('state',await b.evaluate(`({url:location.pathname,body:document.body.innerText.slice(-2200)})`).catch(()=>null));await b.screenshot(dir+'/acceptance-failure.png').catch(()=>{});process.exitCode=1;} finally{report.errors=b.errors;await writeFile(dir+'/browser-acceptance.json',JSON.stringify(report,null,2));await b.close();}
