import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, lstat, readlink, symlink, chmod, writeFile, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
const exec = promisify(execFile)
export async function run(command, args, {signal, env = process.env} = {}) {
  try { return await exec(command, args, {signal, env, encoding:'utf8', timeout:30_000, maxBuffer:128 << 10}) }
  catch (error) { if (signal?.aborted) throw signal.reason; throw new Error(`${command} failed. Check the native application configuration and try again.`) }
}
export async function nativeDirectory(id, nativePath) {
  const root = path.resolve(process.env.DSH_HOME || '/root/harness/.dsh', 'credentials', id)
  await mkdir(root,{recursive:true,mode:0o700}); await chmod(root,0o700)
  await mkdir(path.dirname(nativePath),{recursive:true,mode:0o700})
  try {
    const info = await lstat(nativePath)
    if(info.isDirectory()) {
      // Some official CLI version checks create an empty default directory.
      // rmdir is atomic and refuses nonempty directories; never move/delete
      // unknown credential data to make activation appear successful.
      try { await rmdir(nativePath) } catch { throw new Error(`Refusing to replace an existing native credential location: ${nativePath}`) }
      await symlink(root,nativePath,'dir')
    } else if (!info.isSymbolicLink() || path.resolve(path.dirname(nativePath),await readlink(nativePath)) !== root) throw new Error(`Refusing to replace an existing native credential location: ${nativePath}`)
  } catch (error) {
    if(error.code !== 'ENOENT') throw error
    await symlink(root,nativePath,'dir')
  }
  return root
}
export async function privateJSON(file, value) {
  const temp = file + '.tmp'
  try { await writeFile(temp, JSON.stringify(value), {mode:0o600}); await chmod(temp,0o600); await rename(temp,file) }
  finally { const {rm} = await import('node:fs/promises'); await rm(temp,{force:true}) }
}
// Return only reviewed diagnostic categories, never native stdout/stderr:
// OAuth failures may otherwise echo application secrets or one-time codes.
function authorizationFailure(command, output) {
  for (const [code, message] of [
    ['invalid_client', 'The provider rejected the application credentials (invalid_client). Check the app Client ID and Client Secret.'],
    ['unauthorized_client', 'The provider does not allow this application to use this authorization flow (unauthorized_client). Check the app type and OAuth settings.'],
    ['invalid_grant', 'The provider rejected the authorization code (invalid_grant). Start again and use the new redirect URL once.'],
    ['invalid_request', 'The provider rejected the authorization request (invalid_request). Check the app callback URL and use a new redirect URL from this attempt.'],
    ['invalid_scope', 'The provider rejected the requested permissions (invalid_scope). Check the app permissions.'],
    ['access_denied', 'The provider denied account access (access_denied). Check the permissions on the authorization page.'],
    ['redirect_uri_mismatch', 'The provider rejected the callback URL (redirect_uri_mismatch). Check the callback registered for this app.'],
  ]) {
    if (new RegExp('\\b' + code + '\\b', 'i').test(output)) return message
  }
  if (/TokenExchangeError/.test(output)) return 'The provider could not exchange the authorization code. Check the application settings and start a new authorization attempt.'
  if (/dial tcp|connection refused|TLS handshake timeout|no such host|network is unreachable/i.test(output)) return 'Could not reach the authorization provider. Check the Host network and try again.'
  return `${command} authorization did not complete. Check your application settings or start again.`
}
export function interactive(command, args, {signal,env=process.env,acceptURL} = {}) {
  const child = spawn(command,args,{env,stdio:['pipe','pipe','pipe'],detached:process.platform !== 'win32'})
  let text='', selected=false, resolveURL,rejectURL
  const url = new Promise((resolve,reject)=>{resolveURL=resolve;rejectURL=reject})
  // Prevent early process errors from becoming unhandled while the UI awaits input.
  url.catch(()=>{})
  const stop = () => { if(child.exitCode!==null||child.signalCode!==null||!child.pid)return; try { process.kill(-child.pid,'SIGTERM') } catch { child.kill() } }
  const kill = () => { if(child.exitCode!==null||child.signalCode!==null||!child.pid)return; stop(); const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},2000); timer.unref(); child.once('close',()=>clearTimeout(timer)) }
  const done = new Promise((resolve,reject)=>{
    const fail=()=>reject(new Error(authorizationFailure(command,text)))
    child.once('error',fail)
    child.once('close',code=>{signal?.removeEventListener('abort',kill);if(!selected)rejectURL(new Error(`${command} did not provide an authorization URL.`));if(code===0)resolve();else fail()})
  })
  done.catch(()=>{})
  const collect = data => {
    text += data.toString('utf8')
    if(Buffer.byteLength(text)>128<<10){kill();return}
    for(const raw of text.match(/https?:\/\/[^\s<>"\x1b]+(?=[\s<>"\x1b])/g)||[]) {
      try { const candidate=new URL(raw); if(!selected&&acceptURL(candidate)){selected=true;resolveURL(candidate)} } catch {}
    }
  }
  child.stdout.on('data',collect);child.stderr.on('data',collect)
  child.stdin.on('error',()=>{})
  signal?.addEventListener('abort',kill,{once:true});if(signal?.aborted)kill()
  return {url,done,stop:kill,write:value=>{if(child.exitCode!==null||child.signalCode!==null)throw new Error('Authorization process has ended. Start again.');child.stdin.end(value+'\n')}}
}
export function validateRedirect(value, expected, state) {
  const target=new URL(expected), actual=new URL(value.trim())
  if(actual.origin!==target.origin || actual.pathname!==target.pathname || actual.username || actual.password || actual.hash || !actual.searchParams.get('code') || actual.searchParams.getAll('code').length!==1 || (state && (actual.searchParams.getAll('state').length!==1 || actual.searchParams.get('state')!==state))) throw new Error('Paste the complete redirect URL from this authorization attempt.')
  return actual
}
// Relay only to the current native CLI listener. Never follow redirects or fetch
// arbitrary user URLs; provider token exchange remains entirely in the CLI.
export async function relayRedirect(value, expected, state, signal) {
  const actual=validateRedirect(value,expected,state), target=new URL(expected)
  if(target.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !target.port) throw new Error('The native application did not provide a supported loopback callback.')
  await new Promise((resolve,reject)=>{
    const request=http.request({hostname:target.hostname==='localhost'?'127.0.0.1':target.hostname.replace(/^\[|\]$/g,''),port:target.port,path:actual.pathname+actual.search,method:'GET',signal,timeout:10_000},response=>{response.resume();response.on('end',()=>response.statusCode>=200&&response.statusCode<300?resolve():reject(new Error('The native callback was not accepted.')))})
    request.on('error',()=>reject(new Error('Could not reach the native authorization callback. Start again.')));request.on('timeout',()=>request.destroy());request.end()
  })
}
