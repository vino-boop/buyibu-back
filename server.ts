import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { sendSmsCode, verifySmsCode } from './smsService.js';
import { handleJudgeStream, handleMultiPhilosopherStream, handleFinalAnalysis, handlePhilosopherIntro } from './philosophy_ai_routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// MySQL 连接配置（云服务器）
const pool = mysql.createPool({
  host: process.env.DB_HOST || '42.193.225.114',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Zhiming2024!',
  database: process.env.DB_NAME || 'buyibu',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

// ============================================================
// 数据库迁移 - 配额字段
// ============================================================
async function runMigrations() {
  const columns = [
    ['daily_tokens_remaining', 'INT DEFAULT 50'],
    ['last_daily_reset', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['monthly_tokens_remaining', 'INT DEFAULT 0'],
    ['last_monthly_reset', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['member_since', 'DATETIME DEFAULT NULL'],
  ];
  for (const [col, type] of columns) {
    try {
      await pool.query(`ALTER TABLE ik_accounts ADD COLUMN ${col} ${type}`);
      console.log(`[Migration] added column: ${col}`);
    } catch (err: any) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log(`[Migration] column already exists: ${col}`);
      } else {
        console.error(`[Migration] column ${col} error:`, err.message);
      }
    }
  }
  console.log('[Migration] ik_accounts quota columns ready');
}

// ============================================================
// 配额刷新工具函数
// ============================================================
/**
 * 检查并刷新用户配额（在每次扣减前调用）
 * - 普通用户：每日凌晨0点重置 50 先令
 * - 会员：每月同一天重置 1000 先令
 */
async function refreshUserQuota(userId: number, isMember: boolean): Promise<{dailyTokens: number, monthlyTokens: number}> {
  // 使用 UTC+8 计算中国日期
  const now = new Date();
  const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const chinaDateStr = utc8Time.toISOString().slice(0, 10); // 'YYYY-MM-DD' in UTC+8

  // 1. 查当前配额状态
  const [rows]: any = await pool.query(
    "SELECT daily_tokens_remaining, DATE_FORMAT(last_daily_reset, '%Y-%m-%d') as last_daily_reset, monthly_tokens_remaining, DATE_FORMAT(last_monthly_reset, '%Y-%m-%d') as last_monthly_reset, member_since FROM ik_accounts WHERE user_id = ?",
    [userId]
  );
  if (rows.length === 0) return { dailyTokens: 50, monthlyTokens: 1000 };

  const row = rows[0];
  const lastDailyReset: string = row.last_daily_reset ? String(row.last_daily_reset) : '';
  const lastMonthlyReset: string = row.last_monthly_reset ? String(row.last_monthly_reset) : '';
  const memberSince: string = row.member_since ? String(row.member_since) : '';

  let dailyTokens = row.daily_tokens_remaining ?? 50;
  let monthlyTokens = row.monthly_tokens_remaining ?? 1000;
  console.log(`[refreshUserQuota] userId=${userId} lastDailyReset=${lastDailyReset} lastDailyDate=${lastDailyReset.slice(0,10)} chinaDateStr=${chinaDateStr} rawDaily=${row.daily_tokens_remaining}`);

  // 2. 每日刷新（普通用户）- 仅当日期变化时才重置
  const lastDailyDate = lastDailyReset.slice(0, 10); // 数据库里的日期
  if (lastDailyDate !== chinaDateStr) {
    // 日期变了，重置每日配额
    dailyTokens = 50;
    await pool.query(
      'UPDATE ik_accounts SET daily_tokens_remaining = ?, last_daily_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\') WHERE user_id = ?',
      [dailyTokens, userId]
    );
  }

  // 3. 每月刷新（会员）
  if (isMember) {
    const lastMonthlyDate = lastMonthlyReset.slice(0, 7); // YYYY-MM
    const currentMonth = chinaDateStr.slice(0, 7); // YYYY-MM
    if (lastMonthlyDate !== currentMonth) {
      monthlyTokens = 1000; // 会员每月1000先令
      await pool.query(
        'UPDATE ik_accounts SET monthly_tokens_remaining = ?, last_monthly_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\') WHERE user_id = ?',
        [monthlyTokens, userId]
      );
    }
  }

  return { dailyTokens, monthlyTokens };
}

// ============================================================
// 定时配额刷新（每日凌晨检查所有用户）
// ============================================================
let lastDailyCheck = '';
setInterval(async () => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (lastDailyCheck === todayStr) return;
  lastDailyCheck = todayStr;

  try {
    // 重置所有普通用户每日额度
    await pool.query('UPDATE ik_accounts SET daily_tokens_remaining = 50, last_daily_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\')');
    // 重置所有会员每月额度（按成员加入日判断，每月对应日重置）
    await pool.query(`
      UPDATE ik_accounts ik
      JOIN all_accounts aa ON ik.user_id = aa.id
      SET ik.monthly_tokens_remaining = 1000, ik.last_monthly_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\')
      WHERE aa.philosophy = 'member' AND DAY(ik.member_since) = DAY(CURDATE())
    `);
    console.log(`[Cron] Quota refreshed at ${todayStr}`);
  } catch (err) {
    console.error('[Cron] Quota refresh error:', err);
  }
}, 60 * 60 * 1000); // 每小时检查一次

// 启动迁移
runMigrations();

// ============================================================
// 文件上传配置 (multer)
// ============================================================
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 静态文件访问 /uploads/*
app.use('/uploads', express.static(UPLOADS_DIR));

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // 使用原始文件名，支持中文
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Middleware
app.use(cors({
  origin: [
    'https://philosophy.vinolab.tech',
    'https://thinking.vinolab.tech',
    'https://www.vinolab.tech',
    'https://vinolab.tech',
    'https://yunhe.vinolab.tech',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

// 测试数据库连接
app.get('/api/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// ============================================================
// 总览模块 API - API Key 管理 (al_apikeys)
// ============================================================
app.get('/api/overview/apikeys', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM al_apikeys ORDER BY id DESC');
    res.json({ keys: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 根据模块名获取 API Key
app.get('/api/overview/apikey/:moduleName', async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      'SELECT api_key, full_key, module_name, remaining_amount, status FROM al_apikeys WHERE module_name = ? AND status = "active" LIMIT 1',
      [req.params.moduleName]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'API Key not found' });
    }
    res.json({
      api_key: rows[0].api_key,
      full_key: rows[0].full_key,
      module_name: rows[0].module_name,
      remaining_amount: rows[0].remaining_amount
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/overview/apikeys', async (req, res) => {
  try {
    const { module_name, api_key, full_key, used_amount, remaining_amount, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO al_apikeys (module_name, api_key, full_key, used_amount, remaining_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
      [module_name, api_key, full_key, used_amount || 0, remaining_amount || 0, status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM al_apikeys WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/overview/apikeys/:id', async (req, res) => {
  try {
    const { module_name, api_key, full_key, used_amount, remaining_amount, status } = req.body;
    await pool.query(
      'UPDATE al_apikeys SET module_name = ?, api_key = ?, full_key = ?, used_amount = ?, remaining_amount = ?, status = ? WHERE id = ?',
      [module_name, api_key, full_key, used_amount, remaining_amount, status, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM al_apikeys WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/overview/apikeys/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM al_apikeys WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 总览模块 API - 账号系统 (all_accounts)
// ============================================================
app.get('/api/overview/accounts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM all_accounts ORDER BY id DESC');
    res.json({ accounts: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/overview/accounts', async (req, res) => {
  try {
    const { name, philosophy, fortune, fengshui, status, role } = req.body;
    const [result] = await pool.query(
      'INSERT INTO all_accounts (name, philosophy, fortune, fengshui, status, role) VALUES (?, ?, ?, ?, ?, ?)',
      [name, philosophy || 'none', fortune || 'none', fengshui || 'none', status || 'normal', role || 'user']
    );
    const [rows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/overview/accounts/:id', async (req, res) => {
  try {
    const { name, philosophy, fortune, fengshui, status, role } = req.body;
    await pool.query(
      'UPDATE all_accounts SET name = ?, philosophy = ?, fortune = ?, fengshui = ?, status = ?, role = ? WHERE id = ?',
      [name, philosophy, fortune, fengshui, status, role, req.params.id]
    );

    // 会员开通：记录 member_since，并初始化每月配额
    if (philosophy === 'member') {
      const [ikRows]: any = await pool.query('SELECT member_since FROM ik_accounts WHERE user_id = ?', [req.params.id]);
      if (ikRows.length > 0 && !ikRows[0].member_since) {
        await pool.query(
          'UPDATE ik_accounts SET member_since = NOW(), monthly_tokens_remaining = 1000, last_monthly_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\') WHERE user_id = ?',
          [req.params.id]
        );
      }
    }

    const [rows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 总览模块 API - Token 用量
// ============================================================
app.get('/api/overview/token-usage', async (req, res) => {
  try {
    const [keys] = await pool.query('SELECT module_name, used_amount FROM al_apikeys');
    const total = keys.reduce((sum: number, k: any) => sum + (k.used_amount || 0), 0);
    res.json({
      total,
      breakdown: [
        { module: '哲思', usage: 1200000, color: '#2D5A75' },
        { module: '运何', usage: 450000, color: '#4FB3A5' },
        { module: '堪舆', usage: 120000, color: '#F27D26' },
      ],
      anomalies: [
        { id: 1, module: '哲思', type: '突发流量', time: '2024-03-20 14:20', status: 'processing', severity: 'high' },
      ]
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 哲学家库 (ik_philosophers)
// ============================================================
app.get('/api/philosophy/philosophers', async (req, res) => {
  try {
    const { mode } = req.query;
    let query = 'SELECT id, philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt as prompt, keywords, modes, status, lang_style, self_reference, example_terms FROM ik_philosophers';
    let params: any[] = [];
    
    if (mode) {
      // 根据模式筛选哲学家
      query += ' WHERE modes LIKE ? AND status = ?';
      params = [`%${mode}%`, 'active'];
    } else {
      query += ' WHERE status = ?';
      params = ['active'];
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ philosophers: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/philosophy/philosophers', async (req, res) => {
  try {
    const { philosopher_name, philosopher_era, description_text, system_prompt, keywords, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO ik_philosophers (philosopher_name, philosopher_era, description_text, system_prompt, keywords, status) VALUES (?, ?, ?, ?, ?, ?)',
      [philosopher_name, philosopher_era, description_text, system_prompt, JSON.stringify(keywords), status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM ik_philosophers WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/philosophy/philosophers/:id', async (req, res) => {
  try {
    const { philosopher_name, philosopher_era, description_text, system_prompt, keywords, status } = req.body;
    await pool.query(
      'UPDATE ik_philosophers SET philosopher_name = ?, philosopher_era = ?, description_text = ?, system_prompt = ?, keywords = ?, status = ? WHERE id = ?',
      [philosopher_name, philosopher_era, description_text, system_prompt, JSON.stringify(keywords), status, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM ik_philosophers WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/philosophy/philosophers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ik_philosophers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 问题库 (ik_questions)
// ============================================================
app.get('/api/philosophy/questions', async (req, res) => {
  try {
    const { mode } = req.query;
    let query = `SELECT id, question_content as content, philosopher_name as philosopher, mode, suggestions, usage_count, status, question_group, question_prompt, question_order FROM ik_questions`;
    let params: any[] = [];
    
    if (mode) {
      query += ' WHERE mode = ? AND status = ?';
      params = [mode, 'active'];
    } else {
      query += ' WHERE status = ?';
      params = ['active'];
    }
    
    query += ' ORDER BY question_group, question_order, usage_count DESC';
    const [rows] = await pool.query(query, params);
    
    // 解析 suggestions JSON 字段
    const parsedRows = rows.map((row: any) => ({
      ...row,
      suggestions: row.suggestions ? (typeof row.suggestions === 'string' ? JSON.parse(row.suggestions) : row.suggestions) : null
    }));
    
    res.json({ questions: parsedRows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/philosophy/questions', async (req, res) => {
  try {
    const { question_content, philosopher_name, mode, suggestions, usage_count, status, question_group, question_prompt, question_order } = req.body;
    const [result] = await pool.query(
      'INSERT INTO ik_questions (question_content, philosopher_name, mode, suggestions, usage_count, status, question_group, question_prompt, question_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [question_content, philosopher_name, mode, JSON.stringify(suggestions), usage_count || 0, status || 'active', question_group || null, question_prompt || null, question_order || 0]
    );
    const [rows] = await pool.query('SELECT * FROM ik_questions WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/philosophy/questions/:id', async (req, res) => {
  try {
    const { question_content, philosopher_name, mode, suggestions, usage_count, status, question_group, question_prompt, question_order } = req.body;
    await pool.query(
      'UPDATE ik_questions SET question_content = ?, philosopher_name = ?, mode = ?, suggestions = ?, usage_count = ?, status = ?, question_group = ?, question_prompt = ?, question_order = ? WHERE id = ?',
      [question_content, philosopher_name, mode, JSON.stringify(suggestions), usage_count, status, question_group || null, question_prompt || null, question_order || 0, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM ik_questions WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/philosophy/questions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ik_questions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 历史记录 (ik_user_conversations)
// ============================================================
app.get('/api/philosophy/history', async (req, res) => {
  try {
    const { user_id } = req.query;
    let query = 'SELECT * FROM ik_user_conversations';
    let params: any[] = [];
    
    if (user_id) {
      query += ' WHERE user_id = ?';
      params = [user_id];
    }
    
    query += ' ORDER BY created_at DESC LIMIT 100';
    const [rows] = await pool.query(query, params);
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/philosophy/history/:userId', async (req, res) => {
  try {
    // userId 可能是数字或字符串，都需要查询
    const userIdStr = String(req.params.userId);
    
    const [rows] = await pool.query(
      'SELECT * FROM ik_user_conversations WHERE user_id = ? ORDER BY created_at DESC', 
      [userIdStr]
    );
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 审判机配置 (ik_judge_config)
// ============================================================
app.get('/api/philosophy/judge-prompt', async (req, res) => {
  try {
    const { mode } = req.query;
    const lang = req.query.lang || 'zh';
    
    // 获取系统提示词
    const [systemRows] = await pool.query(
      "SELECT config_value FROM ik_judge_config WHERE config_key = ?",
      [`judge_system_prompt_${lang}`]
    );
    
    // 获取模式上下文
    const [contextRows] = await pool.query(
      "SELECT config_value FROM ik_judge_config WHERE config_key = ?",
      [`judge_context_${mode}`]
    );
    
    let systemPrompt = '';
    let context = '';
    
    try {
      if (systemRows.length > 0) {
        const parsed = typeof systemRows[0].config_value === 'string' 
          ? JSON.parse(systemRows[0].config_value) 
          : systemRows[0].config_value;
        systemPrompt = parsed?.content || '';
      }
    } catch (e) {
      console.error('Parse system prompt error:', e);
    }
    
    try {
      if (contextRows.length > 0) {
        const parsed = typeof contextRows[0].config_value === 'string' 
          ? JSON.parse(contextRows[0].config_value) 
          : contextRows[0].config_value;
        context = parsed?.[lang] || '';
      }
    } catch (e) {
      console.error('Parse context error:', e);
    }
    
    res.json({
      systemPrompt,
      context,
      mode
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取所有审判机配置
app.get('/api/philosophy/judge-config', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ik_judge_config');
    const config: Record<string, any> = {};
    for (const row of rows as any[]) {
      try {
        config[row.config_key] = typeof row.config_value === 'string' 
          ? JSON.parse(row.config_value) 
          : row.config_value;
      } catch (e) {
        console.error(`Parse error for ${row.config_key}:`, e);
        config[row.config_key] = row.config_value;
      }
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/philosophy/judge-prompt', async (req, res) => {
  try {
    const { prompt, rules } = req.body;
    const configValue = JSON.stringify({ prompt, rules });
    await pool.query(
      "INSERT INTO ik_judge_config (config_key, config_value) VALUES ('judge_prompt', ?) ON DUPLICATE KEY UPDATE config_value = ?",
      [configValue, configValue]
    );
    res.json({ success: true, message: '审判机配置已更新' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 用户信息 (使用 all_accounts + ik_accounts)
// ============================================================
app.get('/api/philosophy/users', async (req, res) => {
  try {
    // 从 all_accounts 获取用户列表
    const [accounts] = await pool.query('SELECT * FROM all_accounts ORDER BY id DESC');
    const [tokens] = await pool.query('SELECT * FROM ik_accounts');
    
    // 创建一个同时支持字符串和数字的 map
    const tokenMap = new Map();
    (tokens as any[]).forEach(t => {
      tokenMap.set(String(t.user_id), t);
      tokenMap.set(t.user_id, t); // 同时存数字key
    });
    
    const users = (accounts as any[]).map(a => {
      const tokenInfo = tokenMap.get(a.id) || tokenMap.get(String(a.id));
      return {
        userId: a.id,
        name: a.name,
        isMember: a.philosophy === 'member',
        tokenBalance: tokenInfo?.tokens ?? 0,
        questionSets: tokenInfo?.question_count || 0,
        status: a.philosophy === 'none' ? '未注册' : a.philosophy === 'error' ? '异常' : '正常',
        createdAt: a.created_at,
      };
    });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 运何模块 API (yh_fortune_*)
// ============================================================
app.get('/api/fortune/bazi', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_bazi ORDER BY created_at DESC');
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 保存八字记录
app.post('/api/fortune/bazi', async (req, res) => {
  try {
    const { user_id, name, gender, birth_date, birth_time, birth_place, chart_data, question, analysis } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_bazi (user_id, user_name, gender, birth_date, birth_time, birth_place, chart_data, question, analysis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, name || '', gender, birth_date, birth_time, birth_place || '', chart_data, question, analysis]
    );
    const [rows] = await pool.query('SELECT * FROM yh_fortune_bazi WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除八字记录
app.delete('/api/fortune/bazi/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM yh_fortune_bazi WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/fortune/liuyao', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_liuyao ORDER BY created_at DESC');
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 保存六爻记录
app.post('/api/fortune/liuyao', async (req, res) => {
  try {
    const { user_id, name, gender, question, hexagram_before, hexagram_after, hexagram_name, analysis } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_liuyao (user_id, name, gender, question, hexagram_before, hexagram_after, hexagram_name, analysis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, name, gender, question, hexagram_before, hexagram_after, hexagram_name, analysis]
    );
    const [rows] = await pool.query('SELECT * FROM yh_fortune_liuyao WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除六爻记录
app.delete('/api/fortune/liuyao/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM yh_fortune_liuyao WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取人格配置列表
app.get('/api/fortune/personalities', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_personalities WHERE is_active = 1');
    res.json({ personalities: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取指定人格配置
app.get('/api/fortune/personalities/:key', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_personalities WHERE personality_key = ?', [req.params.key]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Personality not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 运何模块账号管理 (yh_accounts)
app.get('/api/fortune/accounts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_accounts ORDER BY id DESC');
    res.json({ accounts: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/fortune/accounts', async (req, res) => {
  try {
    const { name, phone, password, status, role, gender, birth_date, birth_time, birth_place, personality } = req.body;
    
    // 默认 100 tokens
    const initialTokens = 100;
    
    // 1. 写入 yh_accounts 表（password, tokens 在此）
    const [yhResult] = await pool.query(
      'INSERT INTO yh_accounts (name, phone, password, tokens, status, role, gender, birth_date, birth_time, birth_place, personality, bazi_count, liuyao_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, phone || '', password || '', initialTokens, status || 'normal', role || 'user', gender || 'male', birth_date || '', birth_time || '12:00', birth_place || '', personality || 'MYSTIC', 0, 0]
    );
    
    const newUserId = yhResult.insertId;
    
    // 2. 同步写入 all_accounts 表（记录模块状态，不包含 password/tokens/phone）
    await pool.query(
      'INSERT INTO all_accounts (name, philosophy, fortune, fengshui, status, role) VALUES (?, ?, ?, ?, ?, ?)',
      [name, 'none', 'member', 'none', status || 'normal', role || 'user']
    );
    
    const [rows] = await pool.query('SELECT * FROM yh_accounts WHERE id = ?', [newUserId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/fortune/accounts/:id', async (req, res) => {
  try {
    const { name, phone, password, status, role, gender, birth_date, birth_time, birth_place, personality } = req.body;
    await pool.query(
      'UPDATE yh_accounts SET name = ?, phone = ?, password = ?, status = ?, role = ?, gender = ?, birth_date = ?, birth_time = ?, birth_place = ?, personality = ? WHERE id = ?',
      [name, phone, password || '', status, role, gender, birth_date, birth_time, birth_place, personality, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM yh_accounts WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/fortune/accounts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM yh_accounts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 运何模块 API Keys (复用 al_apikeys)

app.get('/api/fortune/apikeys', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM al_apikeys ORDER BY id DESC');
    res.json({ keys: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/fortune/apikeys', async (req, res) => {
  try {
    const { module_name, api_key, full_key, used_amount, remaining_amount, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO al_apikeys (module_name, api_key, full_key, used_amount, remaining_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
      [module_name, api_key, full_key, used_amount || 0, remaining_amount || 0, status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM al_apikeys WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/fortune/apikeys/:id', async (req, res) => {
  try {
    const { module_name, api_key, full_key, used_amount, remaining_amount, status } = req.body;
    await pool.query(
      'UPDATE al_apikeys SET module_name = ?, api_key = ?, full_key = ?, used_amount = ?, remaining_amount = ?, status = ? WHERE id = ?',
      [module_name, api_key, full_key, used_amount, remaining_amount, status, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM al_apikeys WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/fortune/apikeys/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM al_apikeys WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/fortune/explore', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_articles ORDER BY id DESC');
    res.json({ articles: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/fortune/explore', async (req, res) => {
  try {
    const { article_title, category_name, article_content, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_articles (article_title, category_name, article_content, status) VALUES (?, ?, ?, ?)',
      [article_title, category_name, article_content, status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM yh_fortune_articles WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/fortune/banners', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_banners ORDER BY sort_order ASC');
    res.json({ banners: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/fortune/banners', async (req, res) => {
  try {
    const { banner_title, banner_image, banner_link, sort_order, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_banners (banner_title, banner_image, banner_link, sort_order, status) VALUES (?, ?, ?, ?, ?)',
      [banner_title, banner_image, banner_link, sort_order || 0, status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM yh_fortune_banners WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 堪舆模块 API (fy_history)
// ============================================================
app.get('/api/fengshui/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM fy_accounts ORDER BY id DESC');
    res.json({ users: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/fengshui/history', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM fy_history ORDER BY created_at DESC');
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// ============================================================
// 认证模块 API - 众说/哲思 (使用 ik_accounts)
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // 从 ik_accounts 验证密码（ik_accounts 存有 password, tokens, user_id）
    const [rows] = await pool.query(
      'SELECT ik.*, aa.name, aa.philosophy, aa.fortune, aa.fengshui FROM ik_accounts ik LEFT JOIN all_accounts aa ON ik.user_id = aa.id WHERE ik.username = ? OR ik.phone = ?',
      [username, username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    const user = rows[0];
    
    // 验证密码
    if (user.password !== password) {
      return res.status(401).json({ error: '密码错误' });
    }
    
    // 登录时刷新配额
    const isMember = user.philosophy === 'member';
    const { dailyTokens, monthlyTokens } = await refreshUserQuota(user.user_id, isMember);

    res.json({
      success: true,
      user: {
        id: user.user_id,
        username: user.username,
        name: user.name,
        phone: user.phone,
        philosophy: user.philosophy,
        status: user.status || 'normal',  // normal / guest / member
        isMember,
        tokens: user.tokens || 100,
      },
      quota: {
        dailyLimit: 50,
        dailyRemaining: dailyTokens,
        monthlyLimit: 1000,
        monthlyRemaining: monthlyTokens
      },
      token: `ik_${user.user_id}_${Date.now()}`
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 检查手机号是否已注册
app.post('/api/auth/check-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: '手机号不能为空' });
    }
    const [rows] = await pool.query(
      'SELECT ik.id, ik.username, ik.user_id, aa.name FROM ik_accounts ik LEFT JOIN all_accounts aa ON ik.user_id = aa.id WHERE ik.phone = ?',
      [phone]
    );
    if (rows.length === 0) {
      return res.json({ exists: false });
    }
    const user = rows[0];
    // 判断是否为游客账号（用户名以 guest_ 开头且无密码）
    const isGuest = user.username && user.username.startsWith('guest_');
    res.json({ 
      exists: true, 
      isGuest,
      name: user.name || user.username || ''
    });
  } catch (err) {
    console.error('[check-phone] error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    
    // 检查用户名或手机号是否已存在于 ik_accounts
    if (username) {
      const [existUser] = await pool.query('SELECT id FROM ik_accounts WHERE username = ?', [username]);
      if (existUser.length > 0) {
        return res.status(400).json({ error: '用户名已注册' });
      }
    }
    if (phone) {
      const [existPhone] = await pool.query('SELECT id FROM ik_accounts WHERE phone = ?', [phone]);
      if (existPhone.length > 0) {
        return res.status(400).json({ error: '手机号已注册' });
      }
    }
    
    // 获取当前最大编号，生成默认用户名
    const [maxUser] = await pool.query('SELECT MAX(CAST(SUBSTRING(name, 5) AS UNSIGNED)) as maxNum FROM all_accounts WHERE name LIKE "哲思用户%"');
    const nextNum = (maxUser[0]?.maxNum || 0) + 1;
    const defaultName = `哲思用户${String(nextNum).padStart(3, '0')}`;
    
    // 默认 100 tokens
    const initialTokens = 100;
    
    // 判断用户类型：guest_ 前缀为游客，否则为普通用户
    const isGuest = username && username.startsWith('guest_');
    const userStatus = isGuest ? 'guest' : 'normal';
    
    // 1. 插入 all_accounts（记录模块状态，不包含 password/tokens/phone）
    const [aaResult] = await pool.query(
      'INSERT INTO all_accounts (name, philosophy, fortune, fengshui, status, role) VALUES (?, ?, ?, ?, ?, ?)',
      [defaultName, 'none', 'none', 'none', userStatus, 'user']
    );
    
    const userId = aaResult.insertId;
    
    // 2. 插入 ik_accounts（存 username, password, tokens, phone）
    await pool.query(
      'INSERT INTO ik_accounts (user_id, username, phone, password, tokens, status, daily_tokens_remaining, last_daily_reset) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_FORMAT(NOW(), \'%Y-%m-%d\'))',
      [userId, username || defaultName, phone || '', password || '', initialTokens, userStatus, 50]
    );
    
    res.json({ 
      success: true, 
      userId: userId,
      user: {
        id: userId,
        username: username || defaultName,
        phone: phone,
        status: userStatus,
        philosophy: 'none',
        isMember: false,
        tokens: initialTokens
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 短信模块 API
// ============================================================

// 发送短信验证码
app.post('/api/sms/send', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: '手机号不能为空' });
    }

    // 手机号格式校验（中国大陆）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }

    const result = await sendSmsCode(phone);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        // 开发环境返回code方便测试
        code: result.code
      });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('SMS send error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// 验证短信验证码
app.post('/api/sms/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: '手机号和验证码不能为空' });
    }

    const result = verifySmsCode(phone, code);

    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('SMS verify error:', error);
    res.status(500).json({ error: String(error) });
  }
})
// 手机验证码直接登录（验证通过后返回用户信息）
app.post('/api/auth/login-with-sms', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: '手机号和验证码不能为空' });
    }
    // 验证验证码
    const result = verifySmsCode(phone, code);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }
    // 验证通过，查用户信息并返回登录态
    const [rows] = await pool.query(
      'SELECT ik.*, aa.name, aa.philosophy FROM ik_accounts ik LEFT JOIN all_accounts aa ON ik.user_id = aa.id WHERE ik.phone = ?',
      [phone]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '用户不存在，请先注册' });
    }
    const user = rows[0];
    const isMember = user.philosophy === 'member';
    // 强制刷新配额
    const { dailyTokens, monthlyTokens } = await refreshUserQuota(user.user_id, isMember);
    // 获取永久余额
    const [ikRows]: any = await pool.query(
      'SELECT tokens FROM ik_accounts WHERE user_id = ?', [user.user_id]
    );
    const currentTokens = ikRows.length > 0 ? (ikRows[0].tokens || 0) : 0;
    res.json({
      success: true,
      user: {
        id: user.user_id,
        username: user.username,
        phone: user.phone,
        tokens: currentTokens,
      },
      tokens: currentTokens,
      quota: {
        dailyLimit: 50,
        dailyRemaining: dailyTokens,
        monthlyLimit: 1000,
        monthlyRemaining: monthlyTokens
      }
    });
  } catch (error) {
    console.error('login-with-sms error:', error);
    res.status(500).json({ error: String(error) });
  }
});

;

// ============================================================
// 认证模块 API - 运何 (使用 yh_accounts，前缀 /api/yunhe/auth/*)
// ============================================================
app.post('/api/yunhe/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // 直接从 yh_accounts 验证密码（yh_accounts 存有 password, tokens, phone）
    const [rows] = await pool.query(
      'SELECT y.*, a.name as account_name, a.fortune, a.fengshui FROM yh_accounts y LEFT JOIN all_accounts a ON y.phone = a.phone WHERE y.phone = ? OR y.name = ?',
      [username, username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    
    const user = rows[0];
    
    // 验证密码
    if (user.password !== password) {
      return res.status(401).json({ error: '密码错误' });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        tokens: user.tokens || 100,
        fortune: user.fortune || 'none',
        fengshui: user.fengshui || 'none',
        gender: user.gender || 'male',
        birth_date: user.birth_date || '',
        birth_time: user.birth_time || '12:00',
        birth_place: user.birth_place || '',
        personality: user.personality || 'MYSTIC',
        bazi_count: user.bazi_count || 0,
        liuyao_count: user.liuyao_count || 0
      },
      token: `yunhe_${user.id}_${Date.now()}`
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/yunhe/auth/register', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    
    // 检查手机号是否已存在于 yh_accounts
    if (phone) {
      const [existPhone] = await pool.query('SELECT id FROM yh_accounts WHERE phone = ?', [phone]);
      if (existPhone.length > 0) {
        return res.status(400).json({ error: '手机号已注册' });
      }
    }
    
    // 获取当前最大编号，生成默认用户名
    const [maxUser] = await pool.query('SELECT MAX(CAST(SUBSTRING(name, 5) AS UNSIGNED)) as maxNum FROM yh_accounts WHERE name LIKE "运何用户%"');
    const nextNum = (maxUser[0]?.maxNum || 0) + 1;
    const defaultName = `运何用户${String(nextNum).padStart(3, '0')}`;
    
    // 默认 100 tokens
    const initialTokens = 100;
    
    // 1. 插入 yh_accounts（包含 password, tokens, phone）
    const [yhResult] = await pool.query(
      'INSERT INTO yh_accounts (name, phone, password, tokens, status, role, gender, birth_date, birth_time, birth_place, personality, bazi_count, liuyao_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultName, phone || '', password || '', initialTokens, 'normal', 'user', 'male', '', '12:00', '', 'MYSTIC', 0, 0]
    );
    
    const userId = yhResult.insertId;
    
    // 2. 插入 all_accounts（记录模块状态，不包含 password/tokens/phone）
    await pool.query(
      'INSERT INTO all_accounts (name, philosophy, fortune, fengshui, status, role) VALUES (?, ?, ?, ?, ?, ?)',
      [defaultName, 'none', 'member', 'none', 'normal', 'user']
    );
    
    res.json({
      success: true,
      userId: userId,
      user: {
        id: userId,
        name: defaultName,
        phone: phone,
        tokens: initialTokens
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 运何模块 - 用户 Tokens 管理 (使用 yh_accounts)
// ============================================================
app.post('/api/yunhe/tokens', async (req, res) => {
  try {
    const { userId, amount, action } = req.body;
    
    const [rows] = await pool.query('SELECT tokens FROM yh_accounts WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    let currentTokens = rows[0].tokens || 0;
    let newTokens = currentTokens;
    
    if (action === 'deduct') {
      newTokens = currentTokens - amount;
    } else if (action === 'add') {
      newTokens = currentTokens + amount;
    } else if (action === 'set') {
      newTokens = amount;
    }
    
    if (newTokens < 0) newTokens = 0;
    
    await pool.query('UPDATE yh_accounts SET tokens = ? WHERE id = ?', [newTokens, userId]);
    
    res.json({ success: true, tokens: newTokens });
  } catch (error) {
    console.error('Token update error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 用户信息 (使用 ik_accounts + all_accounts)
// ============================================================
app.get('/api/philosophy/user/:userId', async (req, res) => {
  try {
    const [aaRows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [req.params.userId]);
    const aaUser = aaRows.length > 0 ? aaRows[0] : null;
    const isMember = aaUser?.philosophy === 'member';

    // 刷新配额
    const { dailyTokens, monthlyTokens } = await refreshUserQuota(parseInt(req.params.userId), isMember);

    // 从 ik_accounts 获取 tokens
    const [ikRows] = await pool.query(
      'SELECT tokens, conversation_count, daily_tokens_remaining, monthly_tokens_remaining, member_since FROM ik_accounts WHERE user_id = ?',
      [req.params.userId]
    );
    const ikUser = ikRows.length > 0 ? ikRows[0] : null;

    if (!ikUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({
      id: aaUser?.id || req.params.userId,
      name: aaUser?.name || '',
      phone: ikUser?.phone || '',
      philosophy: aaUser?.philosophy || 'normal',
      isMember,
      tokens: ikUser?.tokens ?? 0,
      // 配额信息
      quota: {
        dailyLimit: 50,
        dailyRemaining: dailyTokens,
        monthlyLimit: 1000,
        monthlyRemaining: monthlyTokens,
        memberSince: ikUser?.member_since || null,
        lastDailyReset: ikUser?.last_daily_reset || null,
        lastMonthlyReset: ikUser?.last_monthly_reset || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 手动刷新配额（前端页面加载时调用）
// GET /api/philosophy/user/:userId/quota
// ============================================================
app.get('/api/philosophy/user/:userId/quota', async (req, res) => {
  try {
    const rawUserId = req.params.userId;
    const userIdNum = parseInt(rawUserId);
    // 判断是否为纯数字 userId（用于从 ik_accounts 反查 numeric user_id）
    const isPureNumeric = /^\d+$/.test(rawUserId) && !isNaN(userIdNum);

    let isMember = false;
    let currentTokens = 0;
    let dailyTokens = 0;
    let monthlyTokens = 0;

    if (isPureNumeric) {
      // numeric id：直接查 all_accounts（会员状态）和 ik_accounts（永久余额）
      const [aaRows]: any = await pool.query(
        'SELECT philosophy FROM all_accounts WHERE id = ?', [userIdNum]
      );
      if (aaRows.length > 0) {
        isMember = aaRows[0].philosophy === 'member';
      }
      const [ikRows]: any = await pool.query(
        'SELECT tokens FROM ik_accounts WHERE user_id = ?', [userIdNum]
      );
      if (ikRows.length > 0) {
        currentTokens = ikRows[0].tokens || 0;
      }
      const quota = await refreshUserQuota(userIdNum, isMember);
      dailyTokens = quota.dailyTokens;
      monthlyTokens = quota.monthlyTokens;
    } else {
      // username / phone：先从 ik_accounts 反查 numeric user_id
      const [ikRows]: any = await pool.query(
        'SELECT user_id FROM ik_accounts WHERE username = ? OR phone = ?', [rawUserId, rawUserId]
      );
      if (ikRows.length > 0) {
        const numericUserId = ikRows[0].user_id;
        const [aaRows]: any = await pool.query(
          'SELECT philosophy FROM all_accounts WHERE id = ?', [numericUserId]
        );
        if (aaRows.length > 0) {
          isMember = aaRows[0].philosophy === 'member';
        }
        const [tokensRows]: any = await pool.query(
          'SELECT tokens FROM ik_accounts WHERE user_id = ?', [numericUserId]
        );
        if (tokensRows.length > 0) {
          currentTokens = tokensRows[0].tokens || 0;
        }
        const quota = await refreshUserQuota(numericUserId, isMember);
        dailyTokens = quota.dailyTokens;
        monthlyTokens = quota.monthlyTokens;
      }
    }

    res.json({
      success: true,
      isMember,
      tokens: currentTokens,
      quota: {
        dailyLimit: 50,
        dailyRemaining: dailyTokens,
        monthlyLimit: 1000,
        monthlyRemaining: monthlyTokens
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 更新用户 tokens（更新 ik_accounts）
// action: deduct = 扣减, add = 增加, set = 设置余额
app.post('/api/philosophy/user/tokens', async (req, res) => {
  try {
    const { userId, tokens, action } = req.body;

    // 获取用户会员状态（从 all_accounts，如果不存在则默认非会员）
    const [aaRows]: any = await pool.query('SELECT philosophy FROM all_accounts WHERE id = ?', [userId]);
    const isMember = aaRows.length > 0 && aaRows[0].philosophy === 'member';

    // 刷新配额（自动处理每日/月度重置）
    const { dailyTokens, monthlyTokens } = await refreshUserQuota(userId, isMember);
    console.log(`[updateTokens] userId=${userId} action=${action} tokens=${tokens} isMember=${isMember} dailyTokens=${dailyTokens} monthlyTokens=${monthlyTokens}`);

    // 获取当前 tokens
    const [rows]: any = await pool.query('SELECT * FROM ik_accounts WHERE user_id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const user = rows[0];
    let currentTokens = user.tokens || 0;
    let currentDailyQuota = dailyTokens;
    let currentMonthlyQuota = monthlyTokens;

    if (action === 'deduct') {
      // 扣除优先级: daily -> monthly (仅会员) -> permanent
      const totalAvailable = dailyTokens + (isMember ? monthlyTokens : 0) + currentTokens;
      if (totalAvailable < tokens) {
        return res.status(403).json({
          error: '先令不足',
          tokens: currentTokens,
          quotaRemaining: dailyTokens,
          required: tokens,
          insufficient: true
        });
      }

      let newDaily = dailyTokens;
      let newMonthly = monthlyTokens;
      let newPerm = currentTokens;

      if (dailyTokens >= tokens) {
        // 情况1：只扣每日配额
        newDaily = dailyTokens - tokens;
      } else if (isMember && dailyTokens + monthlyTokens >= tokens) {
        // 情况2：会员，扣每日 + 每月
        const fromDaily = dailyTokens;
        const fromMonthly = tokens - dailyTokens;
        newDaily = 0;
        newMonthly = monthlyTokens - fromMonthly;
      } else if (!isMember && dailyTokens + currentTokens >= tokens) {
        // 情况3：非会员，扣每日 + 永久余额
        const fromDaily = dailyTokens;
        const fromPerm = tokens - dailyTokens;
        newDaily = 0;
        newPerm = currentTokens - fromPerm;
      } else {
        // 情况4：会员，扣每日 + 每月 + 永久余额
        const fromDaily = dailyTokens;
        const fromMonthly = monthlyTokens;
        const fromPerm = tokens - dailyTokens - monthlyTokens;
        newDaily = 0;
        newMonthly = 0;
        newPerm = currentTokens - fromPerm;
      }

      // 批量更新数据库
      if (newDaily !== dailyTokens) {
        await pool.query('UPDATE ik_accounts SET daily_tokens_remaining = ? WHERE user_id = ?', [newDaily, userId]);
      }
      if (isMember && newMonthly !== monthlyTokens) {
        await pool.query('UPDATE ik_accounts SET monthly_tokens_remaining = ? WHERE user_id = ?', [newMonthly, userId]);
      }
      if (newPerm !== currentTokens) {
        await pool.query('UPDATE ik_accounts SET tokens = ? WHERE user_id = ?', [newPerm, userId]);
      }

      return res.json({
        success: true,
        tokens: newPerm,
        quota: {
          dailyLimit: 50,
          dailyRemaining: newDaily,
          monthlyLimit: 1000,
          monthlyRemaining: newMonthly,
        },
        totalRemaining: newDaily + newMonthly + newPerm,
      });
    } else if (action === 'add') {
      // 增加：只加余额（购买/捐赠获得的先令进余额）
      const newTokens = currentTokens + tokens;
      await pool.query('UPDATE ik_accounts SET tokens = ? WHERE user_id = ?', [newTokens, userId]);
      return res.json({
        success: true,
        tokens: newTokens,
        quotaRemaining: quotaToUse,
        source: 'balance'
      });
    } else if (action === 'set') {
      // 设置余额
      await pool.query('UPDATE ik_accounts SET tokens = ? WHERE user_id = ?', [tokens, userId]);
      return res.json({ success: true, tokens });
    }

    res.json({ success: true, tokens: currentTokens });
  } catch (error) {
    console.error('Token update error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 哲学家 Prompt
// ============================================================
app.get('/api/philosophy/prompts/philosopher', async (req, res) => {
  try {
    const { mode } = req.query;
    let query = 'SELECT philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt, keywords, modes, lang_style, self_reference, example_terms FROM ik_philosophers WHERE status = ?';
    let params: any[] = ['active'];
    
    if (mode) {
      query += ' AND modes LIKE ?';
      params.push(`%${mode}%`);
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ prompts: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取单个哲学家详情
app.get('/api/philosophy/prompts/philosopher/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt, keywords, modes, lang_style, self_reference, example_terms FROM ik_philosophers WHERE id = ?',
      [req.params.id]
    );
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Philosopher not found' });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 保存对话历史
// ============================================================
app.post('/api/philosophy/history', async (req, res) => {
  try {
    const { user_id, user_name, session_id, messages, mode, is_member, result } = req.body;
    
    // 如果传入的是 messages 数组，提取最后的问题和回答
    let judge_question = '';
    let user_answer = '';
    let philosopher_response = '';
    let philosopher_name = '';
    let token_count = 0;
    let round = 1;
    
    if (messages && Array.isArray(messages)) {
      // 获取用户最后的问题和AI的回答
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
      const lastAIMsg = messages.filter((m: any) => m.role === 'assistant').pop();
      judge_question = lastUserMsg?.content || '';
      user_answer = lastAIMsg?.content || '';
    }
    
    // 从 result 中获取更多信息
    if (result) {
      philosopher_name = result.philosopher || philosopher_name;
      token_count = result.tokens || token_count;
    }
    
    // 获取当前会话的最大轮次
    const [existingRows]: any = await pool.query(
      'SELECT MAX(round) as maxRound FROM ik_user_conversations WHERE session_id = ?',
      [session_id]
    );
    round = (existingRows[0]?.maxRound || 0) + 1;
    
    // 保存到 ik_user_conversations 表
    const [resultInsert] = await pool.query(
      'INSERT INTO ik_user_conversations (user_id, session_id, mode, round, judge_question, user_answer, philosopher_response) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user_id, session_id, mode || 'chat', round, judge_question, user_answer, philosopher_response]
    );
    res.json({ success: true, id: resultInsert.insertId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 运何模块 - 用户八字
// ============================================================
app.get('/api/fortune/bazi/:userId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_bazi WHERE user_id = ? ORDER BY created_at DESC', [req.params.userId]);
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 保存八字记录
app.post('/api/fortune/bazi', async (req, res) => {
  try {
    const { user_id, name, gender, birth_date, birth_time, birth_place, chart_data, analysis } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_bazi (user_id, user_name, gender, birth_date, birth_time, birth_place, chart_data, analysis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, name, gender, birth_date, birth_time, birth_place, chart_data, analysis]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除八字记录
app.delete('/api/fortune/bazi/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM yh_fortune_bazi WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 运何模块 - 用户六爻
// ============================================================
app.get('/api/fortune/liuyao/:userId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_liuyao WHERE user_id = ? ORDER BY created_at DESC', [req.params.userId]);
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 保存六爻记录
app.post('/api/fortune/liuyao', async (req, res) => {
  try {
    const { user_id, name, gender, question, hexagram_data, analysis } = req.body;
    const [result] = await pool.query(
      'INSERT INTO yh_fortune_liuyao (user_id, user_name, gender, question, hexagram_data, analysis) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, name, gender, question, hexagram_data, analysis]
    );
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除六爻记录
app.delete('/api/fortune/liuyao/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM yh_fortune_liuyao WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 堪舆模块 - 用户历史
// ============================================================
app.get('/api/fengshui/history/:userId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM fy_history WHERE user_id = ? ORDER BY created_at DESC', [req.params.userId]);
    res.json({ records: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 用户历史记录列表 (包含报告)
// ============================================================
// 获取用户的所有历史记录和报告
app.get('/api/philosophy/user-histories/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const userIdNum = parseInt(req.params.userId);
    // 判断 userId 是否为纯数字（用于二次查询 numeric id）
    // 注意：字符串用户名如 '13800138000' 也会通过 isNaN 检查，但不应作为 numeric id 查询
    // 用正则严格判断是否为纯数字：全部是0-9的字符
    const isPureNumeric = /^\d+$/.test(userId);
    const limit = 50; // 最多50条

    // 获取历史记录（使用 ik_user_conversations 表）
    // 优先按 string userId 查询，再按 numeric id 查询（用于 username 为纯数字的情况）
    // GROUP BY session_id 取每个会话最新的记录用于显示标题
    // 使用窗口函数取每个 session 最新 round 的记录
    const historyBase = `
      SELECT latest.session_id, latest.mode, latest.round, latest.judge_question, latest.user_answer, latest.philosopher_response, latest.created_at,
        a.title, a.summary
      FROM (
        SELECT session_id, mode, round, judge_question, user_answer, philosopher_response, created_at,
          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY round DESC) as rn
        FROM ik_user_conversations WHERE user_id = ?
      ) latest
      LEFT JOIN ik_analysis_reports a ON latest.session_id = a.session_id
      WHERE rn = 1
      ORDER BY latest.created_at DESC
      LIMIT ?
    `;
    let historyParams: any[] = [userId, limit];
    let historyRows: any[];
    if (isPureNumeric) {
      // 纯数字 userId：分别查询 string 和 numeric，再手动合并去重
      const [rows1]: any = await pool.query(historyBase, [userId, limit]);
      const [rows2]: any = await pool.query(historyBase, [userIdNum, limit]);
      // 合并并按时间排序
      const merged = [...rows1, ...rows2];
      merged.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      historyRows = merged.slice(0, limit);
    } else {
      const [rows]: any = await pool.query(historyBase, historyParams);
      historyRows = rows;
    }

    // 获取分析报告
    let reportQuery = 'SELECT session_id, mode, title, summary, philosophical_trend, created_at FROM ik_analysis_reports WHERE user_id = ?';
    let reportParams: any[] = [userId];
    if (isPureNumeric) {
      reportQuery = 'SELECT session_id, mode, title, summary, philosophical_trend, created_at FROM ik_analysis_reports WHERE user_id = ? OR user_id = ?';
      reportParams = [userId, userIdNum];
    }
    reportQuery += ' ORDER BY created_at DESC LIMIT ?';
    reportParams.push(limit);
    const [reportRows] = await pool.query(reportQuery, reportParams);
    
    // 构建会话ID列表
    const sessionsWithReports = new Set((reportRows as any[]).map(r => r.session_id));
    
    // 提取问题标题（从【】中提取，如"【永恒轮回的按钮】"）
    const extractQuestionTitle = (judgeQuestion: string): string => {
      if (!judgeQuestion) return '';
      const match = judgeQuestion.match(/【([^】]+)】/);
      return match ? `【${match[1]}】` : judgeQuestion.slice(0, 30);
    };

    // 合并历史记录，标记是否有报告
    const history = (historyRows as any[]).map(h => ({
      sessionId: h.session_id,
      mode: h.mode,
      questionCount: h.round || 1,
      // 提取问题标题用于展示，如"【永恒轮回的按钮】"
      questionTitle: extractQuestionTitle(h.judge_question),
      createdAt: h.created_at,
      hasReport: sessionsWithReports.has(h.session_id)
    }));
    
    // 去重并按时间排序
    const uniqueHistory = history.reduce((acc: any[], h) => {
      if (!acc.find(a => a.sessionId === h.sessionId)) {
        acc.push(h);
      }
      return acc;
    }, []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
    
    console.log('[getUserHistories] userId:', userId, 'historyRows:', historyRows.length);
    res.json({ 
      history: uniqueHistory,
      reports: (reportRows as any[]).map(r => ({
        ...r,
        createdAt: r.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 对话历史详细记录 (ik_user_conversations)
// ============================================================
// 保存对话（每个session只有一行，对话内容以JSON格式存储）
app.post('/api/conversations', async (req, res) => {
  try {
    const { user_id, session_id, mode, round, judge_question, user_answer, philosopher_response, conversation_json } = req.body;
    
    // 检查是否已存在该session的记录
    const [existingRows]: any = await pool.query(
      'SELECT id, conversation_json FROM ik_user_conversations WHERE session_id = ? LIMIT 1',
      [session_id]
    );
    
    if (existingRows.length > 0) {
      // 已存在：更新对话JSON，追加新的问答
      const existingJson = existingRows[0].conversation_json ? JSON.parse(existingRows[0].conversation_json) : [];
      const newExchange = {
        round: round || 1,
        judge_question,
        user_answer,
        philosopher_response,
        timestamp: Date.now()
      };
      // 尝试更新已存在的 round（防止重复），没有则追加
      const existingIndex = existingJson.findIndex((e: any) => e.round === (round || 1));
      if (existingIndex >= 0) {
        existingJson[existingIndex] = { ...existingJson[existingIndex], judge_question, user_answer, philosopher_response, timestamp: Date.now() };
      } else {
        existingJson.push(newExchange);
      }
      
      await pool.query(
        'UPDATE ik_user_conversations SET conversation_json = ?, mode = COALESCE(?, mode), round = ?, judge_question = ?, user_answer = ?, philosopher_response = ? WHERE session_id = ?',
        [JSON.stringify(existingJson), mode, round || existingJson.length, judge_question, user_answer, philosopher_response, session_id]
      );
      res.json({ success: true, id: existingRows[0].id, updated: true });
    } else {
      // 不存在：插入新记录
      const conversationData = [{
        round: round || 1,
        judge_question,
        user_answer,
        philosopher_response,
        timestamp: Date.now()
      }];
      
      const [result] = await pool.query(
        'INSERT INTO ik_user_conversations (user_id, session_id, mode, round, judge_question, user_answer, philosopher_response, conversation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user_id, session_id, mode, round || 1, judge_question || '', user_answer || '', philosopher_response || '', JSON.stringify(conversationData)]
      );
      res.json({ success: true, id: result.insertId, inserted: true });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取对话历史列表
app.get('/api/conversations', async (req, res) => {
  try {
    const { user_id, session_id, mode, created_after } = req.query;
    let query = 'SELECT * FROM ik_user_conversations';
    const conditions: string[] = [];
    let params: any[] = [];
    
    if (session_id) {
      // 优先用 session_id 查询（忽略 user_id，session_id 全局唯一）
      conditions.push('session_id = ?');
      params.push(session_id);
    } else if (user_id) {
      conditions.push('user_id = ?');
      params.push(user_id);
    }
    
    if (mode) {
      conditions.push('mode = ?');
      params.push(mode);
    }
    
    if (created_after) {
      conditions.push('created_at >= ?');
      params.push(new Date(Number(created_after)));
    }
    
    if (conditions.length === 0) {
      return res.status(400).json({ error: 'user_id, session_id, or mode is required' });
    }
    
    query += ' WHERE ' + conditions.join(' AND ');
    
    if (session_id) {
      query += ' ORDER BY round ASC';
    } else {
      query += ' ORDER BY created_at DESC';
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ conversations: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 分析报告 (ik_analysis_reports)
// ============================================================
// 保存分析报告
app.post('/api/reports', async (req, res) => {
  try {
    const { user_id, session_id, mode, title, summary, philosophical_trend, key_insights, suggested_paths, motto, dimensions, raw_data } = req.body;
    
    const [result] = await pool.query(
      'INSERT INTO ik_analysis_reports (user_id, session_id, mode, title, summary, philosophical_trend, key_insights, suggested_paths, motto, dimensions, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, session_id, mode, title, summary, philosophical_trend, JSON.stringify(key_insights), JSON.stringify(suggested_paths), motto, JSON.stringify(dimensions), raw_data]
    );
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 获取分析报告
app.get('/api/reports', async (req, res) => {
  try {
    const { user_id, session_id } = req.query;
    let query = 'SELECT * FROM ik_analysis_reports';
    let params: any[] = [];
    
    if (session_id) {
      query += ' WHERE session_id = ? ORDER BY created_at DESC LIMIT 1';
      params = [session_id];
    } else if (user_id) {
      query += ' WHERE user_id = ? ORDER BY created_at DESC';
      params = [user_id];
    } else {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const [rows] = await pool.query(query, params);
    res.json({ reports: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// AI 对话接口
// ============================================================
app.post('/api/ai/deepseek', async (req, res) => {
  try {
    const { messages, philosopher } = req.body;
    
    // 获取 API Key - 从数据库读取
    const [keys] = await pool.query("SELECT * FROM al_apikeys WHERE module_name = '哲思' AND status = 'active' LIMIT 1");
    if (keys.length === 0) {
      return res.status(500).json({ error: 'API Key not configured' });
    }
    const apiKey = keys[0].full_key;
    
    // 调用 DeepSeek API
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7
      })
    });
    
    const data = await response.json();
    
    // 更新 API Key 使用量
    const tokensUsed = data.usage?.total_tokens || 0;
    if (keys && keys.length > 0) {
      await pool.query('UPDATE al_apikeys SET used_amount = used_amount + ? WHERE id = ?', [tokensUsed, keys[0].id]);
    }
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲学家一对一对话 API
// ============================================================

// 构建哲学家 system prompt（从数据库字段拼接）
function buildPhilosopherSystemPrompt(row: any, lang: string): string {
  const isZh = lang === 'zh';
  const { display_name_zh, display_name_en, system_prompt, lang_style, self_reference, example_terms } = row;
  const name = isZh ? (display_name_zh || display_name_en) : display_name_en;

  if (isZh) {
    let prompt = '';
    // 优先使用数据库 system_prompt，其次用 lang_style
    if (system_prompt) {
      prompt = system_prompt.trim();
    }
    if (lang_style) {
      prompt += `\n\n【语言风格强制要求】\n${lang_style}`;
    }
    if (self_reference) {
      prompt += `\n【自称要求】\n${self_reference}`;
    }
    if (example_terms) {
      let terms: string[];
      try { terms = JSON.parse(example_terms); } catch { terms = [example_terms]; }
      prompt += `\n【专有术语】\n请在对话中尽量使用以下术语（带原文）：\n${terms.join('；')}`;
    }
    prompt += `\n\n【对话要求】
1. 以${name}的哲学思想和说话风格与用户对话
2. 可以加入适当的动作和神态描写（用括号）
3. 不要暴露自己是AI的身份
4. 回复简洁有力，1-3句话为宜`;
    return prompt;
  } else {
    let prompt = system_prompt ? system_prompt.trim() : `You are ${name}, a great philosopher.`;
    if (lang_style) {
      prompt += `\n\n[Language Style - Strictly Follow]\n${lang_style}`;
    }
    if (self_reference) {
      prompt += `\n[Self-Reference]\n${self_reference}`;
    }
    if (example_terms) {
      let terms: string[];
      try { terms = JSON.parse(example_terms); } catch { terms = [example_terms]; }
      prompt += `\n[Key Terms]\nPlease use these terms with original text when appropriate:\n${terms.join('; ')}`;
    }
    prompt += `\n\n[Requirements]
1. Speak as ${name}
2. You may include action descriptions in brackets
3. Do not reveal you are an AI
4. Keep responses concise, 1-3 sentences`;
    return prompt;
  }
}

// 获取哲学家语言风格（供前端拼 prompt 用）
app.get('/api/philosophy/philosopher-styles', async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      'SELECT philosopher_name as name, display_name_zh as nameZh, lang_style, self_reference, example_terms FROM ik_philosophers WHERE status = \'active\''
    );
    const styles: Record<string, any> = {};
    for (const row of rows) {
      if (row.lang_style || row.self_reference || row.example_terms) {
        styles[row.name] = {
          name: row.name,
          nameZh: row.nameZh || row.name,
          langStyle: row.lang_style || '',
          selfReference: row.self_reference || '',
          exampleTerms: row.example_terms ? (() => { try { return JSON.parse(row.example_terms); } catch { return []; } })() : []
        };
      }
    }
    res.json({ ok: true, styles });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/philosophy/philosopher-chat', async (req, res) => {
  try {
    const { philosopher, message, history = [], lang = 'zh' } = req.body;

    if (!philosopher || !message) {
      return res.status(400).json({ error: 'Missing philosopher or message' });
    }

    // 从数据库查询哲学家记录
    const [rows]: any = await pool.query(
      'SELECT display_name_zh, display_name_en, system_prompt, lang_style, self_reference, example_terms FROM ik_philosophers WHERE philosopher_name = ? OR display_name_zh = ? LIMIT 1',
      [philosopher, philosopher]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Philosopher not found: ${philosopher}` });
    }

    // 获取 API Key
    const [keys]: any = await pool.query(
      "SELECT * FROM al_apikeys WHERE module_name = '哲思' AND status = 'active' LIMIT 1"
    );
    if (keys.length === 0) {
      return res.status(500).json({ error: 'API Key not configured' });
    }
    const apiKey = keys[0].full_key;

    // 构建 system prompt
    const systemPrompt = buildPhilosopherSystemPrompt(rows[0], lang);

    // 构建消息列表
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      })),
      { role: 'user', content: message }
    ];

    // 调用 DeepSeek API（流式）
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        stream: true,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek API: ${errorText}` });
    }

    // 将 DeepSeek 的流式响应透传给前端（SSE）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      return res.status(500).json({ error: 'Failed to read response stream' });
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          res.write(line + '\n');
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('[philosopher-chat] error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - AI 流式对话（迁移自前端，保护 API Key 和 Prompt）
// ============================================================

app.post('/api/philosophy/judge-stream', (req, res) => handleJudgeStream(req, res, pool));

app.post('/api/philosophy/multi-philosopher-stream', (req, res) => handleMultiPhilosopherStream(req, res, pool));

app.post('/api/philosophy/final-analysis', (req, res) => handleFinalAnalysis(req, res, pool));

app.post('/api/philosophy/philosopher-intro', (req, res) => handlePhilosopherIntro(req, res, pool));

// ============================================================
// 文件上传/管理 API
// ============================================================

// 上传文件
app.post('/api/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    res.json({
      success: true,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 列出所有上传文件
app.get('/api/uploads', async (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR).map(filename => {
      const filepath = path.join(UPLOADS_DIR, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        url: `/uploads/${filename}`,
        size: stats.size,
        created: stats.birthtime
      };
    });
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 删除文件
app.delete('/api/uploads/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(UPLOADS_DIR, filename);
    
    // 安全检查：防止目录遍历攻击
    if (!filepath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: '非法文件名' });
    }
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    
    fs.unlinkSync(filepath);
    res.json({ success: true, filename });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 支付宝支付模块（原生 HTTPS + HMAC-SHA256，不依赖 alipay-sdk）
// ============================================================
const ALIPAY_APP_ID = process.env.ALIPAY_APP_ID || '2021006144645771';
const ALIPAY_PRIVATE_KEY = process.env.ALIPAY_PRIVATE_KEY || '';
const ALIPAY_PUBLIC_KEY = process.env.ALIPAY_PUBLIC_KEY || '';
const ALIPAY_GATEWAY = process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
const ALIPAY_ENCRYPT_KEY = process.env.ALIPAY_ENCRYPT_KEY || ''; // AES key for content encryption (32 chars = 256bit)
const ALIPAY_CONTENT_ENCRYPT = process.env.ALIPAY_CONTENT_ENCRYPT === 'true'; // 是否启用内容加密

// 统一私钥格式：处理 PKCS8 / PKCS1 / 裸 base64
// crypto.createSign 在 Node.js 20+ 需要正确格式
function normalizePrivateKey(key: string): string {
  if (!key || key.trim() === '') return '';
  // 去掉 < > 包裹
  let trimmed = key.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1);
  }
  // 已经有 PEM 头，直接返回
  if (trimmed.includes('-----BEGIN')) return trimmed;
  // 裸 base64：判断是 PKCS8 还是 PKCS1
  // PKCS8 特征：开头是 MIIEvAIBADAN...（DER Tag: 30 77 或类似）
  // PKCS1 特征：开头是 MIIBAQAB... 或 MIIBIjAN...
  // 简单判断：MIIEvAIBADA 是 PKCS8，MIIBIjAN 是 PKCS1
  const isPKCS8 = trimmed.startsWith('MIIEvAIBADA') || trimmed.startsWith('MIIEvQIBAA');
  const header = isPKCS8 ? '-----BEGIN PRIVATE KEY-----' : '-----BEGIN RSA PRIVATE KEY-----';
  const footer = isPKCS8 ? '-----END PRIVATE KEY-----' : '-----END RSA PRIVATE KEY-----';
  return `${header}\n${trimmed.match(/.{1,64}/g)?.join('\n')}\n${footer}`;
}

// 统一公钥格式
function normalizePublicKey(key: string): string {
  if (!key || key.trim() === '') return '';
  let trimmed = key.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    trimmed = trimmed.slice(1, -1);
  }
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) return trimmed;
  if (trimmed.includes('-----BEGIN RSA PUBLIC KEY-----')) {
    return trimmed.replace('-----BEGIN RSA PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----')
                   .replace('-----END RSA PUBLIC KEY-----', '-----END PUBLIC KEY-----');
  }
  // 裸 base64 公钥
  return `-----BEGIN PUBLIC KEY-----\n${trimmed.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
}

// 格式化时间为北京时区（支付宝要求 yyyy-MM-dd HH:mm:ss）
function formatShanghaiTime(date: Date): string {
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const shanghai = new Date(utc + 8 * 60 * 60 * 1000);
  const y = shanghai.getFullYear();
  const m = String(shanghai.getMonth() + 1).padStart(2, '0');
  const d = String(shanghai.getDate()).padStart(2, '0');
  const h = String(shanghai.getHours()).padStart(2, '0');
  const min = String(shanghai.getMinutes()).padStart(2, '0');
  const s = String(shanghai.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

// AES 加解密（用于支付宝内容加密模式）
// key: Buffer（16/24/32字节分别对应 AES-128/192/256）
// iv: AES 初始向量（base64）
function aesEncrypt(data: string, key: Buffer): { encrypted: string, iv: string } {
  const iv = crypto.randomBytes(16);
  const algMap: Record<number, string> = { 16: 'aes-128-cbc', 24: 'aes-192-cbc', 32: 'aes-256-cbc' };
  const algorithm = algMap[key.length];
  if (!algorithm) throw new Error(`Invalid AES key length: ${key.length} bytes`);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return { encrypted, iv: iv.toString('base64') };
}

function aesDecrypt(encryptedData: string, key: Buffer, iv: string): string {
  const algMap: Record<number, string> = { 16: 'aes-128-cbc', 24: 'aes-192-cbc', 32: 'aes-256-cbc' };
  const algorithm = algMap[key.length];
  if (!algorithm) throw new Error(`Invalid AES key length: ${key.length} bytes`);
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'base64'));
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// 支付宝签名
function alipaySign(params: Record<string, string>, pemKey: string): string {
  const sorted = Object.keys(params).sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  console.log('[Alipay] Sign string:', sorted.substring(0, 200));
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(sorted);
  return sign.sign(pemKey, 'base64');
}

// 异步 POST 到支付宝
async function alipayPost(method: string, bizContent: Record<string, string>): Promise<any> {
  const https = await import('https');

  const params: Record<string, string> = {
    app_id: ALIPAY_APP_ID,
    method,
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatShanghaiTime(new Date()),
    version: '1.0',
  };

  // 内容加密模式：用固定的 AES key 加密 biz_content
  if (ALIPAY_CONTENT_ENCRYPT && ALIPAY_ENCRYPT_KEY) {
    params.encrypt_type = 'AES';
    // 直接用配置的 AES key（Base64 解码）
    const aesKey = Buffer.from(ALIPAY_ENCRYPT_KEY, 'base64');
    const { encrypted: encryptedBiz, iv } = aesEncrypt(JSON.stringify(bizContent), aesKey);
    // 支付宝期望格式：biz_content = {"bizContent":"加密内容","iv":"初始向量"}
    params.biz_content = JSON.stringify({
      bizContent: encryptedBiz,
      iv: iv,
    });
  } else {
    params.biz_content = JSON.stringify(bizContent);
  }

  params.sign = await signAlipay(params);

  const body = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = new URL(ALIPAY_GATEWAY);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          // 支付宝返回的是 a=b&c=d 格式
          const result: Record<string, string> = {};
          data.split('&').forEach(pair => {
            const [k, ...rest] = pair.split('=');
            if (k) result[decodeURIComponent(k)] = decodeURIComponent(rest.join('=')) || '';
          });

          // 内容加密模式：解密响应中的 msg 字段
          // 支付宝返回: msg=AES(AES-key, JSON), 用固定的 AES key 解密
          if (ALIPAY_CONTENT_ENCRYPT && ALIPAY_ENCRYPT_KEY && result.encrypt_type === 'AES' && result.msg) {
            try {
              const encryptedMsg = result.msg;
              // 直接用配置的 AES key 解密
              const aesKey = Buffer.from(ALIPAY_ENCRYPT_KEY, 'base64');
              // msg 是 base64 编码的 JSON: {"bizContent":"...","iv":"..."}
              const msgObj = JSON.parse(Buffer.from(encryptedMsg, 'base64').toString('utf8'));
              const decrypted = aesDecrypt(msgObj.bizContent, aesKey, msgObj.iv);
              // 解析解密后的 JSON，找到 _response 字段
              const decryptedObj = JSON.parse(decrypted);
              const respKey = Object.keys(decryptedObj).find(k => k.endsWith('_response'));
              if (respKey) {
                result[respKey] = decryptedObj[respKey];
              }
              // 也直接放 decryptedObj 方便调试
              result._decrypted = decryptedObj;
              console.log('[Alipay] Response decrypted:', decrypted.substring(0, 200));
            } catch (e) {
              console.error('[Alipay] Decrypt response error:', e);
            }
          }

          resolve(result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * POST /api/payment/alipay/create
 * 创建支付宝订单，返回支付链接（用户扫码）或跳转链接
 */
app.post('/api/payment/alipay/create', async (req, res) => {
  try {
    const { orderNo, amount, subject, userId } = req.body;

    if (!orderNo || !amount || !subject) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 扫码支付用 alipay.trade.precreate（生成二维码 URL）
    const rawResult = await alipayPost('alipay.trade.precreate', {
      outTradeNo: orderNo,
      totalAmount: String(amount),
      subject: subject,
    });

    console.log('[Alipay] precreate result:', JSON.stringify(rawResult));

    // 解析响应：alipay_trade_precreate_response.qr_code
    let qrCode = '';
    try {
      const respKey = Object.keys(rawResult).find(k => k.endsWith('_response'));
      if (respKey) {
        const resp = JSON.parse(rawResult[respKey] || '{}');
        qrCode = resp.qr_code || '';
      }
    } catch (e) {
      console.error('[Alipay] parse error:', e);
    }

    // 记录订单到数据库
    try {
      await pool.query(
        `INSERT INTO al_orders (order_no, user_id, amount, subject, status, payment_method, created_at)
         VALUES (?, ?, ?, ?, 'pending', 'alipay', NOW())
         ON DUPLICATE KEY UPDATE amount = ?, updated_at = NOW()`,
        [orderNo, userId || null, amount, subject, amount]
      );
    } catch (dbErr) {
      console.error('[Alipay] Order DB write error:', dbErr);
    }

    res.json({ success: true, payUrl: qrCode, orderNo });
  } catch (err: any) {
    console.error('[Alipay] Create error:', err);
    res.status(500).json({ error: err.message || '支付创建失败' });
  }
});

/**
 * POST /api/payment/alipay/notify
 * 支付宝异步回调通知（最关键！）
 * 支付成功后支付宝会 POST 到这个地址
 */
app.post('/api/payment/alipay/notify', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const params: Record<string, string> = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    // 内容加密模式：解密 msg 字段
    // 支付宝通知格式: msg=AES(AES-key, {"bizContent":"...","iv":"..."})
    let notifyData = { ...params };
    if (params.encrypt_type === 'AES' && params.msg && ALIPAY_ENCRYPT_KEY) {
      try {
        // 直接用配置的 AES key 解密
        const aesKey = Buffer.from(ALIPAY_ENCRYPT_KEY, 'base64');
        // 解码 msg（base64 → JSON）
        const msgObj = JSON.parse(Buffer.from(params.msg, 'base64').toString('utf8'));
        // AES解密 bizContent
        const decrypted = aesDecrypt(msgObj.bizContent, aesKey, msgObj.iv);
        const decryptedObj = JSON.parse(decrypted);
        // 用解密后的数据替换（trade_no, out_trade_no 等关键字段在解密内容中）
        notifyData = { ...notifyData, ...decryptedObj };
        console.log('[Alipay] Notify decrypted:', JSON.stringify(decryptedObj).substring(0, 200));
      } catch (e) {
        console.error('[Alipay] Notify decrypt error:', e);
        return res.status(400).send('fail');
      }
    }

    // 手动验签
    const { sign, ...rest } = notifyData;
    const signType = notifyData.sign_type;
    if (sign && signType === 'RSA2') {
      const pubKey = normalizePublicKey(ALIPAY_PUBLIC_KEY);
      if (!pubKey) {
        console.error('[Alipay] ALIPAY_PUBLIC_KEY not configured');
        return res.status(400).send('fail');
      }
      const sorted = Object.keys(rest).sort()
        .filter(k => k !== 'sign')
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(rest[k])}`)
        .join('&');
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(sorted);
      const valid = verifier.verify(pubKey, sign, 'base64');
      if (!valid) {
        console.error('[Alipay] Notify verify failed, signature mismatch');
        return res.status(400).send('fail');
      }
    }

    const { out_trade_no, trade_no, trade_status, total_amount } = notifyData;
    console.log(`[Alipay] Notify: ${out_trade_no} status=${trade_status} amount=${total_amount}`);

    // 支付成功
    if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
      // 查询订单
      const [orders]: any = await pool.query('SELECT * FROM al_orders WHERE order_no = ?', [out_trade_no]);
      if (orders.length === 0) {
        console.error('[Alipay] Order not found:', out_trade_no);
        return res.send('fail');
      }
      const order = orders[0];

      if (order.status === 'pending') {
        // 更新订单状态
        await pool.query(
          'UPDATE al_orders SET status = ?, trade_no = ?, paid_at = NOW(), updated_at = NOW() WHERE order_no = ?',
          ['paid', trade_no, out_trade_no]
        );

        // 查找用户（通过订单关联的 userId 或用户名）
        const userId = order.user_id;
        if (userId) {
          // 计算应增发的先令（根据套餐）
          let tokensToAdd = 0;
          switch (order.subject) {
            case '月度会员': tokensToAdd = 1000; break;
            case '年度会员': tokensToAdd = 1000; break;
            case '捐赠赞赏': tokensToAdd = Math.floor(100 + Math.random() * 101); break;
            default: tokensToAdd = Math.floor(parseFloat(total_amount || '0') * 50); // 按金额估算：1元=50先令
          }

          // 增加用户余额
          await pool.query('UPDATE ik_accounts SET tokens = tokens + ? WHERE user_id = ?', [tokensToAdd, userId]);

          // 如果是会员开通，设置 philosophy = 'member'
          if (order.subject === '月度会员' || order.subject === '年度会员') {
            await pool.query("UPDATE all_accounts SET philosophy = 'member' WHERE id = ?", [userId]);
            // 记录会员起始时间
            await pool.query(
              "UPDATE ik_accounts SET member_since = NOW(), monthly_tokens_remaining = 1000, last_monthly_reset = DATE_FORMAT(NOW(), \'%Y-%m-%d\') WHERE user_id = ? AND (member_since IS NULL OR member_since = '0000-00-00 00:00:00')",
              [userId]
            );
          }

          console.log(`[Alipay] Order ${out_trade_no} paid, user ${userId} received ${tokensToAdd} tokens`);
        }
      }
    }

    res.send('success');
  } catch (err: any) {
    console.error('[Alipay] Notify error:', err);
    res.status(500).send('fail');
  }
});

/**
 * GET /api/payment/alipay/query/:orderNo
 * 查询订单状态
 */
app.get('/api/payment/alipay/query/:orderNo', async (req, res) => {
  try {
    const result = await alipayPost('alipay.trade.query', { out_trade_no: req.params.orderNo });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 创建支付订单记录（支付前调用，返回订单号）
 */
app.post('/api/payment/order/create', async (req, res) => {
  try {
    const { userId, packageId, amount, subject } = req.body;
    const orderNo = `ZH${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    await pool.query(
      `INSERT INTO al_orders (order_no, user_id, package_id, amount, subject, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [orderNo, userId || null, packageId || '', amount, subject]
    );

    res.json({ success: true, orderNo, amount, subject });
  } catch (err: any) {
    console.error('[Order] Create error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payment/order/:orderNo
 * 查询本地订单状态
 */
app.get('/api/payment/order/:orderNo', async (req, res) => {
  try {
    const [rows]: any = await pool.query('SELECT * FROM al_orders WHERE order_no = ?', [req.params.orderNo]);
    if (rows.length === 0) return res.status(404).json({ error: '订单不存在' });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Start Server
// ============================================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('-------------------------------------------');
  console.log(`🚀 卜一卜后端服务已成功启动！`);
  console.log(`📍 监听端口: ${PORT}`);
  console.log(`🔗 健康检查: http://localhost:${PORT}/api/health`);
  console.log('-------------------------------------------');
});

// 处理端口占用错误，这是防止 CPU 飙升的核心
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 启动失败：端口 ${PORT} 已被占用！`);
    console.error(`💡 解决方案：请先执行 'pkill -9 node' 彻底清理残留进程`);
    
    // 延迟 5 秒退出，给系统喘息机会，防止 PM2 疯狂拉起进程
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  } else {
    console.error('服务器发生未知错误:', err);
  }
});

// 捕获全局未处理的 Promise 错误，防止进程静默崩溃
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});
