# DigitalOcean Cost Explorer

A web application that allows DigitalOcean users to analyze their costs by service type and date.

<img width="1602" height="1117" alt="do-cost-explorer" src="https://github.com/user-attachments/assets/5a3b5793-8b3d-47fe-8dd7-7627158d5282" />

## Overview

This project serves as both a practical cost analysis tool and a comprehensive demo for building OAuth applications on top of DigitalOcean's API. It demonstrates:

- **OAuth 2.0 Implementation**: Complete OAuth flow with DigitalOcean's API
- **Session Management**: Secure session handling with Redis
- **API Integration**: Real-world usage of DigitalOcean's billing and droplet APIs
- **Modern Web Architecture**: React frontend with Node.js backend
- **Production Deployment**: Ready-to-deploy configuration for DigitalOcean App Platform

## Features

- OAuth login with DigitalOcean
- View costs by day and service type
- Filter out specific line items (Premier Support, Discounts, etc.)
- Interactive charts and detailed tables
- Select from available billing periods

## Setup

### Prerequisites

- Node.js 22.12+
- DigitalOcean API OAuth credentials
- Redis (for session storage)

### Environment Variables

#### Backend

Create a `.env` file in the backend directory with:

```
DO_CLIENT_ID=your_digitalocean_client_id
DO_CLIENT_SECRET=your_digitalocean_client_secret
SESSION_SECRET=some_random_string
PORT=5000
FRONTEND_URL=http://localhost:3000
REACT_APP_API_URL=<url>/api
REDIRECT_URI=<url>/api/auth/callback
WDS_SOCKET_PORT=443

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_DB=0
```

#### Frontend

Create a `.env` file in the frontend directory with:

```
REACT_APP_API_URL=http://localhost:5000/api
```

### Installation

1. Clone the repository
2. Install backend dependencies:
   ```
   cd backend
   npm install
   ```
3. Install frontend dependencies:
   ```
   cd frontend
   npm install
   ```

### Running the application

1. Start Redis (required for session storage):
   ```
   docker run -d --name redis -p 6379:6379 redis:7-alpine
   ```

2. Start the backend:
   ```
   cd backend
   npm run dev
   ```
3. Start the frontend (Vite dev server; `npm start` does the same):
   ```
   cd frontend
   npm run dev
   ```
4. Open your browser and navigate to `http://localhost:3000`

The frontend is built with [Vite](https://vite.dev/). `npm run build` writes the production files to `frontend/build`, and `npm run lint` checks the code.

## Deployment

- The frontend & backend can be deployed to [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform/).
- Remember to update the environment variables for production
- Ensure [Valkey](https://docs.digitalocean.com/products/databases/valkey/) is available in your production environment

### App Platform Example Deployment

```yaml
alerts:
- rule: DEPLOYMENT_FAILED
- rule: DOMAIN_FAILED
databases:
- cluster_name: db-valkey-costexplorer-47705
  engine: VALKEY
  name: db-valkey-costexplorer-47705
  production: true
  version: "8"
domains:
- domain: costexplorer.digitalocean.solutions
  type: PRIMARY
envs:
- key: NODE_ENV
  scope: RUN_AND_BUILD_TIME
  value: production
features:
- buildpack-stack=ubuntu-22
ingress:
  rules:
  - component:
      name: backend
      preserve_path_prefix: true
    match:
      path:
        prefix: /api
  - component:
      name: frontend
    match:
      path:
        prefix: /
maintenance: {}
name: labs-costexplorer
region: lon
services:
- autoscaling:
    max_instance_count: 6
    metrics:
      cpu:
        percent: 70
    min_instance_count: 2
  environment_slug: node-js
  envs:
  - key: DO_CLIENT_ID
    scope: RUN_AND_BUILD_TIME
    value: ${DO_CLIENT_ID}
  - key: DO_CLIENT_SECRET
    scope: RUN_AND_BUILD_TIME
    type: SECRET
    value: ${DO_CLIENT_SECRET}
  - key: SESSION_SECRET
    scope: RUN_AND_BUILD_TIME
    type: SECRET
    value: ${SESSION_SECRET}
  - key: FRONTEND_URL
    scope: RUN_AND_BUILD_TIME
    value: ${APP_URL}
  - key: REDIRECT_URI
    scope: RUN_AND_BUILD_TIME
    value: ${APP_URL}/api/auth/callback
  - key: WDS_SOCKET_PORT
    scope: RUN_AND_BUILD_TIME
    value: "443"
  - key: REDIS_URL
    scope: RUN_TIME
    value: ${db-valkey-costexplorer-47705.DATABASE_URL}
  github:
    branch: prod
    deploy_on_push: true
    repo: digitalocean-labs/cost-explorer
  health_check:
    http_path: /api/healthcheck
  http_port: 8080
  instance_size_slug: apps-d-1vcpu-1gb
  name: backend
  run_command: npm start
  source_dir: backend
static_sites:
- catchall_document: index.html
  environment_slug: node-js
  github:
    branch: prod
    deploy_on_push: true
    repo: digitalocean-labs/cost-explorer
  name: frontend
  source_dir: frontend
```

## Contact

If you wish to learn more about DigitalOcean's services, you are welcome to reach out to the sales team at sales@digitalocean.com. A global team of talented engineers will be happy to provide assistance.

## License

This project is released under the MIT License.
