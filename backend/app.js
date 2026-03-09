// 引入核心依赖
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// 初始化Express应用
const app = express();
const PORT = 3000;

// JWT密钥（可自定义，建议复杂一点）
const JWT_SECRET = 'scnu_library_2026_secret_key';
// JWT过期时间（2小时）
const JWT_EXPIRES_IN = '2h';

// 中间件配置
app.use(cors()); // 解决跨域
app.use(express.json()); // 解析JSON请求体

// 数据库配置（修改为你的MySQL密码）
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '123456', // 替换为你的MySQL密码
  database: 'scnu_library', // 数据库名
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ========== 核心中间件：验证Token ==========
const authMiddleware = (req, res, next) => {
  // 从请求头获取token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ code: 401, msg: '未登录或token无效' });
  }
  const token = authHeader.split(' ')[1];
  try {
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // 将用户信息挂载到req上
    next();
  } catch (err) {
    return res.json({ code: 401, msg: 'token过期，请重新登录' });
  }
};

// ========== 接口1：用户注册 ==========
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  // 校验参数
  if (!username || !password) {
    return res.json({ code: 400, msg: '账号或密码不能为空' });
  }
  if (password.length < 6) {
    return res.json({ code: 400, msg: '密码长度不能少于6位' });
  }
  // 检查账号是否已存在
  const checkSql = 'SELECT * FROM users WHERE username = ?';
  db.query(checkSql, [username], (err, results) => {
    if (err) {
      return res.json({ code: 500, msg: '数据库查询失败：' + err.message });
    }
    if (results.length > 0) {
      return res.json({ code: 400, msg: '该账号已存在，请更换账号' });
    }
    // 密码加密（盐值加密）
    const salt = bcrypt.genSaltSync(10);
    const hashPwd = bcrypt.hashSync(password, salt);
    // 插入新用户
    const insertSql = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(insertSql, [username, hashPwd], (err) => {
      if (err) {
        return res.json({ code: 500, msg: '注册失败：' + err.message });
      }
      res.json({ code: 200, msg: '注册成功' });
    });
  });
});

// ========== 接口2：用户登录 ==========
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // 校验参数
  if (!username || !password) {
    return res.json({ code: 400, msg: '账号或密码不能为空' });
  }
  // 查询用户
  const sql = 'SELECT * FROM users WHERE username = ?';
  db.query(sql, [username], (err, results) => {
    if (err) {
      return res.json({ code: 500, msg: '数据库查询失败：' + err.message });
    }
    if (results.length === 0) {
      return res.json({ code: 400, msg: '账号不存在' });
    }
    // 验证密码
    const user = results[0];
    const isPwdValid = bcrypt.compareSync(password, user.password);
    if (!isPwdValid) {
      return res.json({ code: 400, msg: '密码错误' });
    }
    // 生成JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    // 返回结果
    res.json({
      code: 200,
      msg: '登录成功',
      data: { token, username: user.username }
    });
  });
});

// ========== 接口3：获取座位列表（需要登录） ==========
app.get('/api/seats', authMiddleware, (req, res) => {
  const { floor, date, time } = req.query;
  const currentUser = req.user.username; // 当前登录用户

  // 校验参数
  if (!floor || !date || !time) {
    return res.json({ code: 400, msg: '参数不全，请选择楼层/日期/时段' });
  }

  // 楼层名称映射
  const floorNameMap = {
    1: '一楼自习区',
    2: '二楼自习区',
    3: '三楼自习区'
  };

  // 座位规则配置：按楼层定义数量和类型，同类型集中
  const seatConfig = {
    1: [
      // 一楼：前15个台灯座位，后5个圆桌（共20）
      ...Array(15).fill('台灯座'),
      ...Array(5).fill('圆桌')
    ],
    2: [
      // 二楼：前10个插头座位，后40个普通桌（共50）
      ...Array(10).fill('插头座'),
      ...Array(40).fill('普通桌')
    ],
    3: [
      // 三楼：前10个插头座位，后40个普通桌（共50）
      ...Array(10).fill('插头座'),
      ...Array(40).fill('普通桌')
    ]
  };

  // 查询该时段的座位预约情况
  const sql = `
    SELECT id, seat_num, reserve_user, reserve_date, reserve_time 
    FROM seats 
    WHERE floor = ? AND reserve_date = ? AND reserve_time = ?
  `;
  db.query(sql, [floor, date, time], (err, reserveResults) => {
    if (err) {
      return res.json({ code: 500, msg: '查询座位失败：' + err.message });
    }

    // 构造预约状态映射表
    const reserveMap = {};
    reserveResults.forEach(item => {
      reserveMap[item.seat_num] = {
        user: item.reserve_user,
        status: item.reserve_user === currentUser ? 2 : 1 // 2=自己已约（蓝），1=约满（红）
      };
    });

    // 生成座位列表（按配置生成）
    const seats = [];
    const seatTypes = seatConfig[floor];
    seatTypes.forEach((type, index) => {
      const seatNum = index + 1; // 座位号从1开始
      const reserveInfo = reserveMap[seatNum];
      seats.push({
        id: `${floor}_${seatNum}_${date}_${time}`, // 唯一座位ID
        floor: floor,
        seat_num: seatNum,
        seat_type: type, // 按配置显示类型（台灯/圆桌/插头/普通桌）
        status: reserveInfo ? reserveInfo.status : 0 // 0=可约（绿）
      });
    });

    // 返回结果
    res.json({
      code: 200,
      data: {
        floor_name: floorNameMap[floor],
        seats: seats
      }
    });
  });
});

