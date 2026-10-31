FROM --platform=$BUILDPLATFORM alpine:3.24.3 AS downloader

ARG PB_VERSION=0.41.1
ARG TARGETARCH

WORKDIR /tmp

RUN apk add --no-cache ca-certificates unzip

ADD https://ganigeorgiev.com/meta/pocketbase/pocketbase/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip /tmp/pocketbase.zip

RUN unzip /tmp/pocketbase.zip -d /out \
  && rm /tmp/pocketbase.zip \
  && chmod +x /out/pocketbase

FROM alpine:3.24.3

WORKDIR /pb

RUN apk add --no-cache ca-certificates

COPY --from=downloader /out/pocketbase /pb/pocketbase

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

EXPOSE 8080

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]
