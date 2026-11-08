const test = require('node:test')
const assert = require('node:assert')
const dgram = require('node:dgram')
const dns = require('node:dns')
const { EventEmitter, once } = require('node:events')

const plugin = require('../index.js')

const AIVDM = '!AIVDM,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*26'
const AIVDO = '!AIVDO,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*24'

function fakeApp () {
  const app = new EventEmitter()
  app.errors = []
  app.debug = () => {}
  app.error = msg => app.errors.push(msg)
  app.setPluginStatus = message => { app.status = message }
  return app
}

function listen () {
  return new Promise(resolve => {
    const server = dgram.createSocket('udp4')
    server.bind(0, '127.0.0.1', () => resolve(server))
  })
}

test('new configurations default to AIVDM only, without conversion', () => {
  const properties = plugin(fakeApp()).schema().properties
  assert.strictEqual(properties.aivdm.default, true)
  assert.strictEqual(properties.aivdo.default, false)
  assert.strictEqual(properties.convertaivdo.default, false)
})

for (const endpoints of [undefined, []]) {
  for (const flags of [{ aivdm: true }, { aivdo: true }, { aivdm: true, aivdo: true, convertaivdo: true }]) {
    test(`inactive with ${endpoints ? 'empty' : 'omitted'} endpoints and ${JSON.stringify(flags)}`, t => {
      const createSocket = t.mock.method(dgram, 'createSocket', () => {
        assert.fail('inactive forwarding must not create a UDP socket')
      })
      const setTimer = t.mock.method(global, 'setInterval', () => {
        assert.fail('inactive forwarding must not create a DNS timer')
      })
      const lookup = t.mock.method(dns, 'lookup', () => {
        assert.fail('inactive forwarding must not resolve hostnames')
      })
      const app = fakeApp()
      const report = t.mock.fn()
      app.reportOutputMessages = report
      const p = plugin(app)
      t.after(() => p.stop())
      const options = { ...flags, event: 'nmea0183, nmea0183out' }
      if (endpoints) options.endpoints = endpoints
      p.start(options)

      assert.strictEqual(app.status, 'Inactive: no UDP endpoints configured')
      assert.deepStrictEqual(app.eventNames(), [])
      for (const event of ['nmea0183', 'nmea0183out']) {
        app.emit(event, AIVDM)
        app.emit(event, AIVDO)
      }
      assert.strictEqual(createSocket.mock.callCount(), 0)
      assert.strictEqual(setTimer.mock.callCount(), 0)
      assert.strictEqual(lookup.mock.callCount(), 0)
      assert.strictEqual(report.mock.callCount(), 0)
      assert.deepStrictEqual(app.errors, [])
      p.stop()
      p.stop()
    })
  }
}

test('saved message-type settings and omitted flags keep their forwarding behavior', t => {
  const sent = []
  t.mock.method(dgram, 'createSocket', () => {
    const socket = new EventEmitter()
    socket.send = message => sent.push(message)
    socket.close = () => {}
    return socket
  })
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  const defaults = p.schema().properties
  const cases = [
    { flags: { aivdm: false, aivdo: false, convertaivdo: false }, expected: [] },
    { flags: {}, expected: [] },
    { flags: { aivdm: false, aivdo: true, convertaivdo: false }, expected: [AIVDO + '\n'] },
    { flags: { aivdm: false, aivdo: true, convertaivdo: true }, expected: [AIVDM + '\n'] },
    {
      flags: {
        aivdm: defaults.aivdm.default,
        aivdo: defaults.aivdo.default,
        convertaivdo: defaults.convertaivdo.default
      },
      expected: [AIVDM + '\n']
    }
  ]
  for (const { flags, expected } of cases) {
    const options = Object.freeze({
      endpoints: Object.freeze([Object.freeze({ ipaddress: '127.0.0.1', port: 12345 })]),
      ...flags
    })
    const original = JSON.stringify(options)
    sent.length = 0
    p.start(options)
    app.emit('nmea0183', AIVDM)
    app.emit('nmea0183', AIVDO)
    assert.deepStrictEqual(sent, expected)
    assert.strictEqual(JSON.stringify(options), original)
    p.stop()
  }
})

test('adding and removing endpoints across restarts updates status and forwarding', { timeout: 3000 }, async t => {
  const server = await listen()
  t.after(() => server.close())
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  const options = { endpoints: [{ ipaddress: '127.0.0.1', port: server.address().port }], aivdm: true }
  for (let i = 0; i < 2; i++) {
    p.start({ endpoints: [], aivdm: true })
    assert.strictEqual(app.status, 'Inactive: no UDP endpoints configured')
    assert.strictEqual(app.listenerCount('nmea0183'), 0)
    p.stop()

    p.start(options)
    assert.strictEqual(app.status, `Emitting AIS messages to 127.0.0.1:${server.address().port}`)
    assert.strictEqual(app.listenerCount('nmea0183'), 1)
    const received = once(server, 'message', { signal: AbortSignal.timeout(2000) })
    app.emit('nmea0183', AIVDM)
    const [message] = await received
    assert.strictEqual(message.toString(), AIVDM + '\n')
    p.stop()
  }
})

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

