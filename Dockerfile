FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# DATABASE_URL is scoped to this RUN only — not baked into the image.
# Railway volumes don't exist at build time; the real value comes from service variables at runtime.
RUN DATABASE_URL=file:/tmp/build-placeholder.db npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "start:railway"]
