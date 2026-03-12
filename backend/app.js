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
app.use(cors()); // 解决跨域（允许所有前端域名访问）
app.use(express.json()); // 解析JSON请求体
app.use(express.urlencoded({ extended: true })); // 解析表单格式请求

// 数据库配置（你的root密码已设为123456）
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '123456', // 你的MySQL root密码
  database: 'scnu_library', // 数据库名
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true // 允许执行多条SQL语句（方便初始化数据库）
};

// 创建数据库连接池并测试连接
const db = mysql.createPool(dbConfig);

// 测试数据库连接 + 自动创建数据库（如果不存在）
db.getConnection((err, connection) => {
  if (err) {
    if (err.code === 'ER_BAD_DB_ERROR') {
      // 数据库不存在，先创建数据库
      const tempDb = mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        multipleStatements: true
      });

      tempDb.query(`
        CREATE DATABASE IF NOT EXISTS scnu_library DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        USE scnu_library;
        -- 创建用户表
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户ID',
          username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
          password VARCHAR(100) NOT NULL COMMENT '加密密码',
          create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
        ) COMMENT '用户信息表';
        -- 创建座位预约表
        CREATE TABLE IF NOT EXISTS seats (
          id INT AUTO_INCREMENT PRIMARY KEY COMMENT '预约记录ID',
          floor INT NOT NULL COMMENT '楼层',
          seat_num INT NOT NULL COMMENT '座位号',
          reserve_user VARCHAR(50) NOT NULL COMMENT '预约用户',
          reserve_date VARCHAR(20) NOT NULL COMMENT '预约日期',
          reserve_time VARCHAR(20) NOT NULL COMMENT '预约时段',
          UNIQUE KEY unique_seat_reserve (floor, seat_num, reserve_date, reserve_time)
        ) COMMENT '座位预约表';
      `, (createErr) => {
        if (createErr) {
          console.error('❌ 数据库初始化失败：', createErr.message);
          process.exit(1); // 退出进程
        }
        console.log('✅ 数据库scnu_library及表已自动创建（若不存在）');
        tempDb.end(); // 关闭临时连接

        // 重新连接创建好的数据库
        db.getConnection((reConnErr, reConn) => {
          if (reConnErr) {
            console.error('❌ 数据库重新连接失败：', reConnErr.message);
            process.exit(1);
          }
          console.log('✅ 数据库连接成功！');
          reConn.release(); // 释放连接
        });
      });
    } else {
      // 其他连接错误（如密码错误、MySQL未启动）
      console.error('❌ 数据库连接失败：', err.message);
      console.log('💡 排查建议：');
      console.log('   1. 确认MySQL服务已启动');
      console.log('   2. 确认root密码是123456（或修改代码中的password字段）');
      console.log('   3. 确认MySQL允许root本地登录');
      process.exit(1); // 退出进程
    }
  } else {
    console.log('✅ 数据库连接成功！');
    connection.release(); // 释放连接
  }
});

// ========== 核心中间件：验证Token ==========
const authMiddleware = (req, res, next) => {
  // 从请求头获取token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ code: 401, msg: '未登录或token无效，请先登录' });
  }
  const token = authHeader.split(' ')[1];
  try {
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // 将用户信息挂载到req上
    next();
  } catch (err) {
    return res.json({ code: 401, msg: 'token过期或无效，请重新登录' });
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
      res.json({ code: 200, msg: '注册成功，请登录' });
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
      return res.json({ code: 400, msg: '账号不存在，请先注册' });
    }
    // 验证密码
    const user = results[0];
    const isPwdValid = bcrypt.compareSync(password, user.password);
    if (!isPwdValid) {
      return res.json({ code: 400, msg: '密码错误，请重新输入' });
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

  // 校验楼层是否合法
  if (!seatConfig[floor]) {
    return res.json({ code: 400, msg: '楼层不存在（仅支持1/2/3楼）' });
  }

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
  if (!seatId || !date || !time || !floor || !seatNum) {
    return res.json({ code: 400, msg: '参数不全，请选择有效座位' });
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
  if (!seatId || !date || !time || !floor || !seatNum) {
    return res.json({ code: 400, msg: '参数不全，请选择有效座位' });
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
  console.log('=====================================');
  console.log(`✅ 服务器已启动，运行在 http://localhost:${PORT}`);
  console.log('📜 可用接口：');
  console.log('   - 注册：POST /api/register');
  console.log('   - 登录：POST /api/login');
  console.log('   - 获取座位：GET /api/seats（需登录）');
  console.log('   - 预约座位：POST /api/reserve（需登录）');
  console.log('   - 取消预约：POST /api/cancel-reserve（需登录）');
  console.log('💡 注意：确保MySQL服务已启动，密码为123456');
  console.log('=====================================');
});