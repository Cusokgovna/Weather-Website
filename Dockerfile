# Weather website: Node.js (Express) server + static frontend
FROM node:22-alpine

# All following commands run in /app inside the container
WORKDIR /app

# Copy only dependency manifests first: this layer is cached
# until package.json / package-lock.json change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the application code
COPY server ./server
COPY scripts ./scripts
COPY database ./database
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Do not run as root
USER node

CMD ["node", "server/index.js"]
