import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { apply, authorize, inspect, disconnect } from '../plugins/gemini-api/src/index.mjs'
import { configFile, readConfig } from '../plugins/gemini-api/src/native-cli.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'go-bot-gemini-test-'))
  const previous = { ...process.env }
  process.env.HOME = path.join(directory, 'home')
  await mkdir(process.env.HOME)
  const bin = path.join(directory, 'bin'); await mkdir(bin)
  process.env.PATH = bin + path.delimiter + process.env.PATH
  await writeFile(path.join(bin, 'gemini-api'), '#!' + process.execPath + '\n' + `
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('gemini-api test');process.exit(0)}
if(args.slice(0,2).join(' ')!=='models list' || !args.includes('--no-keyring') || args.includes(process.env.GEMINI_API_KEY)) process.exit(8);
if(process.env.GEMINI_ACCESS_TOKEN || process.env.GEMINI_SERVER_URL) process.exit(9);
switch(process.env.GEMINI_API_KEY){
case 'valid-test-key':console.log(JSON.stringify({models:[{name:'models/test'}]}));break;
case 'valid-replacement':console.log(JSON.stringify({models:[]}));break;
case 'slow-test-key':setInterval(()=>{},1000);break;
case 'network-test-key':console.error('dial tcp: connection refused private-raw-secret');process.exit(1);break;
case 'help-test-key':console.log('Offline model catalog');break;
default:console.error('401 UNAUTHENTICATED API_KEY_INVALID '+process.env.GEMINI_API_KEY);process.exit(3);
}
`, { mode: 0o755 })
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}
function session(key, controller = new AbortController()) {
  return { method: 'api-key', signal: controller.signal, prompts: [], async prompt(prompt) { this.prompts.push(prompt); return key } }
}
test('Gemini registers the existing authorization flow and uses only the native default configuration', async t => {
  await fixture(t)
  const flows = [], prompts = []
  await apply({ host: { authorization: { register: async flow => flows.push(flow) }, prompts: { register: async prompt => prompts.push(prompt) } } })
  assert.deepEqual(flows[0].methods, [{ id: 'api-key', label: 'Configure API Key' }])
  assert.deepEqual(await flows[0].inspect(), { configured: false })
  const attempt = session('valid-test-key'); await flows[0].run(attempt)
  assert.deepEqual(await flows[0].inspect(), { configured: true })
  assert.equal(attempt.prompts.length, 1); assert.equal(attempt.prompts[0].kind, 'secret')
  assert.equal((await lstat(configFile())).isSymbolicLink(), false)
  assert.equal((await lstat(configFile())).mode & 0o777, 0o600)
  assert.equal((await lstat(path.dirname(configFile()))).mode & 0o777, 0o700)
  assert.equal((await readConfig()).no_keyring, 'true')
  await assert.rejects(lstat(path.join(process.env.HOME, 'harness')), { code: 'ENOENT' })
  assert.equal(prompts[0].location, 'system'); assert.ok(!prompts[0].text.includes('valid-test-key'))
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].id, 'official-cli-usage')
  assert.equal(prompts[0].text, await readFile(new URL('../plugins/gemini-api/src/upstream-instructions.md', import.meta.url), 'utf8'))
  await flows[0].disconnect({ signal: new AbortController().signal })
  assert.deepEqual(await inspect(), { configured: false })
})
test('verification ignores inherited Gemini credentials, keeps Host env unchanged and preserves native preferences', async t => {
  await fixture(t)
  await mkdir(path.dirname(configFile()), { recursive: true })
  await writeFile(configFile(), 'output_format: json\nsecurity:\n  api_key: old\n  access_token: expired\n')
  process.env.GEMINI_API_KEY = 'unrelated-key'; process.env.GEMINI_ACCESS_TOKEN = 'unrelated-token'; process.env.GEMINI_SERVER_URL = 'https://unrelated.invalid'
  await authorize(session('valid-test-key'))
  const config = await readConfig()
  assert.equal(config.output_format, 'json'); assert.equal(config.security.api_key, 'valid-test-key'); assert.equal(config.security.access_token, undefined)
  assert.equal(process.env.GEMINI_API_KEY, 'unrelated-key'); assert.equal(process.env.GEMINI_ACCESS_TOKEN, 'unrelated-token')
  await authorize(session('valid-replacement'))
  assert.equal((await readConfig()).security.api_key, 'valid-replacement')
  await disconnect(); assert.equal((await readConfig()).output_format, 'json')
})
test('invalid keys and offline output cannot overwrite a previously configured key or leak raw errors', async t => {
  await fixture(t); await authorize(session('valid-test-key'))
  const before = await readFile(configFile(), 'utf8')
  for (const key of ['invalid-private-value', 'help-test-key', 'network-test-key']) {
    await assert.rejects(authorize(session(key)), error => !error.message.includes(key) && !error.message.includes('private-raw-secret'))
    assert.equal(await readFile(configFile(), 'utf8'), before)
  }
  for (const key of ['', 'abc\ndef', 'abc def']) await assert.rejects(authorize(session(key)), /valid Gemini API key/)
  await assert.rejects(authorize({ ...session('valid-test-key'), method: 'oauth' }), /API Key authorization/)
})
test('cancelling verification terminates the CLI and leaves no candidate configuration', async t => {
  await fixture(t)
  const controller = new AbortController()
  const attempt = authorize(session('slow-test-key', controller))
  const timer = setTimeout(() => controller.abort(new Error('test cancelled')), 100)
  try { await assert.rejects(attempt, /test cancelled/) } finally { clearTimeout(timer) }
  assert.deepEqual(await inspect(), { configured: false })
  await assert.rejects(readFile(configFile()), { code: 'ENOENT' })
})
test('broken native YAML is reported without replacing it', async t => {
  await fixture(t)
  await mkdir(path.dirname(configFile()), { recursive: true })
  const malformed = 'security: [broken'
  await writeFile(configFile(), malformed)
  await assert.rejects(inspect(), /Repair config.yaml/)
  await assert.rejects(authorize(session('valid-test-key')), /Repair config.yaml/)
  assert.equal(await readFile(configFile(), 'utf8'), malformed)
})
