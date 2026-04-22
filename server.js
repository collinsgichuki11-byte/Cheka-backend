const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

// Fail fast on missing critical config so deploys don't silently mis-behave.
['MONGO_URI', 'JWT_SECRET'].forEach(k => {
  if (!process.env[k]) {
    console.error('FATAL: missing env ' + k);
    process.exit(1);
  }
});

const connectDB = require('./db');
const authRoutes = require('./auth');
const videoRoutes = require('./videos');
const commentRoutes = require('./comments');
const notifRoutes = require('./notifications');
const followRoutes = require('./follows');
const uploadRoutes = require('./upload');
const messageRoutes = require('./messages');
const userRoutes = require('./users');
const adminRoutes = require('./admin');
const analyticsRoutes = require('./analytics');
const monetizationRoutes = require('./monetization');
const battleRoutes = require('./battles');
const promptRoutes = require('./prompts');
const reportRoutes = require('./reports');
const liveRoutes = require('./live');
const pushRoutes = require('./push');
const { mountLiveSignal } = require('./liveSignal');
const http = require('http');

connectDB();

const app = express();

// We sit behind Vercel/Render — trust the first proxy hop so req.ip and
// rate-limit keying use the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// Restrict CORS to known frontend origins. Configurable via CORS_ORIGINS
// (comma-separated). Localhost is always allowed for dev.
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173'
];
const allowedOrigins = new Set(
  DEFAULT_ORIGINS.concat(
    (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  )
);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl / server-to-server (no Origin header).
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Rate limits — applied to abuse-prone endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Too many attempts, please try again later' }
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Slow down — too many requests' }
});

app.get('/', (req, res) => {
  res.json({ msg: 'Cheka API is running' });
});
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Apply targeted rate limits before the route mounts.
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.post('/api/comments/:videoId', writeLimiter);
app.post('/api/messages/:userId', writeLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/monetization', monetizationRoutes);
app.use('/api/battles', battleRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/push', pushRoutes);

// Catch-all 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ msg: 'Not found' }));

// Last-resort error handler so an uncaught throw never returns HTML.
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ msg: 'Server error' });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
mountLiveSignal(server);
server.listen(PORT, () => console.log('Cheka server running on port ' + PORT));
