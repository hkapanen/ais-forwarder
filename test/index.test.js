const test = require('node:test')
const assert = require('node:assert')
const dgram = require('node:dgram')
const dns = require('node:dns')
const { EventEmitter, once } = require('node:events')

const plugin = require('../index.js')

const AIVDM = '!AIVDM,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*26'

function fakeApp () {
  const app = new EventEmitter()
  app.errors = []
  app.debug = () => {}
  app.error = msg => app.errors.push(msg)
  app.setPluginStatus = () => {}
  return app
}

function listen () {
  return new Promise(resolve => {
    const server = dgram.createSocket('udp4')
    server.bind(0, '127.0.0.1', () => resolve(server))
  })
}

test('forwards AIVDM to an IP endpoint', { timeout: 3000 }, async t => {
  const server = await listen()
  t.after(() => server.close())
  const received = once(server, 'message', { signal: AbortSignal.timeout(2000) })
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  p.start({ endpoints: [{ ipaddress: '127.0.0.1', port: server.address().port }], aivdm: true })
  app.emit('nmea0183', AIVDM)
  const [message] = await received
  assert.strictEqual(message.toString(), AIVDM + '\n')
})

test('forwards to a hostname endpoint after it is resolved', { timeout: 3000 }, async t => {
  const server = await listen()
  t.after(() => server.close())
  const received = once(server, 'message', { signal: AbortSignal.timeout(2000) })

  let signalResolved
  const resolved = new Promise(resolve => { signalResolved = resolve })
  const realLookup = dns.lookup
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    // Node's UDP sockets also use dns.lookup() internally for binding.
    if (hostname !== 'localhost') return realLookup(hostname, options, callback)
    assert.deepStrictEqual(options, { family: 4 })
    queueMicrotask(() => {
      callback(null, '127.0.0.1', 4)
      signalResolved()
    })
  })

  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  p.start({ endpoints: [{ ipaddress: 'localhost', port: server.address().port }], aivdm: true })
  await resolved
  app.emit('nmea0183', AIVDM)
  const [message] = await received
  assert.strictEqual(message.toString(), AIVDM + '\n')
})

test('an unresolvable hostname is logged and skipped, never thrown', { timeout: 3000 }, async t => {
  let signalLookupDone
  const lookupDone = new Promise(resolve => { signalLookupDone = resolve })
  const realLookup = dns.lookup
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    if (hostname !== 'no-such-host.invalid') return realLookup(hostname, options, callback)
    assert.deepStrictEqual(options, { family: 4 })
    queueMicrotask(() => {
      const err = Object.assign(new Error('getaddrinfo ENOTFOUND no-such-host.invalid'), {
        code: 'ENOTFOUND'
      })
      callback(err)
      signalLookupDone()
    })
  })

  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  p.start({ endpoints: [{ ipaddress: 'no-such-host.invalid', port: 12345 }], aivdm: true })
  for (let i = 0; i < 20; i++) app.emit('nmea0183', AIVDM)
  await lookupDone
  for (let i = 0; i < 20; i++) app.emit('nmea0183', AIVDM)

  // The Node test runner itself fails on any uncaught exception.
  assert.strictEqual(app.errors.length, 1, 'logged once, not once per sentence')
  assert.match(app.errors[0], /no-such-host\.invalid:12345: cannot resolve hostname/)
})
