const test = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const dns = require('node:dns')
const { EventEmitter, once } = require('node:events')

const plugin = require('../index.js')
const AIVDM = '!AIVDM,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*26'

function fakeApp () {
  return Object.assign(new EventEmitter(), {
    debug () {},
    error () {},
    setPluginStatus (status) { this.status = status }
  })
}

const duplicateCases = [
  { name: 'identical IP endpoints', addresses: ['127.0.0.1', '127.0.0.1'] },
  { name: 'identical hostname endpoints', addresses: ['receiver.example', 'receiver.example'] },
  { name: 'different endpoint names', addresses: ['127.0.0.1', '127.0.0.1'], names: ['First receiver', 'Second receiver'] },
  { name: 'hostname capitalization', addresses: ['Receiver.Example', 'receiver.example'] },
  { name: 'surrounding spaces', addresses: [' 127.0.0.1 ', '127.0.0.1'] },
  { name: 'numeric string ports', addresses: ['127.0.0.1', '127.0.0.1'], ports: [12345, '12345'] }
]

for (const { name, addresses, names = [], ports = [12345, 12345] } of duplicateCases) {
  test(`rejects ${name} before starting forwarding`, t => {
    t.mock.method(dgram, 'createSocket', () => assert.fail('must reject before creating a socket'))
    t.mock.method(dns, 'lookup', () => assert.fail('must reject before resolving hostnames'))
    t.mock.method(global, 'setInterval', () => assert.fail('must reject before starting a timer'))
    const app = fakeApp()
    app.reportOutputMessages = t.mock.fn()
    const p = plugin(app)
    t.after(() => p.stop())
    // A unique entry between the duplicates checks the entire list, not just adjacent pairs.
    const endpoints = [
      { ipaddress: addresses[0], port: ports[0], name: names[0] },
      { ipaddress: 'other.example', port: 54321 },
      { ipaddress: addresses[1], port: ports[1], name: names[1] }
    ]
    const options = { endpoints, aivdm: true, aivdo: true }
    const saved = JSON.stringify(options)

    assert.throws(() => p.start(options), error => {
      assert.match(error.message, /^Duplicate UDP endpoint:/)
      assert.ok(error.message.includes(`${addresses[1]}:${ports[1]}`))
      if (names[1]) assert.ok(error.message.includes(names[1]))
      assert.match(error.message, /entries 1 and 3/)
      assert.match(error.message, /Remove the duplicate or use a different address or port, then save your settings\./)
      return true
    })
    assert.equal(JSON.stringify(options), saved, 'saved settings must not be rewritten')
    assert.deepEqual(app.eventNames(), [])
    app.emit('nmea0183', AIVDM)
    assert.equal(app.reportOutputMessages.mock.callCount(), 0)
    assert.equal(app.status, undefined, 'must not advertise active forwarding')
    p.stop()
    p.stop()
  })
}

test('accepts distinct address/port pairs regardless of names or DNS results', t => {
  const sent = []
  t.mock.method(dgram, 'createSocket', () => {
    const socket = new EventEmitter()
    socket.send = (message, offset, length, port, address, callback) => {
      sent.push({ message, port, address })
      callback(null)
    }
    socket.close = () => {}
    return socket
  })
  // Separate hostnames may deliberately point to the same server.
  t.mock.method(dns, 'lookup', (hostname, options, callback) => callback(null, '127.0.0.1'))
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  const endpoints = [
    { name: 'Receiver', ipaddress: '127.0.0.1', port: 12345 },
    { name: 'Receiver', ipaddress: '127.0.0.1', port: 12346 },
    { name: 'Receiver', ipaddress: '127.0.0.2', port: 12345 },
    { ipaddress: 'first.example', port: 12345 },
    { ipaddress: 'second.example', port: 12345 }
  ]
  p.start({ endpoints, aivdm: true })
  app.emit('nmea0183', AIVDM)
  assert.deepEqual(sent, endpoints.map(endpoint => ({
    message: AIVDM + '\n',
    port: endpoint.port,
    address: endpoint.ipaddress === '127.0.0.2' ? '127.0.0.2' : '127.0.0.1'
  })))
})

test('forwarding recovers after a duplicate configuration is corrected', { timeout: 3000 }, async t => {
  const server = dgram.createSocket('udp4')
  t.after(() => server.close())
  const listening = once(server, 'listening')
  server.bind(0, '127.0.0.1')
  await listening
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  const endpoint = { ipaddress: '127.0.0.1', port: server.address().port }
  const valid = { endpoints: [endpoint], aivdm: true }

  p.start(valid)
  p.stop()
  assert.throws(() => p.start({ endpoints: [endpoint, { ...endpoint }], aivdm: true }), /Duplicate UDP endpoint/)
  p.stop()
  p.start(valid)
  assert.equal(app.listenerCount('nmea0183'), 1)
  assert.equal(app.status, `Emitting AIS messages to 127.0.0.1:${endpoint.port}`)
  const received = once(server, 'message', { signal: AbortSignal.timeout(2000) })
  app.emit('nmea0183', AIVDM)
  const [message] = await received
  assert.equal(message.toString(), AIVDM + '\n')
})
