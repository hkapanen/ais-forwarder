const dgram = require('dgram')
const os = require('os')

const pkgData = require('./package.json')

module.exports = function (app) {
  var socket
  var endpoints

  return {
    start: options => {
      endpoints = options.endpoints
      let endpointList = []
      endpoints.forEach( endpoint => {
          endpointList.push(`${endpoint.ipaddress}:${endpoint.port}`)
          app.debug(`Adding endpoint: ${endpoint.ipaddress}:${endpoint.port}`)
      })
      socket = dgram.createSocket('udp4')
      const send = message => {
        if ((message.match(/!AIVDM/) && options.aivdm) ||
            (message.match(/!AIVDO/) && options.aivdo)) {

          // If option is enabled, convert the AIVDO to an AIVMD sentence
          if (options.convertaivdo) {
            let messageParts = message.split(',')

            let sentenceFragmentCount = messageParts[1]
            let sentenceFragment = messageParts[2]
            let sentenceId = messageParts[3]
            let sentenceRadioClass = messageParts[4]
            let sentencePayload = messageParts[5]
            let sentenceBits = messageParts[6].split('*')[0] // We want the bits without the checksum

            let newAivmdSentence = 'AIVDM,' + sentenceFragmentCount + ',' + sentenceFragment + ',' + sentenceId + ',' + sentenceRadioClass + ',' + sentencePayload + ',' + sentenceBits
            
            // Compute the new checksum by XORing all the character values in the string.
            let checksum = 0;
            for(var i = 0; i < newAivmdSentence.length; i++) {
              checksum = checksum ^ newAivmdSentence.charCodeAt(i);
            }

            // Convert it to hexadecimal (base-16, upper case, most significant nybble first).
            let hexsum = Number(checksum).toString(16).toUpperCase();
            if (hexsum.length < 2) {
              hexsum = ("00" + hexsum).slice(-2);
            }

            // Append the ! and also add the newly calculated checksum
            message = '!' + newAivmdSentence + '*' + hexsum
          }

          message = message + '\n'

          endpoints.forEach( endpoint => {
            let key = `${endpoint.ipaddress}:${endpoint.port}`
            app.debug(`sending to ${key}: `, message)
            if (socket) {
              socket.send(
                message,
                0,
                message.length,
                endpoint.port,
                endpoint.ipaddress
              )
            }
          })
        }
      }

      let eventsString = options.event || 'nmea0183'
      let events = eventsString.split(',').map(s => s.trim())
      app.debug('Using events %j', events)
      events.forEach(name => {
        app.on(name, send)
      })
      app.setPluginStatus(`Emitting AIS messages to ${endpointList.join(', ')}`)
    },
    stop: () => {
      endpoints = []
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
      endpoints: {
        type: 'array',
        title: 'UDP endpoints to send updates',
        items: {
          type: 'object',
          required: ['ipaddress', 'port'],
          properties: {
            ipaddress: {
              type: 'string',
              title: 'UDP endpoint IP address',
              default: '0.0.0.0'
            },
            port: {
              type: 'number',
              title: 'Port',
              default: 12345
            }
          }
        }
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
      },
      convertaivdo: {
        type: 'boolean',
        title: 'Convert AIVDO to AIVDM sentences (For endpoints not supporting AIVDO)',
        default: false
      }
    }
  }
}
