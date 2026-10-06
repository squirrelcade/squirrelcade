# syntax=docker/dockerfile:1

# Build the web interface and the server bundle: JavaScript the same on every processor, so it's built once, on the
# builder's own (BUILDPLATFORM), even for an ARM image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build --workspace @squirrelcade/web && npm run build --workspace @squirrelcade/server

# The Playnite reader for the PC library (tools/playnite-reader): a self-contained binary for Alpine (musl), built
# on the builder's processor for the image's (TARGETARCH: amd64 is .NET's x64, arm64 its arm64).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS reader
ARG TARGETARCH
WORKDIR /src
COPY tools/playnite-reader/ ./
RUN RID="linux-musl-$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64)" \
    && dotnet publish PlayniteReader.csproj -c Release -r "$RID" --self-contained true \
      -p:PublishSingleFile=true -p:InvariantGlobalization=true -p:DebugType=None -o /out

# Production dependencies of the server only (includes the native SQLite module, so this runs on the image's own
# processor: under emulation when building an ARM image on an Intel builder).
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @squirrelcade/server --include-workspace-root=false

FROM node:22-alpine
ARG VERSION=dev
ENV NODE_ENV=production \
    SQUIRRELCADE_VERSION=${VERSION} \
    SQUIRRELCADE_DOCKER=1 \
    SQUIRRELCADE_CONFIG_DIR=/config \
    SQUIRRELCADE_PORT=7575 \
    SQUIRRELCADE_MIGRATIONS_DIR=/app/server/drizzle \
    SQUIRRELCADE_WEB_DIR=/app/web \
    SQUIRRELCADE_PLAYNITE_READER=/app/bin/playnite-reader
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./server/dist
COPY --from=build /src/apps/server/drizzle ./server/drizzle
COPY --from=build /src/apps/web/dist ./web
COPY --from=reader /out/playnite-reader ./bin/playnite-reader
# The self-contained .NET binary needs the C++ runtime; /playnite is where the Playnite backup folder is mounted (read-only).
RUN apk add --no-cache libstdc++ libgcc \
    && mkdir -p /config /imports /playnite && chown -R node:node /config /imports
USER node
EXPOSE 7575
VOLUME ["/config"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:7575/api/v1/health || exit 1
CMD ["node", "server/dist/main.js"]
