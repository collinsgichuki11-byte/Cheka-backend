const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./User');

// ============================================
// Hardcoded owner — auto-promoted to admin on every login/signup
// ============================================
const OWNER_EMAIL = 'youanadanielle@gmail.com';

// Basic input validation
function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    let { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) return res.status(400).json({ msg: 'All fields are required' });
    username = String(username).trim();
    email = String(email).trim().toLowerCase();
    if (username.length < 3 || username.length > 24) return res.status(400).json({ msg: 'Username must be 3–24 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ msg: 'Username can only contain letters, numbers, and underscores' });
    if (!validateEmail(email)) return res.status(400).json({ msg: 'Please enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    if (password.length > 200) return res.status(400).json({ msg: 'Password too long' });

    // Check if user exists (email OR username)
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Username';
      return res.status(400).json({ msg: `${field} is already taken` });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Auto-promote the owner email to admin on signup
    const isAdmin = email === OWNER_EMAIL;

    // Create user
    const user = new User({ username, email, password: hashedPassword, isAdmin });
    await user.save();

    // Create token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin }
    });

  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ msg: 'Email and password are required' });
    email = String(email).trim().toLowerCase();

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    // Auto-promote owner email to admin on every login (defense in depth)
    if (email === OWNER_EMAIL && !user.isAdmin) {
      user.isAdmin = true;
      await user.save();
    }
    // Defense: demote anyone else who somehow has isAdmin=true
    if (email !== OWNER_EMAIL && user.isAdmin) {
      user.isAdmin = false;
      await user.save();
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, isAdmin: user.isAdmin }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
