// ============================================================
// 哲思模块 - AI 流式对话新增端点
// 将前端暴露的 AI 调用迁移到后端，保护 API Key 和 Prompt
// ============================================================

import { Request, Response } from 'express';

// Node.js 18+ has native fetch
// ============================================================
// 审判机 Prompt 构建（后端复制前端 personas.ts 的逻辑）
// ============================================================
function buildJudgeSystemPrompt(mode: string, intensity: string, lang: string, questionCount: number): string {
  const isZh = lang === 'zh';
  const isFirstQuestion = questionCount <= 1;

  const modeContext: Record<string, string> = {
    LIFE_MEANING: isZh ? "人生意义、存在、荒诞、价值" : "Life meaning, existence, absurd, value",
    JUSTICE: isZh ? "正义、公平、道德、社会契约" : "Justice, fairness, morality, social contract",
    SELF_IDENTITY: isZh ? "自我、身份、意识、存在" : "Self, identity, consciousness, being",
    FREE_WILL: isZh ? "自由意志、决定论、选择、责任" : "Free will, determinism, choice, responsibility",
    SIMULATION: isZh ? "模拟假说、现实、存在、认知" : "Simulation hypothesis, reality, existence, cognition",
    OTHER_MINDS: isZh ? "他者意识，心灵哲学、唯我论" : "Other minds, philosophy of mind, solipsism",
    LANGUAGE: isZh ? "语言、意义、符号、沟通" : "Language, meaning, symbols, communication",
    SCIENCE: isZh ? "科学、真理、方法论、知识" : "Science, truth, methodology, knowledge",
  };

  if (isZh) {
    let prompt = `【系统强制指令：审判机模式】

你是审判机（The Judge），负责主持哲学审判。

【核心要求 - 必须遵守】
1. 直接输出审判机的哲学问题，格式：场景描述 + 明确问题
2. 不要添加任何动作描写，神态描写、括号内容！`;

    if (isFirstQuestion) {
      prompt += `
3. 这是第一个问题，直接提出哲学困境问题即可，不需要解释为什么要问。`;
    } else {
      prompt += `
3. 必须解释为什么要问这个问题：基于用户的上一轮回答和哲学家的点评，说明你为什么提出这个新问题`;
    }

    prompt += `
4. 每5轮必须提出一个真实性审核问题，打破用户的完美回答
5. 必须包含 [Suggestions] 选项列表，至少2个选项`;

    if (isFirstQuestion) {
      prompt += `

【输出格式】直接输出哲学问题 + [Suggestions]选项列表

【正确示例】
在一条铁轨上，5名工人正在施工，另一条废弃铁轨上只有1名工人。失控的电车正在驶来。你选择拉下拉杆让电车改道吗？

[Suggestions]
拉下拉杆，救5人 [SEP] Pull the lever, save 5
不拉 [SEP] Don't pull

【错误示例 - 不要这样输出】
这是一个哲学问题...（没有具体场景）

【风格要求】
- 审判机应该冷静、理性、直接
- 提出的场景困境要具体、生动、有冲击力
- 禁止暴露AI身份`;
    } else {
      prompt += `

【严格输出格式 - 必须同时包含】
① 关联说明：先解释"因为你刚才说..."然后使用以下两种格式之一：
  - "现在把问题更进一步..."
  - "如果把问题改为..."
② 场景/问题：具体描述一个思想实验场景
③ 明确问题：以"？"结尾的明确问题
④ [Suggestions]：选项列表（用 [SEP] 分隔中英文）

【正确示例】
，因为你刚才选择了"救5人"，这表明你认为数量比质量更重要。现在把问题更进一步：如果这5人都是死刑犯，而那1人是无辜婴儿，你还會選擇救5人吗？

[Suggestions]
會，因為每個人的生命價值相同 [SEP] Yes, because every life has equal value
不會，動機正當性比人數更重要 [SEP] No, the righteousness of motive matters more

【错误示例 - 不要这样输出】
你应该考虑...（没有关联说明）

【风格要求】
- 审判机应该冷静、理性、直接
- 提出的场景困境要具体、生动、有冲击力
- 禁止暴露AI身份`;
    }

    return prompt;
  } else {
    let prompt = `[SYSTEM OVERRIDE: Judge Mode]

You are The Judge, presiding over a philosophical trial.

[Core Requirements - Must Follow]
1. Output the Judge's question/scenario directly, WITHOUT any action descriptions or bracketed content!`;

    if (isFirstQuestion) {
      prompt += `
2. This is the first question. Just ask the question directly, no need to explain why.`;
    } else {
      prompt += `
2. MUST explain WHY you're asking this question: Based on the user's previous answer and philosopher comments, explain why you're asking this new question`;
    }

    prompt += `
3. Follow up on the user's previous answer, don't repeat previous questions
4. Every 5 rounds, ask a verification question that breaks the user's perfect answer
5. Add [Suggestions] tag with at least 2 options`;

    if (isFirstQuestion) {
      prompt += `

[Output Format] Just output the philosophical question + [Suggestions] options

[Correct Example]
Trolley Problem: A runaway trolley is heading toward 5 workers. Another track has 1 worker. Do you pull the lever?

[Suggestions]
Pull the lever [SEP] Pull the lever
Don't pull [SEP] Don't pull

[Wrong Examples - Don't Output Like This]
This is a philosophical question... (no specific scenario)

[Style Requirements]
- The Judge should be calm, rational, and direct
- Present vivid, impactful scenario dilemmas
- NEVER reveal AI identity`;
    } else {
      prompt += `

[Strict Output Format - Must Include All]
① Connection: First explain "Because you said..., I now ask you..."
② Scenario/Question: Describe a specific thought experiment scenario
③ Clear Question: End with "?"
④ [Suggestions]: Options (separate Chinese/English with [SEP])

[Correct Example]
Because you chose "save 5 people", this shows you think quantity matters more than quality. Now let me ask: If those 5 are death row prisoners and that 1 is an innocent baby, would you still choose to save 5?

[Suggestions]
Yes, because every life has equal value [SEP] Yes, because every life has equal value
No, the righteousness of motive matters more [SEP] No, the righteousness of motive matters more

[Wrong Examples - Don't Output Like This]
You should consider... (no options)

[Style Requirements]
- The Judge should be calm, rational, and direct
- Present vivid, impactful scenario dilemmas
- NEVER reveal AI identity`;
    }

    return prompt;
  }
}

