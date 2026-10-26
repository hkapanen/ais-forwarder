const test = require('node:test')
const assert = require('node:assert')
const dgram = require('dgram')
const EventEmitter = require('events')

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

const tick = ms => new Promise(resolve => setTimeout(resolve, ms))

test('forwards AIVDM to an IP endpoint', async () => {
  const server = await listen()
  const received = new Promise(resolve => server.once('message', m => resolve(m.toString())))
  const app = fakeApp()
  const p = plugin(app)
  p.start({ endpoints: [{ ipaddress: '127.0.0.1', port: server.address().port }], aivdm: true })
  app.emit('nmea0183', AIVDM)
  assert.strictEqual(await received, AIVDM + '\n')
  p.stop()
  server.close()
})

test('forwards to a hostname endpoint after it is resolved', async () => {
  const server = await listen()
  const received = new Promise(resolve => server.once('message', m => resolve(m.toString())))
  const app = fakeApp()
  const p = plugin(app)
  p.start({ endpoints: [{ ipaddress: 'localhost', port: server.address().port }], aivdm: true })
  await tick(200)
  app.emit('nmea0183', AIVDM)
  assert.strictEqual(await received, AIVDM + '\n')
  p.stop()
  server.close()
})

test('an unresolvable hostname is logged and skipped, never thrown', async () => {
  const uncaught = []
  const onUncaught = err => uncaught.push(err)
  process.on('uncaughtException', onUncaught)
  const app = fakeApp()
  const p = plugin(app)
  p.start({ endpoints: [{ ipaddress: 'no-such-host.invalid', port: 12345 }], aivdm: true })
  for (let i = 0; i < 20; i++) app.emit('nmea0183', AIVDM)
  await tick(1000)
  for (let i = 0; i < 20; i++) app.emit('nmea0183', AIVDM)
  await tick(200)
  p.stop()
  process.removeListener('uncaughtException', onUncaught)
  assert.deepStrictEqual(uncaught, [])
  assert.strictEqual(app.errors.length, 1, 'logged once, not once per sentence')
  assert.match(app.errors[0], /no-such-host\.invalid:12345: cannot resolve hostname/)
})
