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
  followers: { type: Sequelize.JSON, defaultValue: [] },  // Store as JSON for simplicity
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

// Routes
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ email, password: hashed, username });
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
  res.send({ token });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).send('Invalid credentials');
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
  res.send({ token });
});

app.get('/videos', async (req, res) => {
  const videos = await Video.findAll({ order: [['timestamp', 'DESC']] });
  res.send(videos);
});

app.get('/recommended', async (req, res) => {
  const videos = await Video.findAll({ order: [['recommendationsScore', 'DESC']], limit: 20 });
  res.send(videos);
});

app.post('/videos', authMiddleware, upload.single('video'), async (req, res) => {
  const { caption } = req.body;
  const video = await Video.create({
    url: `/videos/${req.file.filename}`,
    caption,
    userId: req.user.id,
    timestamp: new Date(),
    recommendationsScore: 0,
  });
  res.send(video);
});

app.post('/videos/:id/like', authMiddleware, async (req, res) => {
  const video = await Video.findByPk(req.params.id);
  video.likes += 1;
  video.recommendationsScore = video.likes + video.views / 10;
  await video.save();
  res.send(video);
});

app.get('/videos/:id/comments', async (req, res) => {
  const comments = await Comment.findAll({ where: { videoId: req.params.id }, order: [['timestamp', 'DESC']] });
  res.send(comments);
});

app.post('/videos/:id/comments', authMiddleware, async (req, res) => {
  const { text } = req.body;
  const comment = await Comment.create({ videoId: req.params.id, userId: req.user.id, text, timestamp: new Date() });
  res.send(comment);
});

app.get('/profile/:userId', async (req, res) => {
  const user = await User.findByPk(req.params.userId);
  const videos = await Video.findAll({ where: { userId: req.params.userId } });
  res.send({ user, videos });
});

app.post('/duets', authMiddleware, upload.single('video'), async (req, res) => {
  const { caption } = req.body;
  const video = await Video.create({
    url: `/videos/${req.file.filename}`,
    caption: caption + ' (Duet)',  // Simple duet marker
    userId: req.user.id,
    timestamp: new Date(),
    recommendationsScore: 0,
  });
  res.send(video);
});

app.listen(3000, '0.0.0.0', () => console.log('Server running on port 3000'));