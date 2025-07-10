# 🚀 Browser Use SaaS Platform - Deployment Guide

## 📋 Overview

This guide covers deploying the complete Browser Use Orchestration Platform as a SaaS service where customers download Electron worker apps and connect to your centralized platform.

## 🏗️ Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    SaaS Platform (Your Infrastructure)         │
├─────────────────────────────────────────────────────────────────┤
│  Web Dashboard: app.browseruse.com (React/Next.js)             │
│  API Gateway: api.browseruse.com (Node.js/Express)             │
│  WebSocket Hub: ws.browseruse.com (Socket.io)                  │
│  Database: PostgreSQL (User accounts, workspaces, tasks)       │
│  Billing: Stripe integration                                   │
└─────────────────────────────────────────────────────────────────┘
                                    ↕ WebSocket/HTTPS
┌─────────────────────────────────────────────────────────────────┐
│                  Customer Infrastructure                        │
├─────────────────────────────────────────────────────────────────┤
│  Worker 1: Customer's Laptop (Mac/Windows) + Their API Key     │
│  Worker 2: Customer's Cloud VM + Their API Key                 │  
│  Worker 3: Customer's Office Computer + Their API Key          │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Prerequisites

### System Requirements
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v14 or higher
- **Redis**: v6 or higher (optional, for session storage)
- **Stripe Account**: For payment processing
- **Domain Name**: For production deployment

### Development Tools
- **Git**: For version control
- **Docker**: For containerized deployment (optional)
- **SSL Certificate**: For HTTPS/WSS connections

## 🚀 Quick Start (Development)

### 1. Clone and Setup Backend

```bash
# Clone the repository
git clone <your-repo-url>
cd saas-platform

# Install dependencies
cd server
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration
```

### 2. Database Setup

```bash
# Create PostgreSQL database
createdb browser_use_saas

# Run database schema
psql browser_use_saas < database/schema.sql

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://username:password@localhost:5432/browser_use_saas
```

### 3. Configure Environment Variables

Edit `server/.env`:

```env
# Required Configuration
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://username:password@localhost:5432/browser_use_saas
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production

# Optional (for full functionality)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:3000
```

### 4. Start Development Server

```bash
cd server
npm run dev
```

The API will be available at `http://localhost:3001`

### 5. Test the API

```bash
# Health check
curl http://localhost:3001/health

# Create a test user
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword123",
    "name": "Test User",
    "company": "Test Company"
  }'
```

## 🌐 Production Deployment

### Option A: Railway + Supabase (Recommended)

#### 1. Database Setup (Supabase)
1. Create Supabase project: https://supabase.com
2. Go to Settings → Database → Connection string
3. Run schema: Upload `database/schema.sql` via SQL Editor

#### 2. Backend Deployment (Railway)
1. Create Railway account: https://railway.app
2. Connect GitHub repository
3. Set environment variables in Railway dashboard:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
JWT_SECRET=[generate-strong-secret]
JWT_REFRESH_SECRET=[generate-strong-secret]
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://yourdomain.com
```

4. Deploy: Railway will auto-deploy from your main branch

#### 3. Frontend Deployment (Vercel)

Create React/Next.js dashboard:

```bash
npx create-next-app@latest browser-use-dashboard
cd browser-use-dashboard

# Configure to connect to your Railway API
# NEXT_PUBLIC_API_URL=https://your-railway-domain.railway.app
```

Deploy to Vercel:
```bash
npm install -g vercel
vercel --prod
```

### Option B: AWS/GCP/Azure

#### 1. Infrastructure Setup

**Database**: AWS RDS PostgreSQL or Google Cloud SQL
**Application**: EC2/Compute Engine with auto-scaling
**Load Balancer**: ALB/Cloud Load Balancer for HTTPS termination
**Redis**: ElastiCache/MemoryStore for sessions

#### 2. Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production

COPY server/ .

EXPOSE 3001
CMD ["npm", "start"]
```

Build and deploy:

```bash
# Build image
docker build -t browser-use-saas .

# Deploy to your container service
# (ECS, Cloud Run, Azure Container Apps)
```

### Option C: DigitalOcean App Platform

1. Create new app from GitHub repository
2. Configure build settings:
   - **Source Directory**: `server/`
   - **Build Command**: `npm install`
   - **Run Command**: `npm start`
3. Add PostgreSQL database add-on
4. Configure environment variables in dashboard

## 🔐 Security Checklist

### Authentication & Authorization
- ✅ JWT tokens with short expiration (15 minutes)
- ✅ Refresh token rotation
- ✅ Row-level security (RLS) on database
- ✅ API rate limiting (100 requests/15 minutes)
- ✅ Input validation and sanitization

### Infrastructure Security
- ✅ HTTPS/TLS encryption for all endpoints
- ✅ WSS (WebSocket Secure) for real-time connections
- ✅ Environment variables for sensitive data
- ✅ Database connection pooling with SSL
- ✅ CORS configuration for frontend domains

### Data Protection
- ✅ Bcrypt password hashing (12 rounds)
- ✅ API key storage in system keychain (worker apps)
- ✅ Multi-tenant data isolation
- ✅ Audit logging for sensitive operations

## 📊 Monitoring & Analytics

### Application Monitoring

Add to your deployment:

```bash
# Install monitoring dependencies
npm install @sentry/node express-prometheus-middleware

# Add to server.js
const Sentry = require('@sentry/node');
const promMiddleware = require('express-prometheus-middleware');

Sentry.init({ dsn: process.env.SENTRY_DSN });

app.use(promMiddleware({
  metricsPath: '/metrics',
  collectDefaultMetrics: true,
}));
```

### Database Monitoring

Monitor key metrics:
- Connection pool usage
- Query performance (slow queries >100ms)
- Database size and growth
- Failed authentication attempts

