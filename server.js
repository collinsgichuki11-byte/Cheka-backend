const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./db');
const authRoutes = require('./auth');
const videoRoutes = require('./videos');
const commentRoutes = require('./comments');
const notifRoutes = require('./notifications');
const uploadRoutes = require('./upload');
const followRoutes = require('./follows');
const userRoutes = require('./users');
const adminRoutes = require('./admin');
const messageRoutes = require('./messages');
const promptRoutes = require('./prompts');
const battleRoutes = require('./battles');
const monetizationRoutes = require('./monetization');

dotenv.config();
connectDB();

const app = express();

// Trust proxy (Render is behind a proxy)
app.set('trust proxy', 1);

// CORS — allow Vercel + custom domains + localhost. Anyone else gets blocked.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // mobile apps, curl, server-to-server
    try {
      const host = new URL(origin).hostname;
      if (
        host.endsWith('.vercel.app') ||
        host === 'cheka.co.ke' ||
        host.endsWith('.cheka.co.ke') ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.')
      ) {
        return cb(null, true);
      }
    } catch {}
    return cb(null, false);
  },
  credentials: true
}));

// Body size limit — prevent huge JSON DoS
app.use(express.json({ limit: '1mb' }));

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.get('/', (req, res) => {
  res.json({ msg: 'Cheka API is running 🔥' });
});

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/battles', battleRoutes);
app.use('/api/monetization', monetizationRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ msg: 'Route not found' }));

// Global error handler — never leak stack traces
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ msg: 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Cheka server running on port ${PORT}`));
