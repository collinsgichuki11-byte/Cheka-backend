const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { auth } = require('./lib/auth');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// GET signed upload params
router.get('/sign', auth, async (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder: 'cheka_videos', resource_type: 'video' },
      process.env.CLOUDINARY_API_SECRET
    );
    res.json({
      timestamp,
      signature,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
  } catch (err) {
    console.error('GET /upload/sign failed:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
