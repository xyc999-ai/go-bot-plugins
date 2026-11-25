import { configFile, readConfig, writeConfig, verifyCLI, validateKey } from './native-cli.mjs'
import { readFile } from 'node:fs/promises'

export const name = 'gemini-api'
export const inject = ['host']

export async function inspect(file = configFile()) {
  const config = await readConfig(file)
  return { configured: typeof config.security?.api_key === 'string' && !!config.security.api_key.trim() }
}
export async function authorize(session, file = configFile()) {
  if (session.method !== 'api-key') throw new Error('Select the API Key authorization method.')
  const key = (await session.prompt({ kind: 'secret', message: 'Enter your Gemini API key from Google AI Studio.' })).trim()
  if (!key || key.length > 4096 || /\s|\p{Cc}/u.test(key)) throw new Error('Enter a valid Gemini API key without spaces or line breaks.')
  // Read first so a broken configuration cannot be silently overwritten.
  await readConfig(file)
  await validateKey(key, session.signal)
  session.signal.throwIfAborted()
  const config = await readConfig(file)
  config.version ??= 1
  config.security = { ...config.security, api_key: key }
  delete config.security.access_token
  config.no_keyring = 'true'
  await writeConfig(config, file)
}
export async function disconnect(file = configFile()) {
  const config = await readConfig(file)
  if (config.security) delete config.security.api_key
  await writeConfig(config, file)
}
export async function apply(ctx) {
  await verifyCLI()
  await ctx.host.authorization.register({
    key: 'api-key', title: 'Gemini API CLI',
    methods: [{ id: 'api-key', label: 'Configure API Key' }],
    inspect: () => inspect(),
    disconnect: ({ signal }) => { signal.throwIfAborted(); return disconnect() },
    run: session => authorize(session),
  })
  await ctx.host.prompts.register({
    id: 'official-cli-usage', location: 'system', order: 0,
    text: await readFile(new URL('./upstream-instructions.md', import.meta.url), 'utf8'),
  })
}
