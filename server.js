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

app.use(cors());
app.use(express.json());

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Cheka server running on port ${PORT}`));
