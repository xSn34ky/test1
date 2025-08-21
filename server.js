const express = require('express');
const Sequelize = require('sequelize');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use('/videos', express.static('videos'));  // Serve videos

// Sequelize setup
const sequelize = new Sequelize(`postgres://appuser:${process.env.DB_PASSWORD}@localhost:5432/videoapp`, {
  dialect: 'postgres',
});

// Models
const User = sequelize.define('User', {
  email: { type: Sequelize.STRING, unique: true },
  password: Sequelize.STRING,
  username: Sequelize.STRING,
  followers: { type: Sequelize.JSON, defaultValue: [] },
  following: { type: Sequelize.JSON, defaultValue: [] },
});

const Video = sequelize.define('Video', {
  url: Sequelize.STRING,
  caption: Sequelize.STRING,
  userId: Sequelize.INTEGER,
  likes: { type: Sequelize.INTEGER, defaultValue: 0 },
  views: { type: Sequelize.INTEGER, defaultValue: 0 },
  timestamp: Sequelize.DATE,
  recommendationsScore: { type: Sequelize.FLOAT, defaultValue: 0 },
});

const Comment = sequelize.define('Comment', {
  videoId: Sequelize.INTEGER,
  userId: Sequelize.INTEGER,
  text: Sequelize.STRING,
  timestamp: Sequelize.DATE,
});

// Relationships
User.hasMany(Video, { foreignKey: 'userId' });
Video.hasMany(Comment, { foreignKey: 'videoId' });
User.hasMany(Comment, { foreignKey: 'userId' });

// Multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'videos/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Middleware for auth
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).send('No token');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).send('Invalid token');
  }
};

// Initialize database
sequelize.sync({ force: false }).then(() => console.log('Database synced'));

// Routes with error handling
app.get('/videos', async (req, res) => {
  try {
    const videos = await Video.findAll({ order: [['timestamp', 'DESC']] });
    res.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/recommended', async (req, res) => {
  try {
    const videos = await Video.findAll({ order: [['recommendationsScore', 'DESC']], limit: 20 });
    res.json(videos);
  } catch (error) {
    console.error('Error fetching recommended videos:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, username });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({ token });
  } catch (error) {
    console.error('Error registering:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({ token });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/videos', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    const { caption } = req.body;
    const video = await Video.create({
      url: `/videos/${req.file.filename}`,
      caption,
      userId: req.user.id,
      timestamp: new Date(),
      recommendationsScore: 0,
    });
    res.json(video);
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/videos/:id/like', authMiddleware, async (req, res) => {
  try {
    const video = await Video.findByPk(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    video.likes += 1;
    video.recommendationsScore = video.likes + video.views / 10;
    await video.save();
    res.json(video);
  } catch (error) {
    console.error('Error liking video:', error);
    res.status(500).json({ error: 'Like failed' });
  }
});

app.get('/videos/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.findAll({ where: { videoId: req.params.id }, order: [['timestamp', 'DESC']] });
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Comments fetch failed' });
  }
});

app.post('/videos/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    const comment = await Comment.create({ videoId: req.params.id, userId: req.user.id, text, timestamp: new Date() });
    res.json(comment);
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ error: 'Comment failed' });
  }
});

app.get('/profile/:userId', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const videos = await Video.findAll({ where: { userId: req.params.userId } });
    res.json({ user, videos });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Profile fetch failed' });
  }
});

app.post('/duets', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    const { caption } = req.body;
    const video = await Video.create({
      url: `/videos/${req.file.filename}`,
      caption: caption + ' (Duet)',
      userId: req.user.id,
      timestamp: new Date(),
      recommendationsScore: 0,
    });
    res.json(video);
  } catch (error) {
    console.error('Error uploading duet:', error);
    res.status(500).json({ error: 'Duet upload failed' });
  }
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));