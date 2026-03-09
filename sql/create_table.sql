-- 创建数据库（避免中文乱码）
CREATE DATABASE IF NOT EXISTS scnu_library DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE scnu_library;

-- 创建用户表（存储账号密码）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '用户ID',
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  password VARCHAR(100) NOT NULL COMMENT '加密密码',
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) COMMENT '用户信息表';

-- 创建座位预约表（存储预约记录）
CREATE TABLE IF NOT EXISTS seats (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '预约记录ID',
  floor INT NOT NULL COMMENT '楼层',
  seat_num INT NOT NULL COMMENT '座位号',
  reserve_user VARCHAR(50) NOT NULL COMMENT '预约用户',
  reserve_date VARCHAR(20) NOT NULL COMMENT '预约日期',
  reserve_time VARCHAR(20) NOT NULL COMMENT '预约时段',
  UNIQUE KEY unique_seat_reserve (floor, seat_num, reserve_date, reserve_time)
) COMMENT '座位预约表';