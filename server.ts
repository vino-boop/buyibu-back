import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

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

// Middleware
app.use(cors({
  origin: ['https://philosophy.vinolab.tech', 'https://thinking.vinolab.tech', 'https://www.vinolab.tech', 'https://vinolab.tech', 'http://localhost:3000'],
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
    const { mode } = req.query;
    let query = 'SELECT id, philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt as prompt, keywords, modes, status FROM ik_philosophers';
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
    const { name, phone, wechat, fortune, status, role, gender, birth_date, birth_time, birth_place, personality } = req.body;
    
    // 写入 yh_accounts 表
    const [result] = await pool.query(
      'INSERT INTO yh_accounts (name, phone, wechat, fortune, status, role, gender, birth_date, birth_time, birth_place, personality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, phone || '', wechat, fortune || 'none', status || 'normal', role || 'user', gender || 'male', birth_date, birth_time, birth_place, personality || 'MYSTIC']
    );
    
    const newUserId = result.insertId;
    
    // 同时写入 all_accounts 表（统一账号系统）- 不管 phone 是否存在都写入
    const defaultPhone = phone || `yunhe_${newUserId}`;
    const [existAccount] = await pool.query('SELECT id FROM all_accounts WHERE username = ?', [defaultPhone]);
    if (existAccount.length === 0) {
      await pool.query(
        'INSERT INTO all_accounts (name, username, phone, password, philosophy, fortune, fengshui, status, role, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, defaultPhone, phone || '', '', 'none', 'member', 'none', 'normal', 'user', 100]
      );
    }
    
    const [rows] = await pool.query('SELECT * FROM yh_accounts WHERE id = ?', [newUserId]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/fortune/accounts/:id', async (req, res) => {
  try {
    const { name, phone, wechat, fortune, status, role, gender, birth_date, birth_time, birth_place, personality } = req.body;
    await pool.query(
      'UPDATE yh_accounts SET name = ?, phone = ?, wechat = ?, fortune = ?, status = ?, role = ?, gender = ?, birth_date = ?, birth_time = ?, birth_place = ?, personality = ? WHERE id = ?',
      [name, phone, wechat, fortune, status, role, gender, birth_date, birth_time, birth_place, personality, req.params.id]
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
// 认证模块 API (使用 all_accounts)
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // 使用 username 或 phone 登录
    const [rows] = await pool.query(
      'SELECT * FROM all_accounts WHERE username = ? OR phone = ?', 
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
    // 登录成功
    // tokens 现在存储在 all_accounts 表中
    const userTokens = user.tokens || 100;
    
    // 获取 yh_accounts 中的详细信息
    const [yhRows] = await pool.query('SELECT * FROM yh_accounts WHERE phone = ?', [user.phone]);
    const yhUser = yhRows.length > 0 ? yhRows[0] : null;
    
    res.json({ 
      success: true, 
      user: { 
        id: user.id, 
        username: user.username,
        name: user.name, 
        phone: user.phone, 
        philosophy: user.philosophy, 
        tokens: userTokens,
        gender: yhUser?.gender || 'male',
        birth_date: yhUser?.birth_date || '',
        birth_time: yhUser?.birth_time || '12:00',
        birth_place: yhUser?.birth_place || '',
        personality: yhUser?.personality || 'MYSTIC'
      },
      token: `user_${user.id}_${Date.now()}`
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    
    // 判断是否为游客登录（username 以 guest_ 开头）
    const isGuest = username && username.startsWith('guest_');
    
    // 获取当前最大编号，生成默认用户名
    const [maxUser] = await pool.query('SELECT MAX(CAST(SUBSTRING(name, 5) AS UNSIGNED)) as maxNum FROM all_accounts WHERE name LIKE "思考者%"');
    const nextNum = (maxUser[0]?.maxNum || 0) + 1;
    const defaultName = isGuest ? username : `思考者${String(nextNum).padStart(3, '0')}`;
    
    // 游客不检查手机号，普通用户检查手机号是否已存在
    if (!isGuest && phone) {
      const [existPhone] = await pool.query('SELECT id FROM all_accounts WHERE phone = ?', [phone]);
      if (existPhone.length > 0) {
        return res.status(400).json({ error: '手机号已注册' });
      }
    }
    
    // 游客不送先令，普通用户默认100先令
    const initialTokens = isGuest ? 0 : 100;
    
    // 插入 all_accounts（包含 tokens 字段）
    const [result] = await pool.query(
      'INSERT INTO all_accounts (name, username, phone, password, philosophy, fortune, fengshui, status, role, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultName, phone || defaultName, phone || '', password || '', isGuest ? 'guest' : 'none', 'none', 'none', isGuest ? 'guest' : 'normal', isGuest ? 'guest' : 'user', initialTokens]
    );
    
    const userId = result.insertId;
    
    // 同时插入 ik_accounts 表
    await pool.query(
      'INSERT INTO ik_accounts (user_id, username, phone, status, is_member, conversation_count, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [String(userId), defaultName, phone || '', 'active', 0, 0, initialTokens]
    );
    
    res.json({ 
      success: true, 
      userId: userId,
      user: {
        id: userId,
        username: defaultName,
        phone: phone,
        tokens: initialTokens,
        isGuest: isGuest
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 用户信息 (使用 all_accounts)
// ============================================================
app.get('/api/philosophy/user/:userId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [req.params.userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const user = rows[0];
    res.json({ 
      id: user.id, 
      name: user.name, 
      phone: user.phone,
      philosophy: user.philosophy,
      isMember: user.philosophy === 'member'
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 更新用户 tokens
app.post('/api/philosophy/user/tokens', async (req, res) => {
  try {
    const { userId, tokens, action } = req.body;
    
    // 获取当前用户
    const [rows] = await pool.query('SELECT * FROM all_accounts WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const user = rows[0];
    let currentTokens = user.tokens || 0;
    
    // 根据 action 计算新 token 数量
    let newTokens = currentTokens;
    if (action === 'deduct') {
      newTokens = currentTokens - tokens;
    } else if (action === 'add') {
      newTokens = currentTokens + tokens;
    } else if (action === 'set') {
      newTokens = tokens;
    }
    
    // 确保 token 不为负数
    if (newTokens < 0) newTokens = 0;
    
    // 更新数据库
    await pool.query('UPDATE all_accounts SET tokens = ? WHERE id = ?', [newTokens, userId]);
    
    res.json({ success: true, tokens: newTokens });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 哲思模块 - 哲学家 Prompt
// ============================================================
app.get('/api/philosophy/prompts/philosopher', async (req, res) => {
  try {
    const { mode } = req.query;
    let query = 'SELECT philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt, keywords, modes FROM ik_philosophers WHERE status = ?';
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
      'SELECT philosopher_name as name, display_name_zh, display_name_en, philosopher_era as era, description_text as description, system_prompt, keywords, modes FROM ik_philosophers WHERE id = ?',
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
    const isNumericId = !isNaN(userIdNum);
    const limit = 50; // 最多50条
    
    // 获取历史记录（使用 ik_user_conversations 表）
    let historyQuery = 'SELECT session_id, mode, round, judge_question, user_answer, philosopher_response, created_at FROM ik_user_conversations WHERE user_id = ?';
    let historyParams: any[] = [userId];
    if (isNumericId && userIdNum !== userId) {
      historyQuery += ' OR user_id = ?';
      historyParams.push(userIdNum);
    }
    historyQuery += ' ORDER BY created_at DESC LIMIT ?';
    historyParams.push(limit);
    const [historyRows] = await pool.query(historyQuery, historyParams);
    
    // 获取分析报告
    let reportQuery = 'SELECT session_id, mode, title, summary, philosophical_trend, created_at FROM ik_analysis_reports WHERE user_id = ?';
    let reportParams: any[] = [userId];
    if (isNumericId && userIdNum !== userId) {
      reportQuery += ' OR user_id = ?';
      reportParams.push(userIdNum);
    }
    reportQuery += ' ORDER BY created_at DESC LIMIT ?';
    reportParams.push(limit);
    const [reportRows] = await pool.query(reportQuery, reportParams);
    
    // 构建会话ID列表
    const sessionsWithReports = new Set((reportRows as any[]).map(r => r.session_id));
    
    // 合并历史记录，标记是否有报告
    const history = (historyRows as any[]).map(h => ({
      sessionId: h.session_id,
      mode: h.mode,
      questionCount: h.round || 1,
      lastMessage: h.judge_question?.slice(0, 50) || '',
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
      existingJson.push(newExchange);
      
      await pool.query(
        'UPDATE ik_user_conversations SET conversation_json = ?, mode = COALESCE(?, mode), round = ? WHERE session_id = ?',
        [JSON.stringify(existingJson), mode, round || existingJson.length, session_id]
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
        'INSERT INTO ik_user_conversations (user_id, session_id, mode, round, conversation_json) VALUES (?, ?, ?, ?, ?)',
        [user_id, session_id, mode, round || 1, JSON.stringify(conversationData)]
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
    const { user_id, session_id } = req.query;
    let query = 'SELECT * FROM ik_user_conversations';
    let params: any[] = [];
    
    if (user_id && session_id) {
      query += ' WHERE user_id = ? AND session_id = ? ORDER BY round ASC';
      params = [user_id, session_id];
    } else if (user_id) {
      query += ' WHERE user_id = ? ORDER BY created_at DESC';
      params = [user_id];
    } else {
      return res.status(400).json({ error: 'user_id is required' });
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
    
    if (user_id && session_id) {
      query += ' WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT 1';
      params = [user_id, session_id];
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