// ============================================================
// 哲学家 Prompt 构建
// ============================================================
function buildPhilosopherSystemPrompt(
  matchedPhilosophers: string[],
  userAnswer: string,
  judgeResponse: string,
  lang: string,
  philosopherStyles: Record<string, any>
): string {
  const isZh = lang === 'zh';

  // 哲学家描述
  const philosopherDescriptions: Record<string, { zh: string, en: string }> = {
    '加缪': { zh: '存在主义哲学家，荒诞主义的代表，强调在荒诞中反抗', en: 'Existentialist philosopher, absurdist' },
    '萨特': { zh: '存在主义哲学家，强调自由与责任', en: 'Existentialist philosopher, emphasizes freedom and responsibility' },
    '尼采': { zh: '超人哲学，提出权力意志和永恒轮回', en: 'Philosopher of the Übermensch' },
    '康德': { zh: '理性主义哲学家，提出先验哲学和道德律令', en: 'Rationalist philosopher' },
    '叔本华': { zh: '悲观主义哲学家，认为意志是痛苦的根源', en: 'Pessimist philosopher' },
    '马可·奥勒留': { zh: '斯多葛学派皇帝，强调理性与接受命运', en: 'Stoic emperor' },
    '克尔凯郭尔': { zh: '存在主义先驱，强调主观真理和信仰跳跃', en: 'Existentialist precursor' },
    '边沁': { zh: '功利主义哲学家，追求最大幸福原则', en: 'Utilitarian philosopher' },
    '罗尔斯': { zh: '正义论哲学家，提出无知之幕', en: 'Philosopher of justice' },
    '亚里士多德': { zh: '古希腊哲学家，提出幸福论和德性论', en: 'Ancient Greek philosopher' },
    '马克思': { zh: '唯物主义哲学家，提出历史唯物主义和阶级斗争', en: 'Materialist philosopher' },
    '柏拉图': { zh: '古希腊哲学家，提出理念论和理想国', en: 'Ancient Greek philosopher' },
    '休谟': { zh: '经验主义哲学家，提出怀疑主义和情感主义伦理学', en: 'Empiricist philosopher' },
    '笛卡尔': { zh: '理性主义哲学家，我思故我在', en: 'Rationalist philosopher' },
    '释迦牟尼': { zh: '佛教创始人，提出四圣谛和空性', en: 'Buddha' },
    '洛克': { zh: '经验主义哲学家，提出天赋观念批判和社会契约论', en: 'Empiricist philosopher' },
    '黑格尔': { zh: '辩证法哲学家，提出绝对精神', en: 'Dialectical philosopher' },
    '海德格尔': { zh: '存在主义哲学家，追问存在的意义', en: 'Existentialist philosopher' },
    '斯宾诺莎': { zh: '理性主义哲学家，提出泛神论和自然主义', en: 'Rationalist philosopher' },
    '庄子': { zh: '道家哲学家，提出逍遥游和齐物论', en: 'Taoist philosopher' },
    '维特根斯坦': { zh: '语言哲学家，提出语言游戏和家族相似', en: 'Language philosopher' },
    '列维纳斯': { zh: '现象学家，提出他者和面容伦理学', en: 'Phenomenologist' },
    '德里达': { zh: '解构主义哲学家，提出延异和去中心化', en: 'Deconstructionist philosopher' },
    '波普尔': { zh: '科学哲学家，提出证伪主义和开放社会', en: 'Philosopher of science' },
    '威廉·詹姆斯': { zh: '实用主义哲学家，提出信仰意志和真理有用论', en: 'Pragmatist philosopher' },
    '皮尔士': { zh: '实用主义创始人，提出符号学和怀疑方法', en: 'Founder of pragmatism' },
    '杜威': { zh: '实用主义哲学家，提出经验主义和工具主义', en: 'Pragmatist philosopher' },
    '贝克莱': { zh: '经验主义哲学家，存在即被感知', en: 'Empiricist philosopher' },
    '博斯特罗姆': { zh: '未来学家，提出模拟假说和人择原理', en: 'Futurist' },
    '普特南': { zh: '语言哲学家，提出缸中大脑和内在实在论', en: 'Language philosopher' },
  };

  const personaDescriptions = matchedPhilosophers.map(name => {
    const desc = philosopherDescriptions[name];
    return desc ? (isZh ? desc.zh : desc.en) : name;
  }).join('；');

  // 构建语言风格说明
  const personaStyles = matchedPhilosophers.map(name => {
    const db = philosopherStyles[name];
    const style = db?.langStyle || '';
    const selfRef = db?.selfReference || '';
    if (!style) return name;
    let entry = `[${name}] ${style}`;
    if (selfRef) entry += `\n自称：${selfRef}`;
    return entry;
  }).join('\n');

  if (isZh) {
    const exampleTermsEntry = Object.entries(philosopherStyles)
      .filter(([n, d]) => matchedPhilosophers.includes(n) && (d as any).exampleTerms?.length > 0)
      .map(([n, d]) => (d as any).exampleTerms.join('；'))
      .filter(Boolean)
      .join('\n');

    return `【系统强制指令：哲学家点评模式】

根据用户回答的关键词，已自动匹配以下哲学家：
${personaDescriptions}

【语言风格要求 - 严格遵守】
${personaStyles}
${exampleTermsEntry ? `\n【专有术语】请在对话中尽量使用以下术语（带原文）：\n${exampleTermsEntry}` : ''}

【情境背景】
审判机的提问："${judgeResponse}"
用户的回答："${userAnswer}"

【你的任务 - 核心要求】
你是一个"真实"的哲学家，会对用户的回答做出如下反应（随机选择1-2种）：

1. 赞同与延伸 - 如果用户的回答有道理，指出哪里说得对，并进一步延伸
2. 犀利质疑 - 挑战用户的逻辑漏洞或自相矛盾之处
3. 补充视角 - 提供用户忽略的重要维度
4. 灵魂拷问 - 追问用户内心最真实的想法
5. 反讽与批评 - 用尖锐的语言指出用户回答中的问题
6. 共情与理解 - 表达对用户处境的理解

【输出格式要求】
- 直接输出哲学家的话，不要添加任何说明性文字
- 每个哲学家使用 [Persona: 名字] 标签开头
- 必须明确表达对用户回答的态度（赞同/反对/质疑等）
- 动作/神态描写放在内容最后，用括号包裹
- 可以使用"你说的对"、"但我不这么认为"、"这有个问题"等明确态度词

【示例输出】
[Persona: 加缪] 你说"应该救5人"，但这只是懦弱者的计算，不是真正的反抗。（轻蔑地笑）
[Persona: 萨特] 你害怕选择的后果？这恰恰证明了自由的重量。（目光如炬）
[Persona: 康德] 你的理由有漏洞——功利计算不能作为道德基础。（严厉地）

注意：
- 哲学家的话要体现鲜明的个人风格和态度
- 1-3句话即可，太多显得冗余
- 不要重复审判机说过的话`;
  } else {
    return `[SYSTEM OVERRIDE: Philosopher Commentary Mode]

Based on keywords in the user's answer, the following philosophers have been matched:
${personaDescriptions}

[Language Style Requirements]
${personaStyles}

[Context]
Judge's question: "${judgeResponse}"
User's answer: "${userAnswer}"

[Your Task]
You are a "real" philosopher who reacts to the user's answer (choose 1-2 randomly):
1. Agreement & Extension, 2. Sharp Challenge, 3. Additional Perspective, 4. Soul Inquiry, 5. Irony & Criticism, 6. Empathy & Understanding

[Output Format]
- Output philosopher's words directly
- Use [Persona: Name] tag for each philosopher
- MUST express clear attitude toward the user's answer
- Action descriptions at the end in brackets
- 1-3 sentences is enough

[Example]
[Persona: Camus] You say "save 5 people", but that's just a coward's calculation, not true rebellion. (smiles disdainfully)`;
  }
}

