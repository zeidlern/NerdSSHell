"""Offline DOM/Chromium regression. Uses real UI/xterm assets and synthetic IPC only.
Usage: python scripts/Offline-PerPane-UI.py /path/to/BetterSSH /path/to/evidence
Requires Playwright and Chromium. Never connects to a real SSH server or writes real files.
"""
import json, pathlib, shutil, sys, re, os
from playwright.sync_api import sync_playwright
root=pathlib.Path(sys.argv[1]).resolve()
out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
script=r'''
window.__actions=[];
const profiles=[{id:'alpha',name:'Development',host:'dev.example',port:22,username:'tester',auth:'key',sessionMode:'persistent',startup:'all',autoConnect:false,record:false},
{id:'beta',name:'Lab server',host:'lab.example',port:22,username:'tester',auth:'password',sessionMode:'standard',startup:'all',autoConnect:false,record:false}];
const panes=['alpha/project-a','alpha/project-b','alpha/logs','beta/shell'].map((key,i)=>({key,profileId:key.split('/')[0],sessionId:'$'+i,sessionToken:'synthetic-'+i,sessionName:['Project A','Project B','Server logs','Lab shell'][i],windowId:'@'+i,windowName:'Shell',windowPanes:1,paneId:'%'+i,paneIndex:0,dead:false,standard:i===3}));
const handlers=[];const handler=event=>handlers.forEach(cb=>cb(event));window.__pendingList=null;window.__pendingTransfer=null;
function result(dir){const d=dir==='~'?'/home/tester':dir;return {directory:d,parent:d==='/'?'/':d.substring(0,d.lastIndexOf('/'))||'/',entries:[{name:'projects',path:d+'/projects',kind:'directory',size:0,modified:1700000000},{name:'report.txt',path:d+'/report.txt',kind:'file',size:1400,modified:1700000000},{name:'application.log',path:d+'/application.log',kind:'file',size:120000,modified:1700000000},{name:'<b>literal-text',path:d+'/<b>literal-text',kind:'file',size:50,modified:1700000000},{name:'.hidden',path:d+'/.hidden',kind:'file',size:20,modified:1700000000}],truncated:false,skipped:0};}
function localResult(key,dir){const d=dir==='~'?'C:\\SyntheticFixture\\'+key.replace('/','-'):dir;return {directory:d,parent:d,entries:[{name:'local-report.txt',path:d+'\\local-report.txt',kind:'file',size:1400,modified:1700000000},{name:'<b>literal-local',path:d+'\\literal-local',kind:'file',size:50,modified:1700000000}],truncated:false};}
window.betterssh={
state:async()=>({profiles,workspace:{order:[],active:'',layout:4,twoPaneOrientation:'side-by-side',splitX:50,splitY:50},version:'0.1.0'}),onEvent:cb=>{handlers.push(cb);window.__emit=handler;},
connect:async id=>{const list=panes.filter(p=>p.profileId===id);handler({type:'status',profileId:id,state:'connected',detail:'Connected'});handler({type:'panes',profileId:id,panes:list});handler({type:'connected',profileId:id,panes:list});},
open:async key=>{window.__actions.push(['open',key]);const pane=panes.find(p=>p.key===key),p=profiles.find(p=>p.id===pane.profileId);handler({type:'snapshot',key,data:btoa('tester@'+p.host+':~$\r\n'+pane.sessionName+' — synthetic fixture'.replace(' — ',' / ')+'\r\n$ '),cols:90,rows:28,cursorX:2,cursorY:2,alternate:false,modes:[0,0,0,0,0,0,1]});},
listFiles:async(key,browser,dir)=>{window.__actions.push(['list',key,browser,dir]); if(dir==='/slow')return new Promise(resolve=>window.__pendingList={key,browser,resolve});return result(dir);},
cancelFileList:async(key,browser)=>window.__actions.push(['cancel-list',key,browser]),
workspace:async()=>{},resize:async(...args)=>window.__actions.push(['resize',...args]),ack:async()=>{},input:async(...args)=>window.__actions.push(['input',...args]),
close:async key=>{window.__actions.push(['close',key]);return true;},
copy:async text=>window.__actions.push(['copy',text]),browserUpload:async(key,dir,files)=>{window.__actions.push(['upload',key,dir,files===null?'dialog':files.map(f=>f.name)]);handler({type:'transfer',profileId:key.split('/')[0],key,id:'test-transfer',status:'running',name:'harmless.txt',transferred:50,total:100});return new Promise(resolve=>window.__pendingTransfer={resolve:()=>{handler({type:'transfer',profileId:key.split('/')[0],key,id:'test-transfer',status:'finished'});resolve([]);}});},
downloadFile:async(...args)=>{window.__actions.push(['download',...args]);return'/chosen/report.txt';},
localFilesList:async(key,browser,dir)=>{window.__actions.push(['local-list',key,browser,dir]);return localResult(key,dir);},localFilesChoose:async()=>null,
localFilesUpload:async(...args)=>{window.__actions.push(['local-upload',...args]);return[];},localFilesDownload:async(...args)=>{window.__actions.push(['local-download',...args]);return'C:\\SyntheticFixture\\report.txt';},
paneActions:async key=>({os:'Linux',title:'Synthetic pane '+key,actions:[],favorites:[]}),workbenchDetect:async()=>{},
workbenchContext:async()=>({targets:[]}),inputLock:async()=>{},scratchpadDirty:async()=>{},
create:async(...args)=>{window.__actions.push(['create',...args]);throw new Error('This fixture never submits New session.');},
filePaths:files=>files.map(f=>f.name),cancelTransfer:async id=>window.__actions.push(['cancel-transfer',id]),fullscreen:async()=>{},saveProfile:async()=>{},saveAppearance:async value=>value,discover:async()=>{},deleteProfile:async()=>false
};
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,chromium_sandbox=True,executable_path=os.environ.get('BETTERSSH_UI_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'))
    page=browser.new_page(viewport={'width':1920,'height':1080});errors=[];external=[]
    def choose_layout(choice):
        page.locator('[data-layout-choice="'+choice+'"]').click()
        page.wait_for_function('document.querySelectorAll(".layout-buttons [aria-pressed=true]").length===1 && document.querySelector(".layout-buttons [aria-pressed=true]").dataset.layoutChoice==='+json.dumps(choice))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:(external.append(route.request.url),route.abort()))
    # Local Chromium policy disallows navigation. Exercise the actual local DOM/assets
    # with set_content/evaluate, without changing browser policy or disabling security.
    html=(root/'ui/index.html').read_text(encoding='utf-8')
    assets=re.findall(r'<script[^>]*src="([^"]+)"[^>]*>',html)
    styles=re.findall(r'<link[^>]*href="([^"]+)"[^>]*>',html)
    html=re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    html=re.sub(r'<link[^>]*>', '', html)
    page.set_content(html)
    for name in styles:page.add_style_tag(content=(root/'ui'/name).resolve().read_text(encoding='utf-8'))
    page.evaluate('(() => {'+script+'})()')
    # Evaluate current scripts together so their top-level lexical bindings are
    # shared just as they are in the real app. No shortened/stale module list.
    code='\n;\n'.join((root/'ui'/name).resolve().read_text(encoding='utf-8') for name in assets)
    page.evaluate(code+'\nwindow.__testState=()=>({active,order});')
    page.locator('.connection').nth(0).get_by_role('button',name='Connect',exact=True).click();page.wait_for_function('document.querySelectorAll(".terminal-pane").length === 3')
    page.locator('.connection').nth(1).get_by_role('button',name='Connect',exact=True).click();page.wait_for_function('document.querySelectorAll(".terminal-pane").length === 4');page.wait_for_timeout(250)
    keys=['alpha/project-a','alpha/project-b','alpha/logs','beta/shell']
    def pane(i): return page.locator('[data-pane-key="'+keys[i]+'"]')
    def field(i,name): return pane(i).locator('[data-file="'+name+'"]')
    def nav(i,value):
        field(i,'path').fill(value);field(i,'go').click();page.wait_for_function('(arg)=>[...document.querySelectorAll(".terminal-pane")].find(p=>p.dataset.paneKey===arg[0]).querySelector("[data-file=status]").textContent.startsWith("5 items")',arg=[keys[i],value])
    for i in range(4):pane(i).locator('.pane-files-toggle').click()
    page.wait_for_function('document.querySelectorAll("[data-file=list] .file-entry").length === 16 && document.querySelectorAll("[data-local=list] .file-entry").length===8')
    assert page.locator('.file-drawer:visible').count()==4
    for i,folder in enumerate(['/srv/project-a','/srv/project-b','/var/log','/home/tester']):nav(i,folder)
    assert len(set(page.locator('.file-drawer').evaluate_all('(els)=>els.map(e=>e.id)')))==4
    assert page.locator('.file-entry b').count()==0,'untrusted filename became markup'
    # Same-host folders and filters remain independent.
    field(0,'filter').fill('report');field(1,'hidden').check()
    assert field(0,'list').locator('.file-entry').count()==1 and field(1,'list').locator('.file-entry').count()==5
    assert field(1,'filter').input_value()=='' and not field(0,'hidden').is_checked()
    field(0,'list').locator('.file-entry').click()
    a_dir=field(0,'path').input_value();b_dir=field(1,'path').input_value()
    field(0,'close').click();assert not pane(0).locator('.file-drawer').is_visible();assert pane(1).locator('.file-drawer').is_visible()
    pane(0).locator('.pane-files-toggle').click();page.wait_for_timeout(100)
    assert field(0,'path').input_value()==a_dir and field(1,'path').input_value()==b_dir
    assert field(0,'filter').input_value()=='report' and field(0,'list').locator('.file-entry.selected').count()==1
    # Download remains attached to the selected file in its own pane.
    field(0,'download').click();page.wait_for_timeout(30)
    assert ['download',keys[0],'/srv/project-a/report.txt'] in page.evaluate('window.__actions')
    # Right/below docking and independent divider sizes.
    before=[pane(i).bounding_box() for i in range(4)]
    field(2,'dock').select_option('bottom');page.wait_for_timeout(100)
    assert pane(2).locator('.pane-body').get_attribute('data-file-dock')=='bottom'
    for i in range(4):assert pane(i).bounding_box()==before[i], 'file docking changed outer pane layout'
    width_b=pane(1).locator('.file-drawer').bounding_box()['width']
    field(0,'grip').focus();field(0,'grip').press('ArrowRight');width_a=pane(0).locator('.file-drawer').bounding_box()['width']
    grip=field(0,'grip').bounding_box();page.mouse.move(grip['x']+2,grip['y']+20);page.mouse.down();page.mouse.move(grip['x']-30,grip['y']+20,steps=3);page.mouse.up();page.wait_for_timeout(150)
    assert pane(1).locator('.file-drawer').bounding_box()['width']==width_b
    assert pane(0).locator('.file-drawer').bounding_box()['width']>width_a
    # Transfer completion after collapse must not be redirected/refreshed in another pane.
    field(1,'upload').click();page.wait_for_timeout(40);field(1,'close').click();assert page.locator('#transfers').is_visible()
    assert ['upload',keys[1],'/srv/project-b','dialog'] in page.evaluate('window.__actions')
    page.evaluate('window.__pendingTransfer.resolve()');page.wait_for_timeout(60)
    assert not page.locator('#transfers').is_visible();assert field(0,'path').input_value()==a_dir
    # A pending listing from one pane is cancelled in that pane only.
    pane(1).locator('.pane-files-toggle').click();page.wait_for_timeout(40)
    field(0,'filter').fill('');field(0,'path').fill('/slow');field(0,'go').click();page.wait_for_function('window.__pendingList !== null')
    field(0,'close').click();page.evaluate('window.__pendingList.resolve({directory:"/stale",parent:"/",entries:[],truncated:false,skipped:0})');page.wait_for_timeout(40)
    assert not pane(0).locator('.file-drawer').is_visible();assert field(1,'path').input_value()==b_dir
    pane(0).locator('.pane-files-toggle').click();page.wait_for_timeout(100);assert field(0,'path').input_value()==a_dir
    # Native tab reordering carries the view and browser state.
    page.locator('#tabs .tab').nth(0).drag_to(page.locator('#tabs .tab').nth(1));page.wait_for_timeout(200)
    assert field(0,'path').input_value()==a_dir and field(1,'path').input_value()==b_dir
    assert pane(2).locator('.pane-body').get_attribute('data-file-dock')=='bottom'
    # Show four independent panes (three same-host), including one collapsed browser.
    choose_layout('4');field(3,'close').click();page.wait_for_timeout(200)
    page.locator('#notice').evaluate('(e)=>{e.hidden=true}');page.screenshot(path=str(out/'four-pane-sidecars.png'))
    # Two-pane right-sidecar layout.
    choose_layout('2-side-by-side');page.locator('#tabs .tab').nth(0).click();page.wait_for_timeout(150)
    page.screenshot(path=str(out/'two-pane-sidecars.png'))
    # Selecting the one-window layout preserves the active view and its browser.
    active_key=page.evaluate('window.__testState().active');choose_layout('1');page.wait_for_timeout(80);assert page.evaluate('window.__testState().active')==active_key
    page.locator('#layoutStacked').focus();page.locator('#layoutStacked').press('Space');page.wait_for_timeout(80)
    assert page.locator('#layoutStacked').get_attribute('aria-pressed')=='true'
    assert page.locator('.layout-buttons [aria-pressed=true]').count()==1
    assert page.evaluate('window.__testState().active')==active_key
    assert field(0,'path').input_value()==a_dir and field(1,'path').input_value()==b_dir
    # Keyboard splitter works in bottom docking.
    visible=pane(0) if pane(0).is_visible() else pane(1)
    visible.locator('[data-file=dock]').select_option('bottom');visible.locator('[data-file=grip]').focus();visible.locator('[data-file=grip]').press('ArrowUp');page.wait_for_timeout(80)
    # 900x600 four-pane fit: browsers/terminal stay inside owners, no outer overflow.
    page.set_viewport_size({'width':900,'height':600});choose_layout('4');page.wait_for_timeout(200)
    bounds=[]
    for i in range(4):
        w=pane(i).bounding_box();h=pane(i).locator('.terminal-host').bounding_box();bounds.append({'pane':w,'terminal':h})
        assert h['width']>80 and h['height']>25,(i,w,h)
        assert h['x']>=w['x'] and h['x']+h['width']<=w['x']+w['width']+1
    page.screenshot(path=str(out/'small-four-pane-sidecars.png'))
    # Per-session File SFTP controls operate on their own pane only.
    before=page.locator('.file-drawer').evaluate_all('(els)=>els.map(e=>!e.hidden)');pane(0).locator('.pane-files-toggle').click()
    after=page.locator('.file-drawer').evaluate_all('(els)=>els.map(e=>!e.hidden)');assert sum(a!=b for a,b in zip(before,after))==1
    assert before[0]!=after[0] and before[1:]==after[1:],'File SFTP toggled another owner'
    # Persistence is chosen per new session; cancelling never creates a shell.
    page.locator('.connection').nth(0).get_by_role('button',name='+ New',exact=True).click()
    assert page.locator('#newSessionPersistent').is_checked();page.locator('#newSessionPersistent').uncheck();page.locator('#cancelNewSession').click()
    assert not any(a[0]=='create' for a in page.evaluate('window.__actions'))
    page.locator('#addConnection').click();assert page.locator('input[name=sessionMode]').get_attribute('type')=='hidden'
    assert 'New session' in page.locator('#sessionModeHint').inner_text();page.locator('#cancelConnection').click()
    # On reconnect, visible browsers wait for their own backend view to be attached.
    page.evaluate("window.__emit({type:'status',profileId:'alpha',state:'disconnected',detail:'Synthetic loss'})")
    start=len(page.evaluate('window.__actions'))
    page.evaluate("window.__emit({type:'status',profileId:'alpha',state:'connected',detail:'Synthetic reconnect'})")
    page.wait_for_timeout(40)
    assert not any(a[0]=='list' for a in page.evaluate('window.__actions')[start:]), 'listing started before view reattachment'
    page.evaluate("window.betterssh.connect('alpha')");page.wait_for_timeout(150)
    actions=page.evaluate('window.__actions')[start:]
    for key in keys[:3]:
        first_open=next((i for i,a in enumerate(actions) if a[0]=='open' and a[1]==key), None)
        first_list=next((i for i,a in enumerate(actions) if a[0]=='list' and a[1]==key), None)
        assert first_open is not None
        if first_list is not None: assert first_open < first_list
    # No browsing action typed anything into any terminal.
    assert not any(a[0]=='input' for a in page.evaluate('window.__actions'))
    assert not any(a[0]=='cancel-transfer' for a in page.evaluate('window.__actions'))
    assert not errors,errors;assert not external,external
    data={'result':'PASS','scope':'real UI/xterm in offline Chromium with synthetic IPC; not Windows Electron dialogs or an installer','errors':errors,'externalRequests':external,'actions':page.evaluate('window.__actions'),'smallViewport':bounds}
    (out/'offline-ui-results.json').write_text(json.dumps(data,indent=2),encoding='utf-8');print('PASS: four independent Local/Remote sidecars; same-host navigation, cancellation, selection, transfers, docking, resizing, tab moves, dedicated layout buttons, per-session persistence and small viewport. No page errors or terminal input.');browser.close()