### Business Metrics

Track in `usage_metrics` table:
- Daily/monthly active users
- Task completion rates
- Worker utilization
- Revenue metrics (via Stripe webhooks)

## 💳 Billing Integration

### Stripe Setup

1. Create Stripe products:

```bash
# Free Plan
stripe products create --name="Free Plan" --description="2 workers, 100 tasks/month"
stripe prices create --product=prod_xxx --currency=usd --unit-amount=0 --billing-scheme=per_unit --lookup-key=free

# Pro Plan
stripe products create --name="Pro Plan" --description="10 workers, 1000 tasks/month"
stripe prices create --product=prod_xxx --currency=usd --unit-amount=2900 --billing-scheme=per_unit --lookup-key=pro --recurring-interval=month

# Team Plan
stripe products create --name="Team Plan" --description="50 workers, 10000 tasks/month"
stripe prices create --product=prod_xxx --currency=usd --unit-amount=9900 --billing-scheme=per_unit --lookup-key=team --recurring-interval=month
```

2. Configure webhook endpoint:
   - URL: `https://yourdomain.com/webhooks/stripe`
   - Events: `customer.subscription.*`, `invoice.payment_*`

### Usage Tracking

The platform automatically tracks:
- Worker connections
- Task completions
- API calls
- Payment events

## 📱 Worker App Distribution

### Building Electron Apps

```bash
cd worker-app

# Install dependencies
npm install

# Build for all platforms
npm run build:all

# Output:
# dist/Browser-Use-Worker-1.0.0.dmg (macOS)
# dist/Browser-Use-Worker-1.0.0.exe (Windows)
# dist/Browser-Use-Worker-1.0.0.AppImage (Linux)
```

### Distribution Strategy

1. **Website Downloads**: Host installers on your website
2. **Auto-updater**: Use `electron-updater` for seamless updates
3. **Code Signing**: Sign apps for Windows/macOS to avoid security warnings
4. **Version Management**: Maintain compatibility matrix between worker and platform versions

## 🔄 Customer Onboarding Flow

### 1. User Registration
```
Customer visits app.browseruse.com
→ Signs up with email/password
→ Workspace created automatically (e.g., "acme-corp")
→ Receives JWT tokens
→ Redirected to dashboard
```

### 2. Worker Setup
```
Customer downloads worker app for their OS
→ Enters workspace connection code (from dashboard)
→ Provides their OpenAI API key
→ Worker connects to platform via WebSocket
→ Appears in customer's dashboard
```

### 3. First Task
```
Customer creates task in web dashboard
→ Task queued and assigned to available worker
→ Worker executes using customer's API key
→ Results displayed in real-time dashboard
```

## 📈 Scaling Considerations

### Database Scaling
- **Vertical**: Increase CPU/RAM for PostgreSQL instance
- **Horizontal**: Read replicas for analytics queries
- **Partitioning**: Partition `tasks` and `task_logs` tables by date

### Application Scaling
- **Load Balancing**: Multiple API server instances behind load balancer
- **WebSocket Scaling**: Use Redis adapter for Socket.io clustering
- **Background Jobs**: Separate task processing from web serving

### Geographic Distribution
- **CDN**: CloudFlare for static assets and worker app downloads
- **Multi-region**: Deploy API servers in multiple regions
- **Database**: Regional read replicas for global performance

## 🐛 Troubleshooting

### Common Issues

#### Workers Not Connecting
1. Check WebSocket URL in worker configuration
2. Verify JWT token hasn't expired
3. Check firewall/proxy settings on customer network
4. Validate connection code hasn't expired

#### Tasks Not Executing
1. Verify worker has valid OpenAI API key
2. Check worker status (online/busy/offline)
3. Review task logs for error messages
4. Confirm worker capabilities match task requirements

#### Database Connection Issues
1. Check connection string format
2. Verify database server is accessible
3. Review connection pool settings
4. Check SSL certificate validity

### Debugging Commands

```bash
# Check API health
curl https://api.yourdomain.com/health

# View recent logs
docker logs your-container-name --tail=100

# Database connection test
psql $DATABASE_URL -c "SELECT NOW();"

# Check worker connection
wscat -c wss://ws.yourdomain.com/workers -H "Authorization: Bearer YOUR_TOKEN"
```

## 📚 API Documentation

Generate OpenAPI documentation:

```bash
npm install swagger-jsdoc swagger-ui-express

# Add to server.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const specs = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Browser Use API',
      version: '1.0.0',
    },
  },
  apis: ['./routes/*.js'],
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));
```

## 🎯 Go-to-Market

### Pricing Strategy
- **Free**: 2 workers, 100 tasks/month
- **Pro**: $29/month - 10 workers, 1000 tasks/month  
- **Team**: $99/month - 50 workers, 10000 tasks/month
- **Enterprise**: Custom pricing, unlimited workers

### Customer Acquisition
- **Developer Marketing**: GitHub, Hacker News, dev conferences
- **Content Marketing**: Automation tutorials, use case guides
- **Partner Channel**: Integration with Zapier, Make, n8n
- **Free Trial**: 30-day Pro trial for new users

## 📞 Support

### Customer Support Setup
- **Help Center**: Knowledge base with common issues
- **Email Support**: Technical support tickets
- **Community**: Discord/Slack for user community
- **Status Page**: Real-time platform status

### Success Metrics
- **MRR Growth**: Monthly recurring revenue
- **Churn Rate**: Customer retention
- **NPS Score**: Customer satisfaction
- **Worker Hours**: Platform utilization

---

🚀 **Ready to launch your Browser Use SaaS platform!**

Need help with deployment? Check our troubleshooting guide or reach out to our support team. 