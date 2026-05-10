# LMS Server

Backend service for the LMS platform.

## Tech Stack

- Node.js + TypeScript
- Express
- MongoDB (Mongoose)
- Redis
- Neo4j (optional but supported)
- Socket.IO
- Cloudinary
- Stripe / Polar integrations

## Prerequisites

- Node.js 18+
- npm
- MongoDB connection string
- Redis connection string

Optional integrations:

- Neo4j instance
- Cloudinary account
- SMTP credentials (mail)
- Stripe or Polar credentials (payments)

## Setup

1. Open the server directory.
2. Install dependencies.
3. Create an environment file.
4. Start the development server.

```bash
cd server
npm install
```

Create a .env file in server root with values similar to:

```env
# App
PORT=8000
CLIENT_URL=http://localhost:3000

# Database
DB_URL=mongodb://127.0.0.1:27017/lms
REDIS_URL=redis://127.0.0.1:6379

# JWT / Auth
ACCESS_TOKEN=your_access_token_secret
REFRESH_TOKEN=your_refresh_token_secret
ACTIVATION_SECRET=your_activation_secret
ACCESS_TOKEN_EXPIRE=300
REFRESH_TOKEN_EXPIRE=1200

# Cloudinary
CLOUD_NAME=your_cloud_name
CLOUD_API_KEY=your_cloud_api_key
CLOUD_SECRET_KEY=your_cloud_secret

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SERVICE=
SMTP_MAIL=you@example.com
SMTP_PASSWORD=your_smtp_password

# Neo4j (optional)
NEO4J_URI=neo4j+s://your-host.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password

# Payments (optional)
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
POLAR_ACCESS_TOKEN=your_polar_access_token
POLAR_PRODUCT_ID=your_polar_product_id
POLAR_WEBHOOK_SECRET=your_polar_webhook_secret

# Video (optional)
VDOCIPHER_API_SECRET=your_vdocipher_api_secret
```

## Available Scripts

- npm run dev: Run server in development mode using ts-node-dev.
- npm run build: Compile TypeScript to build/.
- npm start: Run compiled server from build/server.js.

## Running Locally

Development mode:

```bash
npm run dev
```

Production-like mode:

```bash
npm run build
npm start
```

## API Base

- Base path: /api/v1
- Health check: /test

Routers mounted under /api/v1:

- users/auth: user routes
- courses: course routes
- orders: order routes
- notifications: notification routes
- analytics: analytics routes
- layout: layout routes
- neo4j: mounted separately at /api/v1/neo4j

## Notes

- CORS currently allows http://localhost:3000.
- Rate limit is configured to 100 requests per 15 minutes.
- Neo4j connection failures do not crash the server.

## Build Output

Compiled files are generated in the build/ folder.
