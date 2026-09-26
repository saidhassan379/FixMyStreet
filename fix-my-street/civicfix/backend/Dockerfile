FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads
EXPOSE 4000
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