test('a restart forwards each sentence once, not once per start', { timeout: 3000 }, async t => {
  const server = await listen()
  t.after(() => server.close())
  const messages = []
  server.on('message', m => messages.push(m.toString()))
  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())
  const options = { endpoints: [{ ipaddress: '127.0.0.1', port: server.address().port }], aivdm: true }
  p.start(options)
  p.stop()
  p.start(options)
  assert.strictEqual(app.listenerCount('nmea0183'), 1)
  app.emit('nmea0183', AIVDM)
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepStrictEqual(messages, [AIVDM + '\n'])
})


test('optional endpoint names appear in status without changing forwarding', { timeout: 3000 }, async t => {
  const server = await listen()
  t.after(() => server.close())

  const received = once(server, 'message', { signal: AbortSignal.timeout(2000) })
  const app = fakeApp()
  let status = ''
  app.setPluginStatus = message => { status = message }

  const p = plugin(app)
  t.after(() => p.stop())

  const port = server.address().port
  p.start({
    endpoints: [{
      name: '  Test receiver  ',
      ipaddress: '127.0.0.1',
      port
    }],
    aivdm: true
  })

  assert.strictEqual(
    status,
    `Emitting AIS messages to Test receiver (127.0.0.1:${port})`
  )

  app.emit('nmea0183', AIVDM)
  const [message] = await received
  assert.strictEqual(message.toString(), AIVDM + '\n')
})

test('endpoint names appear in DNS errors with hostname and port', { timeout: 3000 }, async t => {
  const hostname = 'no-such-host.invalid'
  const realLookup = dns.lookup

  let lookupDone
  const completed = new Promise(resolve => { lookupDone = resolve })

  t.mock.method(dns, 'lookup', (host, options, callback) => {
    if (host !== hostname) return realLookup(host, options, callback)
    queueMicrotask(() => {
      callback(new Error('ENOTFOUND'))
      lookupDone()
    })
  })

  const app = fakeApp()
  const p = plugin(app)
  t.after(() => p.stop())

  p.start({
    endpoints: [{
      name: 'Remote receiver',
      ipaddress: hostname,
      port: 12345
    }],
    aivdm: true
  })

  await completed

  assert.strictEqual(app.errors.length, 1)
  assert.match(
    app.errors[0],
    /Remote receiver \(no-such-host\.invalid:12345\): cannot resolve hostname/
  )
})

test('endpoint name is optional in the configuration schema', () => {
  const app = fakeApp()
  const schema = plugin(app).schema()
  const endpoint = schema.properties.endpoints.items

  assert.deepStrictEqual(endpoint.required, ['ipaddress', 'port'])
  assert.strictEqual(endpoint.properties.name.type, 'string')
  assert.strictEqual(endpoint.properties.name.default, '')
})

test('reports activity once for multiple endpoints', { timeout: 3000 }, async t => {
  const first = await listen()
  const second = await listen()
  t.after(() => first.close())
  t.after(() => second.close())

  const received1 = once(first, 'message', { signal: AbortSignal.timeout(2000) })
  const received2 = once(second, 'message', { signal: AbortSignal.timeout(2000) })

  const app = fakeApp()
  const reports = []
  app.reportOutputMessages = count => reports.push(count)

  const p = plugin(app)
  t.after(() => p.stop())

  p.start({
    endpoints: [
      { ipaddress: '127.0.0.1', port: first.address().port },
      { ipaddress: '127.0.0.1', port: second.address().port }
    ],
    aivdm: true
  })

  app.emit('nmea0183', AIVDM)

  const [[m1], [m2]] = await Promise.all([received1, received2])
  await new Promise(resolve => setImmediate(resolve))

  assert.strictEqual(m1.toString(), AIVDM + '\n')
  assert.strictEqual(m2.toString(), AIVDM + '\n')
  assert.deepStrictEqual(reports, [1])
})

test('does not report activity for filtered or unsent messages', async t => {
  const app = fakeApp()
  const reports = []
  app.reportOutputMessages = count => reports.push(count)

  const p = plugin(app)
  t.after(() => p.stop())

  p.start({ endpoints: [], aivdm: true })
  app.emit('nmea0183', AIVDM)

  p.stop()

  p.start({
    endpoints: [{ ipaddress: '127.0.0.1', port: 12345 }],
    aivdm: false,
    aivdo: false
  })

  app.emit('nmea0183', AIVDM)

  await new Promise(resolve => setImmediate(resolve))
  assert.deepStrictEqual(reports, [])
})


test('does not report activity when all UDP sends fail', async t => {
  const fakeSocket = new EventEmitter()
  let sendCalls = 0

  fakeSocket.send = (...args) => {
    sendCalls++
    const callback = args[args.length - 1]
    queueMicrotask(() => callback(new Error('simulated send failure')))
  }
  fakeSocket.close = () => {}

  t.mock.method(dgram, 'createSocket', () => fakeSocket)

  const app = fakeApp()
  const reports = []
  app.reportOutputMessages = count => reports.push(count)

  const p = plugin(app)
  t.after(() => p.stop())

  p.start({
    endpoints: [
      { ipaddress: '127.0.0.1', port: 11199 },
      { ipaddress: '127.0.0.1', port: 5278 }
    ],
    aivdm: true
  })

  app.emit('nmea0183', AIVDM)
  await new Promise(resolve => setImmediate(resolve))

  assert.strictEqual(sendCalls, 2)
  assert.strictEqual(app.errors.length, 2)
  assert.deepStrictEqual(reports, [])
})
