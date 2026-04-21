const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

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

connectDB();

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ msg: 'Cheka API is running' });
});
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

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

// Catch-all 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ msg: 'Not found' }));

// Last-resort error handler so an uncaught throw never returns HTML.
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ msg: 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Cheka server running on port ' + PORT));
