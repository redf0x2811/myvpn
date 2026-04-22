FROM node:20-alpine

RUN apk add --no-cache wireguard-tools iptables ip6tables bash iproute2

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 51820/udp

CMD ["node", "server.js"]