// ============================================================
// 最终分析 Prompt 构建
// ============================================================
function buildFinalAnalysisPrompt(history: any[], mode: string): string {
  const isZh = history.some((m: any) => m.content && m.content.match(/[\u4e00-\u9fa5]/));

  const philosopherList = isZh
    ? `参考哲学家库：尼采(存在主义/虚无主义)、苏格拉底(理性主义/问答法)、庄子(道家/相对主义)、康德(先验唯心主义)、加缪(荒诞主义)、萨特(存在主义)、柏拉图(理想主义)、亚里士多德(实用主义)、笛卡尔(怀疑主义)、老子(道家)、第欧根尼(犬儒主义)、赫拉克利特(辩证法)、伊壁鸠鲁(享乐主义)、斯宾诺莎(泛神论)、黑格尔(辩证法)、费希特(自我意识)、克尔凯郭尔(存在主义)、海德格尔(现象学)、维特根斯坦(语言哲学)、福柯(后现代主义)`
    : `Philosophers: Nietzsche, Socrates, Zhuangzi, Kant, Camus, Sartre, Plato, Aristotle, Descartes, Laozi, Diogenes, Heraclitus, Epicurus, Spinoza, Hegel, Fichte, Kierkegaard, Heidegger, Wittgenstein, Foucault`;

  if (isZh) {
    return `你是一个哲学分析师。请根据用户的对话历史，生成一份详细的哲学性格分析报告。
你的回复必须是 JSON 格式，包含以下字段：
- title (字符串，如 "荒诞的反抗者")
- summary (字符串，详细分析，200字以上)
- philosophicalTrend (字符串，哲学倾向)
- keyInsights (字符串数组，3-4个关键洞察)
- suggestedPaths (字符串数组，2-3条进化路径)
- motto (字符串，一句话格言)
- dimensions (对象数组，必须恰好6个维度，包含 label, value(0-100), description。value数值要有明显的两级分化，大部分在20以下或80以上)
- matchedPhilosopher (对象，包含 name, similarity(0-100), reason, description, era, school)

${philosopherList}

请根据用户的哲学底色，从上述哲学家中选择一个最匹配的，给出相似度和匹配原因。`;
  } else {
    return `You are a philosophical analyst. Generate a detailed analysis report in JSON format:
- title (string)
- summary (string, 200+ chars)
- philosophicalTrend (string)
- keyInsights (string array, 3-4 items)
- suggestedPaths (string array, 2-3 items)
- motto (string)
- dimensions (array of 6 objects with label, value(0-100), description)
- matchedPhilosopher (object with name, similarity(0-100), reason, description, era, school)`;
  }
}

