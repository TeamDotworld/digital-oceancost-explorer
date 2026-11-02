const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const { RedisStore } = require('connect-redis');
const redis = require('redis');
const config = require('./config/config');
const authRoutes = require('./routes/auth');
const invoiceRoutes = require('./routes/invoices');
const dropletRoutes = require('./routes/droplets');
const networkRoutes = require('./routes/network');
const overviewRoutes = require('./routes/overview');
const wasteRoutes = require('./routes/waste');
const billingRoutes = require('./routes/billing');

const app = express();
app.set('trust proxy', 1);

// Initialize Redis client
const redisClient = redis.createClient({
  url: config.redis.url
});

// Connect to Redis
redisClient.connect().catch(console.error);

// Handle Redis connection events
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

// Apply helmet middleware for security
app.use(helmet());

// Print environment configuration (except secrets)
console.log('Environment Configuration:');
console.log('- Port:', config.port);
console.log('- Redirect URI:', config.redirectUri);
console.log('- Frontend URL:', config.frontendUrl);
console.log('- Client ID configured:', config.clientId ? 'Yes' : 'No');
console.log('- Client Secret configured:', config.clientSecret ? 'Yes' : 'No');
console.log('- Redis configured:', config.redis.url ? 'Yes' : 'No');

// Middleware
app.use(cors({
  origin: config.frontendUrl,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add this for form data

// Secure cookies only work over HTTPS; local dev runs on plain http://localhost
const useSecureCookies = config.frontendUrl ? config.frontendUrl.startsWith('https://') : true;

// Session configuration with Redis store
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'do-cost-explorer-secret',
  resave: false,
  saveUninitialized: false,
  name: 'do_cost_explorer_session',
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    maxAge: 45 * 24 * 60 * 60 * 1000, // 45 days
    path: '/', // Important: make cookie available across all paths
    sameSite: useSecureCookies ? 'none' : 'lax',
    domain: useSecureCookies && config.frontendUrl ? new URL(config.frontendUrl).hostname : undefined
  },
  proxy: true
}));

// Debug route to check if server is running
app.get('/api/healthcheck', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/droplets', dropletRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/waste', wasteRoutes);
app.use('/api/billing', billingRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler caught:', err);
  res.status(500).json({ 
    message: 'An unexpected error occurred',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(config.port, () => {
  console.log(`Backend server running on port ${config.port}`);
  console.log(`OAuth callback URL: ${config.redirectUri}`);
});