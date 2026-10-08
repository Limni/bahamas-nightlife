# syntax=docker/dockerfile:1

# Stage 1 — build the Vite SPA. VITE_* vars are inlined at BUILD time, so pass
# them as --build-arg. Only the public anon key belongs here.
FROM node:22-alpine AS build
WORKDIR /app

# A Windows-generated lock lacks Linux optional binaries (rollup/esbuild/
# rolldown), so fall back to a fresh resolve inside the Linux image.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
 || (echo "npm ci failed — falling back to npm install" \
     && rm -f package-lock.json && npm install --no-audit --no-fund)

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_MAP_TILE_URL
ARG VITE_MAP_ATTRIBUTION
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL \
    VITE_MAP_ATTRIBUTION=$VITE_MAP_ATTRIBUTION

COPY . .
RUN npm run build

# Stage 2 — serve with nginx
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
