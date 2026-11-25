import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyCLI } from '../plugins/officecli/src/cli.mjs'

test('Office activation requires a working CLI and accepts upstream version changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'go-bot-cli-'))
  t.after(() => rm(directory, {recursive:true, force:true}))
  const command = join(directory, 'officecli')
  await assert.rejects(verifyCLI(command), /Reinstall the plugin/)
  await writeFile(command, '#!/bin/sh\nprintf "1.0.163\\n"\n', {mode:0o755})
  await verifyCLI(command)
  await writeFile(command, '#!/bin/sh\nprintf "1.0.160\\n"\n', {mode:0o755})
  await verifyCLI(command)
  await writeFile(command, '#!/bin/sh\nexit 1\n', {mode:0o755})
  await assert.rejects(verifyCLI(command), /Reinstall the plugin/)
})
