ARG BASE_POCKETBASE_IMAGE=ghcr.io/the-vibe-code-dad/checky-pocketbase:latest
FROM ${BASE_POCKETBASE_IMAGE}
# Extend the existing service and /pb/pb_data database. No second database.
COPY pocketbase/pb_hooks/ /pb/pb_hooks/
COPY pocketbase/pb_migrations/ /pb/pb_migrations/
