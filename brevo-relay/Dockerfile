# Minimal container for the Brevo relay. No dependencies — just Node + the
# built-in http/fetch. Useful if you deploy via Docker (e.g. a VPS with
# `docker run`, Render, Railway). For a plain VPS you can skip Docker entirely
# and run server.js under systemd — see README.md.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
