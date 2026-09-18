#!/bin/sh
set -eu
tor -f /etc/tor/torrc &
tor_pid=$!
trap 'kill "$tor_pid"; wait "$tor_pid"' TERM INT
while [ ! -s /var/lib/tor/market/hostname ]; do
  kill -0 "$tor_pid"
  sleep 1
done
cp /var/lib/tor/market/hostname /onion/hostname
chmod 644 /onion/hostname
wait "$tor_pid"