// ========== 接口4：预约座位（需要登录）+ 最多2个限制 ==========
app.post('/api/reserve', authMiddleware, (req, res) => {
  const { seatId, date, time } = req.body;
  const currentUser = req.user.username;
  // 解析seatId中的楼层和座位号（格式：floor_seatNum_date_time）
  const [floor, seatNum] = seatId.split('_');

  // 校验参数
  if (!seatId || !date || !time) {
    return res.json({ code: 400, msg: '参数不全' });
  }

  // 第一步：查询该用户当前时段已预约的座位数（最多2个）
  const countSql = `
    SELECT COUNT(*) as count 
    FROM seats 
    WHERE reserve_user = ? AND reserve_date = ? AND reserve_time = ?
  `;
  db.query(countSql, [currentUser, date, time], (err, countResult) => {
    if (err) {
      return res.json({ code: 500, msg: '查询预约数量失败：' + err.message });
    }
    const reservedCount = countResult[0].count;
    // 超过2个则拒绝预约
    if (reservedCount >= 2) {
      return res.json({ code: 400, msg: '同一时段最多只能预约2个座位！' });
    }

    // 第二步：检查该座位是否已被预约
    const checkSql = `
      SELECT * FROM seats 
      WHERE floor = ? AND seat_num = ? AND reserve_date = ? AND reserve_time = ?
    `;
    db.query(checkSql, [floor, seatNum, date, time], (err, results) => {
      if (err) {
        return res.json({ code: 500, msg: '查询座位状态失败：' + err.message });
      }
      if (results.length > 0) {
        return res.json({ code: 400, msg: '该座位已约满，请选择其他座位' });
      }

      // 第三步：插入预约记录
      const insertSql = `
        INSERT INTO seats (floor, seat_num, reserve_user, reserve_date, reserve_time)
        VALUES (?, ?, ?, ?, ?)
      `;
      db.query(insertSql, [floor, seatNum, currentUser, date, time], (err) => {
        if (err) {
          return res.json({ code: 500, msg: '预约失败：' + err.message });
        }
        res.json({ code: 200, msg: '预约成功！' });
      });
    });
  });
});

// ========== 接口5：取消预约（需要登录） ==========
app.post('/api/cancel-reserve', authMiddleware, (req, res) => {
  const { seatId, date, time } = req.body;
  const currentUser = req.user.username;
  // 解析seatId中的楼层和座位号
  const [floor, seatNum] = seatId.split('_');

  // 校验参数
  if (!seatId || !date || !time) {
    return res.json({ code: 400, msg: '参数不全' });
  }

  // 检查该座位是否是当前用户预约的
  const checkSql = `
    SELECT * FROM seats 
    WHERE floor = ? AND seat_num = ? AND reserve_date = ? AND reserve_time = ? AND reserve_user = ?
  `;
  db.query(checkSql, [floor, seatNum, date, time, currentUser], (err, results) => {
    if (err) {
      return res.json({ code: 500, msg: '查询座位状态失败：' + err.message });
    }
    if (results.length === 0) {
      return res.json({ code: 400, msg: '该座位不是你预约的，无法取消' });
    }

    // 删除预约记录
    const deleteSql = `
      DELETE FROM seats 
      WHERE floor = ? AND seat_num = ? AND reserve_date = ? AND reserve_time = ? AND reserve_user = ?
    `;
    db.query(deleteSql, [floor, seatNum, date, time, currentUser], (err) => {
      if (err) {
        return res.json({ code: 500, msg: '取消预约失败：' + err.message });
      }
      res.json({ code: 200, msg: '取消预约成功！' });
    });
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器已启动，运行在 http://localhost:${PORT}`);
  console.log('所有接口已就绪：/api/register /api/login /api/seats /api/reserve /api/cancel-reserve');
});