# Runs the full check with no Atlassian account: typecheck, tests, the case-set scores,
# the manifest validation, then the demo walkthrough.
FROM node:24-alpine
RUN apk add --no-cache curl openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run typecheck && npm test && npm run eval && npm run manifest
CMD ["npm", "run", "demo"]
