const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
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

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ msg: 'Cheka API is running 🔥' });
});

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

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Cheka server running on port ${PORT}`));
