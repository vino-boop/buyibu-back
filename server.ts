import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// MySQL 连接配置
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'buyibu',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware
app.use(cors());
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
    const { name, phone, wechat, philosophy, fortune, fengshui, status, role } = req.body;
    const [result] = await pool.query(
      'INSERT INTO all_accounts (name, phone, wechat, philosophy, fortune, fengshui, status, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, phone, wechat, philosophy || 'none', fortune || 'none', fengshui || 'none', status || 'normal', role || 'user']
    );
    const [rows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/overview/accounts/:id', async (req, res) => {
  try {
    const { name, phone, wechat, philosophy, fortune, fengshui, status, role } = req.body;
    await pool.query(
      'UPDATE all_accounts SET name = ?, phone = ?, wechat = ?, philosophy = ?, fortune = ?, fengshui = ?, status = ?, role = ? WHERE id = ?',
      [name, phone, wechat, philosophy, fortune, fengshui, status, role, req.params.id]
    );
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
    const [rows] = await pool.query('SELECT * FROM ik_philosophers ORDER BY id DESC');
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
    const [rows] = await pool.query('SELECT * FROM ik_questions ORDER BY id DESC');
    res.json({ questions: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/philosophy/questions', async (req, res) => {
  try {
    const { question_content, philosopher_name, category_name, question_times, status } = req.body;
    const [result] = await pool.query(
      'INSERT INTO ik_questions (question_content, philosopher_name, category_name, question_times, status) VALUES (?, ?, ?, ?, ?)',
      [question_content, philosopher_name, category_name, question_times || 0, status || 'active']
    );
    const [rows] = await pool.query('SELECT * FROM ik_questions WHERE id = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/philosophy/questions/:id', async (req, res) => {
  try {
    const { question_content, philosopher_name, category_name, question_times, status } = req.body;
    await pool.query(
      'UPDATE ik_questions SET question_content = ?, philosopher_name = ?, category_name = ?, question_times = ?, status = ? WHERE id = ?',
      [question_content, philosopher_name, category_name, question_times, status, req.params.id]
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
// 哲思模块 API - 历史记录 (ik_history)
// ============================================================
app.get('/api/philosophy/history', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ik_history ORDER BY create_time DESC');
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/philosophy/history/:userId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ik_history WHERE user_id = ? ORDER BY create_time DESC', [req.params.userId]);
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 API - 审判机 Prompt (ik_judge_config)
// ============================================================
app.get('/api/philosophy/judge-prompt', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM ik_judge_config WHERE config_key = 'judge_prompt'");
    if (rows.length > 0) {
      res.json(JSON.parse(rows[0].config_value));
    } else {
      res.json({
        prompt: '你是"哲思审判机"，负责评估用户与哲学家对话的质量和深度。',
        rules: ['逻辑性（25分）', '深度（25分）', '原创性（25分）', '完整性（25分）']
      });
    }
  } catch (error) {
    res.json({
      prompt: '你是"哲思审判机"，负责评估用户与哲学家对话的质量和深度。',
      rules: ['逻辑性（25分）', '深度（25分）', '原创性（25分）', '完整性（25分）']
    });
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
// 哲思模块 API - 用户信息 (ik_accounts)
// ============================================================
app.get('/api/philosophy/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ik_accounts ORDER BY id DESC');
    const users = (rows as any[]).map(a => ({
      userId: a.id,
      name: a.name,
      isMember: a.philosophy === 'member',
      tokenBalance: Math.floor(Math.random() * 10000000),
      questionSets: Math.floor(Math.random() * 30),
      status: a.philosophy === 'none' ? '未注册' : a.philosophy === 'error' ? '异常' : '正常',
      createdAt: a.created_at,
    }));
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

app.get('/api/fortune/liuyao', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM yh_fortune_liuyao ORDER BY created_at DESC');
    res.json({ records: rows });
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
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Database: MySQL (buyibu)`);
});
