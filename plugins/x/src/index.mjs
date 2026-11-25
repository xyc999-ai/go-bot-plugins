import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { nativeDirectory, run, interactive, validateRedirect } from './native-cli.mjs'
export const name = 'x'
export const inject = ['host']
export async function nativeAccount(directory) {
  let source
  try { source = await readFile(path.join(directory,'auth.yml'),'utf8') }
  catch(error) { if(error.code==='ENOENT') return {};throw new Error('Could not read the native X authorization store.') }
  if(Buffer.byteLength(source)>2<<20) throw new Error('The native X authorization store is too large.')
  let store
  try {store = parse(source,{maxAliasCount:50})} catch {throw new Error('The native X authorization store is invalid.')}
  const appName=store?.default_app || 'default', app=store?.apps?.[appName]
  const tokens=app?.oauth2_tokens||{}, user=app?.default_user && tokens[app.default_user] ? app.default_user : Object.keys(tokens)[0]
  const token=tokens[user]?.oauth2
  return {appName,app,user,configured:!!(token?.access_token && (token.refresh_token || token.expiration_time*1000>Date.now()))}
}
export async function apply(ctx) {
  const directory=await nativeDirectory('x',path.join(process.env.HOME||'/root','.xurl'))
  await run('xurl',['--version'])
  const inspect=async()=>{const row=await nativeAccount(directory);return {configured:!!row.configured,...(row.configured?{accountLabel:row.user}:{})}}
  const {instanceId}=await ctx.host.info()
  let bridge, connecting=Promise.resolve()
  const closeBridge=async()=>{await connecting; if(bridge){const old=bridge;bridge=undefined;await old.dispose()}}
  const connect=()=>connecting=connecting.catch(()=>{}).then(async()=>{
    if(bridge || !(await inspect()).configured)return
    bridge=await ctx.host.mcp.register({name:'api',connection:{transport:'stdio',command:'xurl',args:['mcp','https://api.x.com/mcp']},toolLoading:'on-demand'})
  })
  const account=await nativeAccount(directory)
  const methods=[{id:'oauth',label:'Native App (no Client Secret)'},{id:'oauth-confidential',label:'Web App / confidential client'}]
  if(account.app?.client_secret)methods.reverse()
  await ctx.host.authorization.register({key:'account',title:'X',methods,inspect,
    disconnect:async({signal})=>{
      await closeBridge()
      const row=await nativeAccount(directory)
      if(row.user)await run('xurl',['auth','clear','--app',row.appName,'--oauth2-username',row.user],{signal})
    },
    run:async session=>authorize(session,directory),
  })
  ctx.on('host/authorization-changed',event=>{
    if(event.instanceId===instanceId&&event.key==='account'&&event.phase==='authorized') void connect().catch(()=>ctx.logger.warn('X is authorized, but its MCP bridge could not start. Re-enable the plugin to retry.'))
  })
  await ctx.host.prompts.register({id:'account-access',location:'system',text:'Use the X MCP tools for X account actions. If X authorization is missing, ask the user to connect X in the plugin market. Never request OAuth secrets, tokens or callback URLs in chat, and never run interactive X login from an Agent shell.'})
  try{await connect()}catch{ctx.logger.warn('X is authorized, but its MCP bridge could not start. Re-enable the plugin to retry.')}
}

export async function authorize(session,directory){
      const row=await nativeAccount(directory)
      const env={...process.env}
      const confidential=session.method==='oauth-confidential'
      // Do not inherit another application's credentials from the Host environment.
      env.CLIENT_ID=row.app?.client_id||''
      env.CLIENT_SECRET=''
      if(!confidential&&row.app?.client_secret)throw new Error('This saved X app uses a Client Secret. Select the confidential-client authorization method.')
      if(!row.app?.client_id){
        // The setup link already lives in the plugin detail. Keeping it as a
        // second "Continue in browser" notice obscures the real login link.
        await session.notify({message:'Create your X Developer App and enable OAuth 2.0. Register http://localhost:8080/callback as its callback URL. API usage is billed to your developer account.'})
        env.CLIENT_ID=(await session.prompt({kind:'text',message:'Enter your X app Client ID.'})).trim()
        if(!env.CLIENT_ID)throw new Error('X Client ID is required.')
        env.REDIRECT_URI='http://localhost:8080/callback'
      }
      if(confidential){
        env.CLIENT_SECRET=row.app?.client_secret||(await session.prompt({kind:'secret',message:'Enter your confidential X app Client Secret.'})).trim()
        if(!env.CLIENT_SECRET)throw new Error('X Client Secret is required for a confidential client.')
      }
      const cli=interactive('xurl',['auth','oauth2','--headless','--app',row.appName||'default'],{signal:session.signal,env,acceptURL:u=>u.protocol==='https:'&&['x.com','twitter.com'].includes(u.hostname)&&u.searchParams.has('redirect_uri')})
      try{
        const url=await cli.url, redirect=url.searchParams.get('redirect_uri'), state=url.searchParams.get('state')
        await session.notify({url:url.href,message:'Sign in to X in your browser. After approval, immediately copy the complete redirect URL here, even if the local page cannot open. X authorization codes expire after 30 seconds.'})
        const pasted=await Promise.race([session.prompt({kind:'text',message:'First open the authorization link above and approve access in your browser. Then paste the complete X redirect URL from the address bar.',placeholder:'http://localhost:8080/callback?state=…&code=…'}),cli.done.then(()=>{throw new Error('The authorization process ended. Start again.')})])
        validateRedirect(pasted,redirect,state)
        cli.write(pasted.trim());await cli.done
        // Native xurl backfills env credentials into the app that now has tokens,
        // so refresh and MCP work without keeping an environment secret around.
        await run('xurl',['auth','status'],{signal:session.signal,env})
      } finally {cli.stop()}
}
