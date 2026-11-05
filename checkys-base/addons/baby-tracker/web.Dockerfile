ARG BASE_WEB_IMAGE=ghcr.io/the-vibe-code-dad/checky-web:latest
FROM --platform=$BUILDPLATFORM alpine:3.24.3 AS addon-build
RUN apk add --no-cache nodejs
COPY web/ /addon/
COPY build-web.cjs /build-web.cjs
RUN node /build-web.cjs /addon

# Install on the normal web image (or the image with Windows app hosting).
FROM ${BASE_WEB_IMAGE}
COPY --from=addon-build /addon/ /srv/baby/
COPY addons.json /srv/addons.json
