FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tor ca-certificates curl && rm -rf /var/lib/apt/lists/* && mkdir -p /var/lib/tor/market /onion && chown -R debian-tor:debian-tor /var/lib/tor /onion && chmod 700 /var/lib/tor/market
COPY torrc /etc/tor/torrc
COPY tor-entrypoint.sh /entrypoint.sh
USER debian-tor
ENTRYPOINT ["sh","/entrypoint.sh"]
