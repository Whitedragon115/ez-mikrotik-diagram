# 2026-10-12 15:15:28 by RouterOS 7.24.2
# software id = TEST-0000
#
# model = sample
/interface bridge
add admin-mac=48:A9:8A:00:00:01 auto-mac=no comment=defconf name=bridge
/interface ethernet
set [ find default-name=ether1 ] comment="WAN uplink"
set [ find default-name=ether5 ] name=ether5-dmz
/interface wireguard
add listen-port=13231 mtu=1420 name=wg-home
/interface vlan
add interface=bridge name=vlan20-iot vlan-id=20
/interface list
add comment=defconf name=WAN
add comment=defconf name=LAN
/interface bridge port
add bridge=bridge comment=defconf interface=ether2
add bridge=bridge comment=defconf interface=ether3
add bridge=bridge comment=defconf interface=ether4
/ip ipsec peer
add address=198.51.100.9/32 local-address=203.0.113.10 name=hq
/interface list member
add comment=defconf interface=bridge list=LAN
add comment=defconf interface=ether1 list=WAN
add interface=vlan20-iot list=LAN
/ip address
add address=192.168.88.1/24 comment=defconf interface=bridge network=\
    192.168.88.0
add address=192.168.20.1/24 interface=vlan20-iot network=192.168.20.0
add address=10.99.0.1/24 interface=wg-home network=10.99.0.0
/ip dhcp-client
add comment=defconf interface=ether1
/ip dns
set allow-remote-requests=yes
/ip firewall address-list
add address=209.99.186.0/24 list=bruteforce
/ip firewall filter
add action=accept chain=input comment=\
    "defconf: accept established,related,untracked" connection-state=\
    established,related,untracked
add action=drop chain=input comment="defconf: drop invalid" connection-state=\
    invalid
add action=drop chain=input comment="SEC: brute force blacklist" \
    src-address-list=bruteforce
add action=accept chain=input comment="defconf: accept ICMP" protocol=icmp
add action=accept chain=input comment=\
    "defconf: accept to local loopback (for CAPsMAN)" dst-address=127.0.0.1
add action=drop chain=input comment="defconf: drop all not coming from LAN" \
    in-interface-list=!LAN
add action=accept chain=forward comment="defconf: accept in ipsec policy" \
    ipsec-policy=in,ipsec
add action=fasttrack-connection chain=forward comment="defconf: fasttrack" \
    connection-state=established,related hw-offload=yes
add action=accept chain=forward comment=\
    "defconf: accept established,related, untracked" connection-state=\
    established,related,untracked
add action=drop chain=forward comment="defconf: drop invalid" \
    connection-state=invalid
add action=drop chain=forward comment=\
    "defconf:  drop all from WAN not DSTNATed" connection-nat-state=!dstnat \
    connection-state=new in-interface-list=WAN
add action=jump chain=forward jump-target=custom-chain disabled=yes
add action=drop chain=input connection-limit=100,32 protocol=tcp comment="rate thing"
/ip firewall mangle
add action=mark-routing chain=prerouting new-routing-mark=via-wg passthrough=no \
    src-address=192.168.20.0/24
add action=change-mss chain=forward new-mss=clamp-to-pmtu protocol=tcp tcp-flags=syn
/ip firewall nat
add action=masquerade chain=srcnat comment="defconf: masquerade" \
    ipsec-policy=out,none out-interface-list=WAN
add action=dst-nat chain=dstnat comment="Caf\C3\A9 web" dst-address-type=local dst-port=8080 \
    protocol=tcp to-addresses=192.168.88.20 to-ports=80
/ip ipsec policy
add dst-address=10.30.0.0/16 peer=hq src-address=192.168.88.0/24 tunnel=yes
/ip route
add dst-address=8.8.4.4/32 gateway=203.0.113.1
add dst-address=0.0.0.0/0 gateway=wg-home routing-table=via-wg
/routing table
add fib name=via-wg
/queue simple
add max-limit=10M/50M name=iot target=192.168.20.0/24
/system identity
set name=Lab-Router
/system clock
set time-zone-name=Asia/Taipei
/interface pppoe-client
add add-default-route=yes disabled=no interface=ether1 name=pppoe-out1 user=isp-user
