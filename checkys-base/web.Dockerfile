FROM --platform=$BUILDPLATFORM alpine:3.24.3 AS web-build
RUN apk add --no-cache nodejs
COPY web/ /web/
COPY scripts/build-web.cjs /build-web.cjs
RUN node /build-web.cjs /web

FROM caddy:2.11.7-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /web/ /srv/

