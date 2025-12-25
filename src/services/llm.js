/**
 * LLM服务
 * 使用OpenRouter API进行同义词替换
 */

const axios = require('axios');

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-flash-3.0-preview';

if (!API_KEY) {
  console.warn('Warning: OPENROUTER_API_KEY not set in environment variables');
}

/**
 * 生成同义词替换的Prompt（第1、2次重试）
 * @param {string} originalTerm - 原始查询词
 * @returns {string} Prompt内容
 */
function generateSynonymPrompt(originalTerm) {
  return `你是一个图片搜索优化助手。

原始查询词: "${originalTerm}"
任务: 将查询词替换为更常见的同义词，以便在Unsplash图片库中找到匹配结果。

要求:
1. 保持原始含义和情感
2. 使用更常见、流行的英文词汇
3. 只返回替换后的词，用连字符连接

输出格式: JSON
{"synonym": "替换后的词"}

示例:
输入: "beautiful-cute-cat"
输出: {"synonym": "stunning-adorable-cat"}`;
}

/**
 * 生成简化查询的Prompt（第3次重试）
 * @param {string} originalTerm - 原始查询词
 * @returns {string} Prompt内容
 */
function generateSimplifyPrompt(originalTerm) {
  return `你是一个图片搜索优化助手。

原始查询词: "${originalTerm}"
任务: 简化查询词，扩大搜索范围，以提高匹配成功率。

要求:
1. 保留核心主题词
2. 移除修饰词
3. 只返回简化后的词，用连字符连接

输出格式: JSON
{"synonym": "简化后的词"}

示例:
输入: "beautiful-cute-cat"
输出: {"synonym": "cat"}`;
}

/**
 * 调用OpenRouter API获取同义词
 * @param {string} originalTerm - 原始查询词
 * @param {number} retryNum - 重试次数（1-3）
 * @returns {Promise<string>} 同义词
 */
async function getLLMSynonym(originalTerm, retryNum) {
  try {
    // 根据重试次数选择不同的prompt
    const prompt = retryNum <= 2
      ? generateSynonymPrompt(originalTerm)
      : generateSimplifyPrompt(originalTerm);

    const response = await axios.post(
      `${OPENROUTER_API_BASE}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000  // 10秒超时
      }
    );

    // 提取LLM返回的内容
    let content = response.data.choices[0].message.content.trim();

    // 移除markdown代码块标记（如果有）
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '');

    // 尝试解析JSON
    let synonym;
    try {
      const json = JSON.parse(content);
      synonym = json.synonym;
    } catch (e) {
      // 如果不是JSON，尝试直接提取内容
      const match = content.match(/"synonym"\s*:\s*"([^"]+)"/);
      if (match) {
        synonym = match[1];
      } else {
        throw new Error('Invalid LLM response format');
      }
    }

    if (!synonym || typeof synonym !== 'string') {
      throw new Error('Invalid synonym in LLM response');
    }

    return synonym;
  } catch (error) {
    console.error(`LLM retry ${retryNum} failed:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }

    // LLM失败时的降级策略：拆分单词并返回部分
    // 支持连字符和下划线分隔
    const words = originalTerm.split(/[-_]/).filter(w => w.length > 0);

    if (words.length === 1) {
      // 如果只有一个词，返回原词
      return originalTerm;
    }

    if (retryNum === 1) {
      // 第1次重试：取第一个词
      return words[0];
    } else if (retryNum === 2) {
      // 第2次重试：取最后一个词
      return words[words.length - 1];
    } else {
      // 第3次重试：取中间的词（如果有多个词）
      const midIndex = Math.floor(words.length / 2);
      return words[midIndex];
    }
  }
}

module.exports = {
  getLLMSynonym
};
