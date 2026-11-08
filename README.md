# ais-forwarder

[Signal K Node server](https://github.com/SignalK/signalk-server-node) plugin to forward [NMEA0183 AIS messages](https://gpsd.gitlab.io/gpsd/AIVDM.html) over UDP. This enables your vessel to double as a [MarineTraffic roaming station](https://help.marinetraffic.com/hc/en-us/articles/205282657-Add-an-AIS-Receiving-Station-to-the-MarineTraffic-Network), [AISHub Station](https://www.aishub.net/) or both.

![screenshot](./ais-forwarder.png)

## Configuration

1. Add a UDP endpoint using the hostname or IP address and port supplied by your receiving service. You can add multiple endpoints to share AIS data with more than one service.
2. Choose which messages to forward. **AIVDM (other vessels)** is selected by default for new configurations. Enable **AIVDO (own vessel)** if you also want to share your own vessel's AIS messages; it is off by default.
3. If your receiving service requires own-vessel messages in AIVDM format, enable **Convert AIVDO to AIVDM** together with AIVDO forwarding. Conversion is off by default.
4. Enable the plugin and save your settings to start forwarding incoming AIS messages.

Your existing saved settings are kept when you upgrade.

If the status shows **Inactive: no UDP endpoints configured**, add at least one destination and save your settings. Selecting a message type alone is not enough to start forwarding.

Each UDP endpoint can optionally have a `name` to make destinations easier to identify. The name is displayed alongside the hostname/IP address and port in plugin status messages and diagnostic logs. It is used for identification only and does not affect AIS forwarding behavior.

## Plugin Activity

AIS Forwarder reports forwarding activity to Signal K's built-in Plugin Activity indicator in the dashboard. This provides a quick visual check that AIS messages are being forwarded.

Each AIS sentence is counted once when at least one local UDP send completes without an error, regardless of how many destinations are configured. Filtered or unsent messages are not counted.

**Important:** Activity indicates successful local UDP sends, not confirmed delivery. UDP does not provide delivery acknowledgements, so a successful local send does not guarantee that a remote receiver has received or processed the message.


This plugin can also be used with NMEA 2K AIS receivers by converting the data first to NMEA 0183 format for example with [signalk-n2kais-to-nmea0183 plugin](https://github.com/sbender9/signalk-n2kais-to-nmea0183). In this case `nmea0183out` must be used as an NMEA 0183 Event in the ais-forwarder plugin configuration.

Output can be debugged with `nc -ulkw 0 <ipaddress> <port>`.

NOTE: Existing plugin users upgrading from version 0.2 or below to 0.3 or higher need to re-configure their endpoints!
