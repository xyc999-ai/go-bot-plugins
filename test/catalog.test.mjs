import test from 'node:test'
import assert from 'node:assert/strict'
import { metadata, pluginIds, mergeCatalog, sameReleaseMetadata } from '../scripts/catalog.mjs'

test('every plugin publishes display metadata and complete original resources', async () => {
  for (const id of pluginIds) {
    const entry = await metadata(id)
    assert.equal(entry.pluginId, id)
    assert.equal(entry.source.type, 'tarball')
    assert.match(entry.source.spec, new RegExp('/' + id + '-v' + entry.version + '/'))
    assert.equal(entry.defaultEnabled === true, ['officecli', 'agent-browser'].includes(id))
  }
})
test('catalog updates retain old releases and reject changing published metadata', () => {
  const first = { pluginId: 'mail', version: '1.0.0', name: 'Mail' }
  const next = { ...first, version: '1.1.0' }
  const catalog = mergeCatalog([first], [next])
  assert.deepEqual(catalog, [first, next])
  assert.deepEqual(mergeCatalog(catalog, [next]), catalog)
  assert.throws(() => mergeCatalog(catalog, [{ ...first, name: 'Overwritten' }]), /immutable/)
})


test('existing release verification allows a GitHub repository rename but no content changes', async () => {
  const current = await metadata('x')
  const old = structuredClone(current)
  old.source.spec = old.source.spec.replace('/xyc999-ai/go-bot-plugins/', '/fixture/previous-repository/')
  old.assetBase = old.assetBase.replace('/xyc999-ai/go-bot-plugins/', '/fixture/previous-repository/')
  assert.equal(sameReleaseMetadata(old, current), true)
  assert.equal(sameReleaseMetadata({ ...old, name: 'Changed name' }, current), false)
  assert.equal(sameReleaseMetadata({ ...old, version: '9.0.0' }, current), false)
  assert.equal(sameReleaseMetadata({ ...old, source: { ...old.source, spec: old.source.spec.replace('.tgz', '-changed.tgz') } }, current), false)
  assert.equal(sameReleaseMetadata({ ...old, assetBase: old.assetBase.replace('https://github.com/', 'https://example.com/') }, current), false)
})
