import test from 'node:test'
import assert from 'node:assert/strict'
import { metadata, pluginIds, mergeCatalog } from '../scripts/catalog.mjs'

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
