const dgram = require('dgram')
const os = require('os')

const pkgData = require('./package.json')

module.exports = function (app) {
  let socket
  let onStop = []

  return {
    start: options => {
      if (options.ipaddress) {
        socket = dgram.createSocket('udp4')
        socket.bind(options.ipaddress, function () {
        })

        const send = message => {
          if ((message.match(/!AIVDM/) && options.aivdm) || 
              (message.match(/!AIVDO/) && options.aivdo)) {
            app.debug('sending %j', message)
            socket.send(
              message,
              0,
              message.length,
              options.port,
              options.ipaddress
            )
          }
        }

        let eventsString = options.event || 'nmea0183'
        let events = eventsString.split(',').map(s => s.trim())
        app.debug(`using events %j`, events)
        events.forEach(name => {
          if (name == 'nmea0183') {
            app.signalk.on(name, send)
          } else {
            app.on(name, send)
          }
        })
        onStop.push(() => {
          events.forEach(name => {
            app.signalk.removeListener(name, send)
          })
        })
        app.setProviderStatus(`Using ip address ${options.ipaddress} port ${options.port}`)
      } else {
        app.setProviderError('No ip address specified')
      }
    },
    stop: () => {
      onStop.forEach(f => f())
      onStop = []
      if (socket) {
        socket.close()
        socket = undefined
      }
    },
    schema,
    id: 'ais-forwarder',
    name: pkgData.description
  }
}

function schema () {
  return {
    type: 'object',
    properties: {
      ipaddress: {
        type: 'string',
        title: 'IP Address',
        default: '0.0.0.0'
      },
      port: {
        type: 'number',
        title: 'Port',
        default: '12345'
      },
      event: {
        type: 'string',
        title: 'NMEA 0183 Events',
        default: 'nmea0183',
        description: 'can be comma separated list'
      },
      aivdo: {
        type: 'boolean',
        title: 'Forward AIVDO sentences (own vessel)',
        default: false
      },
      aivdm: {
        type: 'boolean',
        title: 'Forward AIVDM sentences (other vessels)',
        default: false
      }
    }
  }
}
