import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { nativeDirectory, privateJSON, run, interactive, relayRedirect } from './native-cli.mjs'
export const name='google-workspace'
export const inject=['host']
const scopes={
  readonly:['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/spreadsheets.readonly','https://www.googleapis.com/auth/presentations.readonly'],
  readwrite:['https://www.googleapis.com/auth/drive','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/documents','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/presentations'],
}
export function desktopClient(value){
  let json;try{json=JSON.parse(value)}catch{throw new Error('Enter a valid Google Desktop OAuth client JSON.')}
  if(typeof json?.installed?.client_id!=='string'||!json.installed.client_id.trim()||typeof json.installed.client_secret!=='string'||!json.installed.client_secret.trim())throw new Error('Use a Google OAuth client of type Desktop app, with an installed object.')
  if(json.installed.auth_uri && json.installed.auth_uri!=='https://accounts.google.com/o/oauth2/auth')throw new Error('Unsupported Google authorization endpoint.')
  if(json.installed.token_uri && !['https://oauth2.googleapis.com/token','https://accounts.google.com/o/oauth2/token'].includes(json.installed.token_uri))throw new Error('Unsupported Google token endpoint.')
  return {installed:{client_id:json.installed.client_id,client_secret:json.installed.client_secret,project_id:json.installed.project_id||'',auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://oauth2.googleapis.com/token',redirect_uris:['http://localhost']}}
}
// Application configuration belongs to this user's native gws directory.
async function nativeClient(directory){
  try { return desktopClient(await readFile(path.join(directory,'client_secret.json'),'utf8')) }
  catch(error){
    if(error.code==='ENOENT')return undefined
    throw new Error('Could not read the saved Google Desktop application configuration. Restore its client_secret.json and try again.')
  }
}
async function nativeStatus(signal,env=process.env){
  const {stdout}=await run('gws',['auth','status'],{signal,env})
  let status;try{status=JSON.parse(stdout)}catch{throw new Error('Could not read the native Google Workspace authorization status.')}
  if(status.encryption_valid===false)throw new Error('Google Workspace credentials cannot be decrypted. Restore the original native encryption key or reconnect.')
  return status
}
export async function inspectAccount(signal){
  const status=await nativeStatus(signal)
  // A missing live check may just mean the network is unavailable. An explicit
  // native invalid-token result, however, must not be displayed as connected.
  const configured=status.auth_method==='oauth2'&&status.has_refresh_token===true&&status.token_valid!==false
  return {configured,...(configured&&typeof status.user==='string'?{accountLabel:status.user}:{})}
}
export async function apply(ctx){
  const directory=await nativeDirectory('google-workspace',path.join(process.env.HOME||'/root','.config','gws'))
  await run('gws',['--version'])
  await ctx.host.skills.registerDirectory('skills')
  await ctx.host.authorization.register({key:'account',title:'Google Workspace',methods:[{id:'oauth',label:'Connect Google account'}],
    inspect:({signal})=>inspectAccount(signal),
    disconnect:async({signal})=>{await run('gws',['auth','logout'],{signal})},
    run:async session=>authorize(session,directory),
  })
  await ctx.host.prompts.register({id:'account-access',location:'system',text:'Use the installed upstream Google Workspace Skills and gws CLI for Workspace tasks. Account connection and permission changes belong in the Google Workspace plugin authorization panel. Never run interactive gws auth commands, export tokens, or ask for OAuth secrets in chat. If access is missing or insufficient, ask the user to connect or authorize again in the plugin market.'})
}

export async function authorize(session,directory){
      let client=await nativeClient(directory)
      const firstConnection=!client
      if(firstConnection){
        client=desktopClient(await session.prompt({kind:'secret',webInput:'json-file',message:'Paste your Google Desktop OAuth client JSON downloaded from Google Cloud.',placeholder:'{"installed":{"client_id":"…","client_secret":"…"}}'}))
      }
      const permission=await session.prompt({kind:'select',message:'Choose the Google Workspace permissions to request.',options:[{id:'readonly',label:'Read only',description:'Read Gmail, Drive, Calendar, Docs, Sheets and Slides.'},{id:'readwrite',label:'Read and write',description:'Also edit documents, manage files and calendars, and modify Gmail. No Admin permissions.'}]})
      if(!scopes[permission])throw new Error('Select an offered permission level.')
      if(firstConnection)await privateJSON(path.join(directory,'client_secret.json'),client)
      const cli=interactive('gws',['auth','login','--scopes',scopes[permission].join(',')],{signal:session.signal,acceptURL:u=>u.protocol==='https:'&&u.hostname==='accounts.google.com'&&u.searchParams.has('redirect_uri')})
      try{
        const url=await cli.url, redirect=url.searchParams.get('redirect_uri')
        // Validate the generated listener before asking a user to open the URL.
        const local=new URL(redirect)
        if(local.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(local.hostname)||!local.port)throw new Error('gws did not offer a supported loopback callback.')
        await session.notify({url:url.href,message:'Sign in to Google in your browser. After consent, copy the complete localhost redirect URL from the address bar, even if that page cannot open.'})
        const pasted=await Promise.race([session.prompt({kind:'text',message:'First open the authorization link above and approve access in your browser. Then paste the complete Google redirect URL from the address bar.',placeholder:'http://localhost:PORT/callback?state=…&code=…'}),cli.done.then(()=>{throw new Error('The authorization process ended. Start again.')})])
        await relayRedirect(pasted,redirect,url.searchParams.get('state'),session.signal)
        await cli.done
      }finally{cli.stop()}
}