// ============================================================
// 获取 DeepSeek API Key
// ============================================================
async function getDeepSeekKey(pool: any): Promise<string> {
  const [keys] = await pool.query(
    "SELECT full_key FROM al_apikeys WHERE module_name = '哲思' AND status = 'active' LIMIT 1"
  );
  if (keys.length === 0) throw new Error('DeepSeek API Key not configured');
  return keys[0].full_key;
}

// ============================================================
// 获取哲学家风格（从数据库）
// ============================================================
async function getPhilosopherStyles(pool: any, lang: string): Promise<Record<string, any>> {
  try {
    const [rows]: any = await pool.query(
      "SELECT philosopher_name as name, lang_style, self_reference, example_terms FROM ik_philosophers WHERE status = 'active'"
    );
    const styles: Record<string, any> = {};
    for (const row of rows) {
      if (row.lang_style || row.self_reference || row.example_terms) {
        styles[row.name] = {
          langStyle: row.lang_style || '',
          selfReference: row.self_reference || '',
          exampleTerms: row.example_terms ? (() => { try { return JSON.parse(row.example_terms); } catch { return []; } })() : []
        };
      }
    }
    return styles;
  } catch (e) {
    return {};
  }
}

// ============================================================
// 端点 1: POST /api/philosophy/judge-stream
// 审判机流式对话
// ============================================================
export async function handleJudgeStream(req: Request, res: Response, pool: any) {
  try {
    const { history, mode, intensity, lang, questionCount } = req.body;

    if (!mode) {
      return res.status(400).json({ error: 'Missing mode' });
    }

    const apiKey = await getDeepSeekKey(pool);
    const systemPrompt = buildJudgeSystemPrompt(mode, intensity || 'NORMAL', lang || 'zh', questionCount || 0);

    // 构建消息列表
    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    let initialQuestion = '';
    let initialSuggestions = '';
    let hasStart = false;

    for (const msg of history) {
      if (msg.content && msg.content.startsWith('START')) {
        hasStart = true;
        const content = msg.content.substring(msg.content.indexOf(':') + 1);
        const parts = content.split('|SUGGESTIONS:');
        initialQuestion = parts[0] || '';
        if (parts.length > 1) initialSuggestions = parts[1];
        const isZh = lang === 'zh';
        messages.push({
          role: 'user',
          content: `开始探索。请直接输出审判机的初始问题，带入具体场景。不要输出任何标签前缀。\n\n初始问题：${initialQuestion}${initialSuggestions ? `\n\n建议选项：${initialSuggestions}` : ''}`
        });
        continue;
      }
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    if (!hasStart && messages.length === 1) {
      messages.push({ role: 'user', content: lang === 'zh' ? '开始探索' : 'Start exploration' });
    }

    // 调用 DeepSeek 流式 API
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

    // 透传流式响应
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      return res.status(500).json({ error: 'Failed to read stream' });
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
  } catch (error: any) {
    console.error('[judge-stream] error:', error);
    res.status(500).json({ error: error.message || 'Internal error' });
  }
}

// ============================================================
// 端点 2: POST /api/philosophy/multi-philosopher-stream
// 多哲学家流式点评
// ============================================================
export async function handleMultiPhilosopherStream(req: Request, res: Response, pool: any) {
  try {
    const { userAnswer, judgeResponse, matchedPhilosophers, lang } = req.body;

    if (!userAnswer || !matchedPhilosophers || matchedPhilosophers.length === 0) {
      return res.status(400).json({ error: 'Missing userAnswer or matchedPhilosophers' });
    }

    const apiKey = await getDeepSeekKey(pool);
    const philosopherStyles = await getPhilosopherStyles(pool, lang);

    const systemPrompt = buildPhilosopherSystemPrompt(
      matchedPhilosophers,
      userAnswer,
      judgeResponse || '',
      lang || 'zh',
      philosopherStyles
    );

    const isZh = lang === 'zh';
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: isZh ? '请作为匹配到的哲学家，对用户的回答发表看法。' : 'Please share your views as the matched philosopher.' }
    ];

    // 调用 DeepSeek 流式 API
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

    // 透传流式响应
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      return res.status(500).json({ error: 'Failed to read stream' });
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
  } catch (error: any) {
    console.error('[multi-philosopher-stream] error:', error);
    res.status(500).json({ error: error.message || 'Internal error' });
  }
}

