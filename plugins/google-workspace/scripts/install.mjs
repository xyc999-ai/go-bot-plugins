import { nativeDirectory } from '../src/native-cli.mjs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
await nativeDirectory('google-workspace',path.join(process.env.HOME||'/root','.config','gws'))
execFileSync('npm', ['install', '-g', '@googleworkspace/cli'], { stdio: 'inherit' })
execFileSync('gws', ['--version'], { stdio: 'inherit' })
