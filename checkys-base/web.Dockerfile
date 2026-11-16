FROM --platform=$BUILDPLATFORM alpine:3.24.3 AS web-build
RUN apk add --no-cache nodejs
COPY web/ /web/
COPY scripts/build-web.cjs /build-web.cjs
RUN node /build-web.cjs /web
COPY desktop-release.json /release/desktop-release.json
COPY scripts/desktop-feed.cjs scripts/download-desktop-release.cjs /release/scripts/
COPY scripts/lib/ /release/scripts/lib/
RUN node /release/scripts/desktop-feed.cjs /web/desktop-updates /desktop-feed.caddy

FROM caddy:2.11.7-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /desktop-feed.caddy /etc/caddy/desktop-feed.caddy
COPY --from=web-build /web/ /srv/