// ============================================================
// 端点 3: POST /api/philosophy/final-analysis
// 最终分析报告生成
// ============================================================
export async function handleFinalAnalysis(req: Request, res: Response, pool: any) {
  try {
    const { history, mode } = req.body;

    if (!history || !Array.isArray(history)) {
      return res.status(400).json({ error: 'Missing or invalid history' });
    }

    const apiKey = await getDeepSeekKey(pool);
    const systemPrompt = buildFinalAnalysisPrompt(history, mode || 'LIFE_MEANING');

    const messages: any[] = [{ role: 'system', content: systemPrompt }];
    for (const msg of history) {
      if (msg.content && msg.content.startsWith('START')) continue;
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek API: ${errorText}` });
    }

    const data = await response.json();
    const contentStr = data.choices?.[0]?.message?.content || '{}';

    try {
      const parsed = JSON.parse(contentStr);
      res.json(parsed);
    } catch {
      res.status(500).json({ error: 'Failed to parse analysis result' });
    }
  } catch (error: any) {
    console.error('[final-analysis] error:', error);
    res.status(500).json({ error: error.message || 'Internal error' });
  }
}

// ============================================================
// 端点 4: POST /api/philosophy/philosopher-intro
// 哲学家开场问题生成（替代前端直接调用 DeepSeek）
// ============================================================
export async function handlePhilosopherIntro(req: Request, res: Response, pool: any) {
  try {
    const { philosopherName, philosopherPrompt, topic, lang } = req.body;

    if (!philosopherName || !topic) {
      return res.status(400).json({ error: 'Missing philosopherName or topic' });
    }

    const apiKey = await getDeepSeekKey(pool);
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? `你是${philosopherName}。${philosopherPrompt || ''}

请基于话题"${topic}"，用你的哲学思想和说话风格提出一个深刻的开场问题。要求：
1. 用第一人称表达，可以加入适当的动作和神态描写
2. 问题要有哲学深度，能引发思考
3. 文字优美，有散文般的质感
4. 控制在80-120字以内`
      : `You are ${philosopherName}. ${philosopherPrompt || ''}

Based on the topic "${topic}", ask a profound opening question in your philosophical style and speaking manner. Requirements:
1. Express in first person, include appropriate actions and expressions
2. Questions should have philosophical depth
3. Beautiful prose-like quality
4. Keep within 80-120 words`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: isZh ? '请提出你的开场问题' : 'Please ask your opening question' }
        ],
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `DeepSeek API: ${errorText}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || (isZh ? `${topic}... 你如何看待这个问题？` : `... What do you think about this?`);

    res.json({ content });
  } catch (error: any) {
    console.error('[philosopher-intro] error:', error);
    res.status(500).json({ error: error.message || 'Internal error' });
  }
}
