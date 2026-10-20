FROM apify/actor-node:20
COPY package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --no-audit --no-fund
COPY . ./
RUN npm install --include=dev --no-audit --no-fund && npm run build && npm prune --omit=dev
CMD npm start --silent
