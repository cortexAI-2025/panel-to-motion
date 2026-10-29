FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json server/
RUN cd server && npm install

COPY server/ server/
COPY web/ web/

ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/src/index.js"]
