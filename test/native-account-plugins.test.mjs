import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,rm,readlink,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {once} from 'node:events'
import {apply as applyX,authorize as authorizeX,nativeAccount} from '../plugins/x/src/index.mjs'
import {apply as applyGoogle,authorize as authorizeGoogle,inspectAccount,desktopClient} from '../plugins/google-workspace/src/index.mjs'
import {interactive,relayRedirect,validateRedirect,nativeDirectory} from '../plugins/x/src/native-cli.mjs'

async function fixture(t){
 const directory=await mkdtemp(path.join(tmpdir(),'go-bot-native-auth-'))
 const previous={...process.env}
 process.env.HOME=path.join(directory,'home');process.env.DSH_HOME=path.join(directory,'data')
 await mkdir(process.env.HOME,{recursive:true});await mkdir(path.join(directory,'bin'))
 process.env.PATH=path.join(directory,'bin')+path.delimiter+process.env.PATH
 t.after(async()=>{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await rm(directory,{recursive:true,force:true})})
 return {directory,async binary(name,source){await writeFile(path.join(directory,'bin',name),'#!'+process.execPath+'\n'+source,{mode:0o755})}}
}
const fakeX=`
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),file=path.join(process.env.HOME,'.xurl','auth.yml');
if(args[0]==='--version'){console.log('xurl test');process.exit(0)}
if(args[1]==='oauth2'){
 if(process.env.CLIENT_ID!=='project-x-client'||process.env.CLIENT_SECRET!==(process.env.X_TEST_EXPECTED_SECRET||''))process.exit(3);
 const url='https://x.com/i/oauth2/authorize?client_id=project-x-client&redirect_uri='+encodeURIComponent('http://localhost:8080/callback')+'&state=attempt-state&code_challenge=test';
 process.stderr.write(url.slice(0,75));setTimeout(()=>process.stderr.write(url.slice(75)+'\\n'),10);
 let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>{
 const value=new URL(input.trim());if(value.searchParams.get('code')!=='accepted'||value.searchParams.get('state')!=='attempt-state')process.exit(4);
 fs.writeFileSync(file,JSON.stringify({default_app:'default',apps:{default:{client_id:process.env.CLIENT_ID,client_secret:process.env.CLIENT_SECRET,default_user:'alice',oauth2_tokens:{alice:{oauth2:{access_token:'private-access',refresh_token:'private-refresh',expiration_time:1}}}}}}),{mode:0o600});
 });
}else if(args[1]==='clear'){
 if(args.at(-2)!=='--oauth2-username')process.exit(5);
 const json=JSON.parse(fs.readFileSync(file));delete json.apps.default.oauth2_tokens[args.at(-1)];fs.writeFileSync(file,JSON.stringify(json));
}else if(args[1]==='status'){console.log('X status')}
`
const fakeGoogle=`
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');const args=process.argv.slice(2),root=process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR||path.join(process.env.HOME,'.config','gws'),file=path.join(root,'credentials.json');
if(args[0]==='--version'){console.log('gws test');process.exit(0)}
if(args[1]==='login'){
 if(!args.includes('--scopes'))process.exit(2);
 const server=http.createServer((req,res)=>{
 const query=new URL(req.url,'http://localhost').searchParams;
 if(query.get('code')!=='accepted'||query.get('state')!=='attempt-state'){res.writeHead(400);res.end();return}
 fs.writeFileSync(file,JSON.stringify({type:'authorized_user',refresh_token:'native-refresh',client_id:'project-google-client',client_secret:'public-desktop-id'}),{mode:0o600});
 res.end('Done');server.close();
 });
 server.listen(0,'127.0.0.1',()=>console.log('Open this URL: https://accounts.google.com/o/oauth2/v2/auth?client_id=project-google-client&state=attempt-state&redirect_uri='+encodeURIComponent('http://localhost:'+server.address().port+'/callback')));
}else if(args[1]==='status'){
 const grant=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
 console.log(JSON.stringify({auth_method:grant.refresh_token?'oauth2':'none',has_refresh_token:!!grant.refresh_token,token_valid:grant.refresh_token==='native-refresh',user:grant.refresh_token?'alice@example.com':undefined}));
}else if(args[1]==='logout'){fs.rmSync(file,{force:true});console.log('{}')}
`
function context(){
 const registration=Promise.withResolvers()
 const state={flows:[],mcps:[],skills:[],events:new Map(),removed:0,registered:registration.promise}
 const ctx={host:{info:async()=>({instanceId:'x'}),authorization:{register:async row=>state.flows.push(row)},mcp:{register:async row=>{state.mcps.push(row);registration.resolve();return {dispose:async()=>state.removed++}}},skills:{registerDirectory:async dir=>state.skills.push(dir)},prompts:{register:async()=>{}}},on:(name,handler)=>state.events.set(name,handler),logger:{warn:()=>{}}}
 return {ctx,state}
}
function session(provider,method='oauth',secret=''){
 const notices=[],prompts=[],signal=new AbortController().signal
 return {notices,prompts,method,signal,notify:async value=>notices.push(value),prompt:async prompt=>{
  prompts.push(prompt)
  if(prompt.kind==='select')return 'readonly'
  if(prompt.message.includes('Google Desktop OAuth client JSON'))return JSON.stringify({installed:{client_id:'project-google-client',client_secret:'desktop-public-value'}})
  if(prompt.message==='Enter your X app Client ID.')return 'project-x-client'
  if(prompt.message.includes('Client Secret'))return secret
  const url=new URL(notices.at(-1).url),redirect=new URL(url.searchParams.get('redirect_uri'));redirect.searchParams.set('code','accepted');redirect.searchParams.set('state',url.searchParams.get('state'));return redirect.href
 }}
}
test('native X authorization uses child env, keeps tokens native and only starts MCP after authorization',{timeout:15000},async t=>{
 const f=await fixture(t);await f.binary('xurl',fakeX)
 const {ctx,state}=context();await applyX(ctx)
 assert.equal(state.mcps.length,0);assert.deepEqual(await state.flows[0].inspect(),{configured:false})
 assert.deepEqual(state.flows[0].methods.map(method=>method.id),['oauth','oauth-confidential'])
 const s=session('x'),root=path.join(process.env.DSH_HOME,'credentials','x')
 await authorizeX(s,root)
 assert.equal(s.prompts.length,2,'a Native App only needs the application ID and callback')
 assert.equal(s.notices.filter(n=>n.url).length,1,'only the actual account login URL should be offered during authorization')
 assert.match(s.prompts[1].message,/First open the authorization link/)
 assert.match(s.prompts[1].placeholder,/localhost:8080\/callback/)
 assert.ok(s.prompts.every(prompt=>prompt.kind==='text'))
 assert.equal((await nativeAccount(root)).configured,true,'expired access tokens with refresh tokens remain configured')
 state.events.get('host/authorization-changed')({instanceId:'google-workspace',key:'account',phase:'authorized'})
 assert.equal(state.mcps.length,0,'another plugin authorization must not activate this bridge')
 state.events.get('host/authorization-changed')({instanceId:'x',key:'account',phase:'authorized'})
 await state.registered
 assert.equal(state.mcps.length,1)
 assert.equal(state.mcps[0].connection.oauth,undefined)
 assert.deepEqual(state.mcps[0].connection.args,['mcp','https://api.x.com/mcp'])
 await state.flows[0].disconnect({signal:s.signal})
 assert.equal(state.removed,1);assert.deepEqual(await state.flows[0].inspect(),{configured:false})
 assert.equal(process.env.CLIENT_ID,undefined)
})
test('Native App login ignores inherited application secrets and reuses its saved Client ID',async t=>{
 const f=await fixture(t);await f.binary('xurl',fakeX)
 const {ctx}=context();await applyX(ctx)
 process.env.CLIENT_ID='another-application';process.env.CLIENT_SECRET='unrelated-host-secret'
 const root=path.join(process.env.DSH_HOME,'credentials','x')
 await authorizeX(session('x'),root)
 assert.equal((await nativeAccount(root)).app.client_secret,'')
 const again=session('x');await authorizeX(again,root)
 assert.equal(again.prompts.length,1,'saved Native Apps go straight to the callback question')
 assert.equal(process.env.CLIENT_SECRET,'unrelated-host-secret','child overrides must not modify Host environment')
})
test('confidential X login requires a secret, then reuses native credentials without another secret prompt',async t=>{
 const f=await fixture(t);await f.binary('xurl',fakeX)
 const {ctx}=context();await applyX(ctx)
 const root=path.join(process.env.DSH_HOME,'credentials','x')
 const empty=session('x','oauth-confidential')
 await assert.rejects(authorizeX(empty,root),/Client Secret is required/)
 assert.equal(empty.notices.filter(notice=>notice.url).length,0,'do not start OAuth with missing credentials')
 process.env.X_TEST_EXPECTED_SECRET='confidential-test-secret'
 const s=session('x','oauth-confidential','confidential-test-secret');await authorizeX(s,root)
 assert.deepEqual(s.prompts.map(prompt=>prompt.kind),['text','secret','text'])
 assert.equal((await nativeAccount(root)).app.client_secret,'confidential-test-secret')
 const again=session('x','oauth-confidential');await authorizeX(again,root)
 assert.equal(again.prompts.length,1)
 await assert.rejects(authorizeX(session('x'),root),/Select the confidential-client/)
 const reloaded=context();await applyX(reloaded.ctx)
 assert.equal(reloaded.state.flows[0].methods[0].id,'oauth-confidential','default to the saved application type after reload')
})
test('native Google authorization relays only the current callback and stores an actual native grant',async t=>{
 const f=await fixture(t);await f.binary('gws',fakeGoogle)
 const {ctx,state}=context();await applyGoogle(ctx)
 assert.deepEqual(state.skills,['skills']);assert.deepEqual(await inspectAccount(),{configured:false})
 assert.deepEqual(state.flows[0].methods,[{id:'oauth',label:'Connect Google account'}])
 const s=session('google'),root=path.join(process.env.DSH_HOME,'credentials','google-workspace')
 await authorizeGoogle(s,root)
 assert.equal(s.prompts.length,3);assert.equal(s.prompts[0].kind,'secret');assert.equal(s.prompts[0].webInput,'json-file');assert.equal(s.prompts[1].kind,'select')
 assert.equal(s.prompts[2].kind,'text')
 assert.deepEqual(await inspectAccount(),{configured:true,accountLabel:'alice@example.com'})
 assert.equal((await stat(path.join(root,'client_secret.json'))).mode&0o777,0o600)
 await state.flows[0].disconnect({signal:s.signal});assert.deepEqual(await inspectAccount(),{configured:false})
 const again=session('google');await authorizeGoogle(again,root)
 assert.equal(again.prompts.length,2,'subsequent authorization reuses the user native client configuration')
 assert.equal(again.prompts[0].kind,'select')
})
test('Google status distinguishes a revoked token from an unavailable live check',async t=>{
 const f=await fixture(t)
 await f.binary('gws',`console.log(JSON.stringify({auth_method:'oauth2',has_refresh_token:true,token_valid:false}))`)
 assert.deepEqual(await inspectAccount(),{configured:false})
 await f.binary('gws',`console.log(JSON.stringify({auth_method:'oauth2',has_refresh_token:true}))`)
 assert.deepEqual(await inspectAccount(),{configured:true})
 await f.binary('gws',`console.log(JSON.stringify({auth_method:'oauth2',has_refresh_token:true,encryption_valid:false}))`)
 await assert.rejects(inspectAccount(),/cannot be decrypted/)
})
test('callback relay rejects unexpected destinations, mismatched or duplicated state and redirects',async t=>{
 let hits=0
 const server=http.createServer((req,res)=>{hits++;res.writeHead(302,{Location:'http://example.invalid/'});res.end()})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close())
 const expected='http://127.0.0.1:'+server.address().port+'/callback'
 assert.throws(()=>validateRedirect(expected+'?code=a&state=wrong',expected,'right'))
 assert.throws(()=>validateRedirect(expected+'?code=a&state=right&state=wrong',expected,'right'))
 await assert.rejects(relayRedirect('http://example.com/callback?code=a','http://example.com/callback'))
 assert.equal(hits,0)
 await assert.rejects(relayRedirect(expected+'?code=a',expected),/not accepted/);assert.equal(hits,1)
})
test('fragmented native URLs are not used before a complete line and cancellation closes the process',async t=>{
 await fixture(t)
 const controller=new AbortController()
 const cli=interactive(process.execPath,['-e',`process.stderr.write('https://example.test/auth?redirect_uri=');setTimeout(()=>{process.stderr.write('http%3A%2F%2Flocalhost%3A3212%2Fcallback\\n')},20);setInterval(()=>{},1000)`],{signal:controller.signal,acceptURL:u=>u.searchParams.has('redirect_uri')})
 const url=await cli.url;assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3212/callback')
 controller.abort();await assert.rejects(cli.done,/did not complete/)
 const failed=interactive('/does-not-exist',[],{acceptURL:()=>true});await assert.rejects(failed.url);await assert.rejects(failed.done)
})
test('native authorization errors expose provider categories without returning raw credential output',async()=>{
 const cli=interactive(process.execPath,['-e',`console.log('https://example.test/auth?redirect_uri=http%3A%2F%2Flocalhost%3A3212%2Fcallback');console.error('TokenExchangeError: invalid_grant private-client-secret private-code');process.exit(1)`],{acceptURL:()=>true})
 await cli.url
 await assert.rejects(cli.done,error=>error.message.includes('invalid_grant')&&!error.message.includes('private-client-secret')&&!error.message.includes('private-code'))
})
test('native directory preparation refuses unknown existing directories and preserves the data root link',async t=>{
 const f=await fixture(t),target=path.join(process.env.HOME,'native')
 const dir=await nativeDirectory('example',target);assert.equal(await readlink(target),dir)
 await nativeDirectory('example',target)
 const empty=path.join(f.directory,'empty');await mkdir(empty);await nativeDirectory('empty',empty);assert.ok(await readlink(empty))
 const unknown=path.join(f.directory,'unknown');await mkdir(unknown);await writeFile(path.join(unknown,'auth.yml'),'private')
 await assert.rejects(nativeDirectory('example',unknown),/Refusing/)
})
test('Google client import rejects wrong client types and arbitrary token endpoints',()=>{
 for(const value of ['{}','null','[]','{"installed":{"client_id":42,"client_secret":true}}'])assert.throws(()=>desktopClient(value),/Desktop app/)
 assert.throws(()=>desktopClient(JSON.stringify({web:{client_id:'id',client_secret:'secret'}})),/Desktop app/)
 assert.throws(()=>desktopClient(JSON.stringify({installed:{client_id:'id',client_secret:'secret',token_uri:'https://evil.invalid/token'}})),/Unsupported/)
 assert.equal(desktopClient(JSON.stringify({installed:{client_id:'id',client_secret:'secret'}})).installed.client_id,'id')
})

test('Google refuses invalid application JSON without starting login or persisting it',async t=>{
 const f=await fixture(t);await f.binary('gws',fakeGoogle)
 const {ctx}=context();await applyGoogle(ctx)
 const root=path.join(process.env.DSH_HOME,'credentials','google-workspace')
 const s={...session('google'),prompt:async()=>'{"web":{"client_id":"wrong","client_secret":"private"}}'}
 await assert.rejects(authorizeGoogle(s,root),/Desktop app/)
 await assert.rejects(stat(path.join(root,'client_secret.json')), {code:'ENOENT'})
 assert.deepEqual(await inspectAccount(),{configured:false})
})
