const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

function auth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ msg: 'Invalid token' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) { req.user = null; return next(); }
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); }
  catch { req.user = null; }
  next();
}

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function requireValidId(paramName) {
  return (req, res, next) => {
    if (!isValidId(req.params[paramName])) {
      return res.status(400).json({ msg: 'Invalid ' + paramName });
    }
    next();
  };
}

module.exports = { auth, optionalAuth, isValidId, requireValidId };
