FROM node:26-alpine AS development-dependencies-env
# Copy manifests first so the npm ci layer caches across source changes
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci

FROM node:26-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:26-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:26-alpine
# node:alpine ships with a built-in 'node' user (uid 1000) — use it.
# Strip the bundled npm CLI: the runtime only runs the server, and npm's
# vendored dependencies (picomatch, sigstore, …) otherwise trip container
# vulnerability scanners with HIGH CVEs that don't apply to us.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && mkdir -p /app && chown node:node /app
COPY --chown=node:node ./package.json package-lock.json /app/
COPY --chown=node:node --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --chown=node:node --from=build-env /app/build /app/build
WORKDIR /app
USER node
ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000
# Run the server binary directly — no npm in the runtime image
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
