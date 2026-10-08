FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends tor ca-certificates curl && rm -rf /var/lib/apt/lists/* && mkdir -p /var/lib/tor/market /onion && chown -R debian-tor:debian-tor /var/lib/tor /onion && chmod 700 /var/lib/tor/market
COPY torrc /etc/tor/torrc
COPY tor-entrypoint.sh /entrypoint.sh
USER debian-tor
ENTRYPOINT ["sh","/entrypoint.sh"]
