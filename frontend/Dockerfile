FROM node:22-alpine AS development-dependencies-env
# Copy manifests first so the npm ci layer caches across source changes
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci

FROM node:22-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:22-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:22-alpine
# node:alpine ships with a built-in 'node' user (uid 1000) — use it
RUN mkdir -p /app && chown node:node /app
COPY --chown=node:node ./package.json package-lock.json /app/
COPY --chown=node:node --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --chown=node:node --from=build-env /app/build /app/build
WORKDIR /app
USER node
ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
