# Build context is the verified release directory, not the source checkout.
ARG BASE_WEB_IMAGE=ghcr.io/the-vibe-code-dad/checky-web:latest
FROM ${BASE_WEB_IMAGE}
COPY . /srv/desktop-updates/
