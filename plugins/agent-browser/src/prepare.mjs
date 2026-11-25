import upstream from '../upstream.lock.json' with { type: 'json' }
import { verifyCLI, run } from './cli.mjs'
export async function verify() {
  await verifyCLI('agent-browser', upstream.version)
  await run('agent-browser', ['skills', 'get', 'core'])
}
