# ais-forwarder
[Signal K Node server](https://github.com/SignalK/signalk-server-node) plugin to forward [NMEA0183 AIS messages](http://catb.org/gpsd/AIVDM.html) over UDP. This enables your vessel to double as a [MarineTraffic roaming station](https://help.marinetraffic.com/hc/en-us/articles/205282657-Add-an-AIS-Receiving-Station-to-the-MarineTraffic-Network).

![screenshot](./ais-forwarder.png)

Output can be debugged with `nc -ulkw 0 <ipaddress> <port>`.
