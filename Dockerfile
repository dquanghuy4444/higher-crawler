FROM node:20-bookworm-slim

WORKDIR /app

# Minimal runtime packages for Node API plus Python-backed crawlers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY . .

RUN mkdir -p /app/.crawler-output /app/.crawler-state /app/downloaded_files /app/.browser-profiles

ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHON_BIN=python3

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
