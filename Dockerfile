FROM node:22-alpine

WORKDIR /app

COPY package.json server.mjs ./
COPY app ./app

ENV HOST=0.0.0.0 \
    PORT=8080 \
    PAL_SAVES=/palworld/Pal/Saved/SaveGames \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server.mjs"]
