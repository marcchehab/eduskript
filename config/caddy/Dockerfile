# Caddy with the Cloudflare DNS module, for the Kamal "caddy" accessory.
# DNS-01 lets Caddy obtain certificates for our own domains (all in our
# Cloudflare account) before DNS points at the server — no cert gap at a
# cutover or server move. Customer domains outside our Cloudflare still use
# on-demand HTTP-01 (config/Caddyfile). Built on the VPS by bin/build-caddy-image.
FROM caddy:2.10-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.10
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
