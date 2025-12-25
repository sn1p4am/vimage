/**
 * URL解析工具
 * 解析格式: vimage_{三位数字}_{描述词}.{扩展名}
 * 例如: vimage_001_cute-cat.jpg
 */

/**
 * 解析图片文件名，提取序号和描述词
 * @param {string} filename - 文件名
 * @returns {{sequence: string, description: string}} 解析结果
 * @throws {Error} 格式错误时抛出异常
 */
function parseImageUrl(filename) {
  // 正则说明:
  // - vimage_ 固定前缀
  // - (\d{3}) 精确三位数字（001-999）
  // - _ 分隔符
  // - (.+) 描述词（可包含多个单词，用-连接）
  // - \.(jpg|jpeg|png) 文件扩展名（不区分大小写）

  const match = filename.match(/^vimage_(\d{3})_(.+)\.(jpg|jpeg|png)$/i);

  if (!match) {
    throw new Error(
      'Invalid URL format. Expected: vimage_{3-digit}_{description}.{jpg|png}'
    );
  }

  const sequence = match[1];    // 序号，例: "001"
  const description = match[2]; // 描述词，例: "cute-cat"

  return { sequence, description };
}

/**
 * 将描述词转换为Unsplash查询格式
 * @param {string} description - 描述词（用-连接）
 * @returns {string} 查询词（用空格连接）
 */
function descriptionToQuery(description) {
  // "cute-cat" → "cute cat"
  // Unsplash API使用空格分隔多词查询
  return description.replace(/-/g, ' ');
}

/**
 * 验证文件名格式是否正确
 * @param {string} filename - 文件名
 * @returns {boolean} 是否有效
 */
function isValidFilename(filename) {
  try {
    parseImageUrl(filename);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  parseImageUrl,
  descriptionToQuery,
  isValidFilename
};
