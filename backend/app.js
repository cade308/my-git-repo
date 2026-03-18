const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// 1. 跨域配置
app.use(cors({
  origin: "*",
  credentials: true
}));

// 2. 解析请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3. MySQL配置（替换为你的数据库信息）
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root', // 你的MySQL用户名
  password: '123456', // 你的MySQL密码
  database: 'scnu_library' // 已创建的数据库名
});

// 连接数据库
db.connect((err) => {
  if (err) {
    console.error('数据库连接失败：', err);
    return;
  }
  console.log('MySQL数据库连接成功！');
});

// 4. JWT配置（30分钟过期，避免频繁退出）
const JWT_SECRET = 'your_scnu_library_secret_key_2026';
const JWT_EXPIRES_IN = '1800s'; // 30分钟过期

// 5. 内存存储预约状态 + 用户预约数量
let reserveRecords = {}; // {seatId_date_time: {username, seatId, date, time}}
let userReserveCount = {}; // {username: count} 统计用户预约数

// 6. JWT验证中间件
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, msg: '登录状态已过期，请重新登录' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // 挂载用户信息
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, msg: '登录状态已过期，请重新登录' });
  }
};

// 7. 注册接口
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  // 检查账号是否存在
  const checkSql = 'SELECT * FROM users WHERE username = ?';
  db.query(checkSql, [username], (err, results) => {
    if (err) return res.status(500).json({ code: 500, msg: '数据库错误' });
    if (results.length > 0) {
      return res.json({ code: 400, msg: '账号已存在' });
    }
    // 插入新用户
    const insertSql = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(insertSql, [username, password], (err) => {
      if (err) return res.status(500).json({ code: 500, msg: '注册失败' });
      res.json({ code: 200, msg: '注册成功' });
    });
  });
});

// 8. 登录接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM users WHERE username = ? AND password = ?';
  db.query(sql, [username, password], (err, results) => {
    if (err) return res.status(500).json({ code: 500, msg: '数据库错误' });
    if (results.length === 0) {
      return res.json({ code: 400, msg: '账号或密码错误' });
    }
    // 生成Token
    const token = jwt.sign(
      { username: results[0].username, id: results[0].id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.json({
      code: 200,
      msg: '登录成功',
      data: { token, username: results[0].username }
    });
  });
});

// 9. 查询座位接口（核心修改：按楼层区分座位数量+类型）
app.get('/api/seats', verifyToken, (req, res) => {
  const { floor, date, time } = req.query;
  const floorName = `第${floor}楼自习区`;
  const seats = [];
  const currentUser = req.user.username;

  // 一楼：15个台灯桌 + 5个圆桌（共20个）
  if (floor === '1') {
    for (let i = 1; i <= 20; i++) {
      const key = `${i}_${date}_${time}`;
      let status = 0; // 0=可约
      // 自己预约的座位（蓝色）
      if (reserveRecords[key] && reserveRecords[key].username === currentUser) {
        status = 2;
      }
      // 他人预约的座位（红色）
      else if (reserveRecords[key]) {
        status = 1;
      }
      // 1-15=台灯桌，16-20=圆桌
      const seatType = i <= 15 ? '台灯桌' : '圆桌';
      seats.push({
        id: i,
        seat_num: i,
        seat_type: seatType,
        status: status
      });
    }
  }
  // 二楼/三楼：10个插头桌 + 20个普通桌（共30个）
  else if (floor === '2' || floor === '3') {
    for (let i = 1; i <= 30; i++) {
      const key = `${i}_${date}_${time}`;
      let status = 0; // 0=可约
      // 自己预约的座位（蓝色）
      if (reserveRecords[key] && reserveRecords[key].username === currentUser) {
        status = 2;
      }
      // 他人预约的座位（红色）
      else if (reserveRecords[key]) {
        status = 1;
      }
      // 1-10=插头桌，11-30=普通桌
      const seatType = i <= 10 ? '插头桌' : '普通桌';
      seats.push({
        id: i,
        seat_num: i,
        seat_type: seatType,
        status: status
      });
    }
  }

  res.json({
    code: 200,
    msg: '查询成功',
    data: { floor_name: floorName, seats }
  });
});

// 10. 预约座位接口（保留2个上限限制）
app.post('/api/reserve', verifyToken, (req, res) => {
  const { seatId, date, time } = req.body;
  const username = req.user.username;
  const key = `${seatId}_${date}_${time}`;

  // 统计当前用户已预约数量
  let userReserveNum = 0;
  Object.keys(reserveRecords).forEach(recordKey => {
    if (reserveRecords[recordKey].username === username) {
      userReserveNum++;
    }
  });

  // 最多预约2个
  if (userReserveNum >= 2) {
    return res.json({ code: 400, msg: '最多只能预约2个座位！' });
  }

  // 检查座位是否已被预约
  if (reserveRecords[key]) {
    return res.json({ code: 400, msg: '该座位已被预约' });
  }

  // 记录预约状态
  reserveRecords[key] = { username, seatId, date, time };
  res.json({ code: 200, msg: '预约成功' });
});

// 11. 取消预约接口
app.post('/api/cancel-reserve', verifyToken, (req, res) => {
  const { seatId, date, time } = req.body;
  const username = req.user.username;
  const key = `${seatId}_${date}_${time}`;

  // 检查是否是自己的预约
  if (!reserveRecords[key] || reserveRecords[key].username !== username) {
    return res.json({ code: 400, msg: '无法取消他人的预约！' });
  }

  // 删除预约记录
  delete reserveRecords[key];
  res.json({ code: 200, msg: '取消预约成功' });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`后端服务启动成功，运行在 http://localhost:${PORT}`);
});