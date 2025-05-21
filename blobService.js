const { put, list, get, del } = require('@vercel/blob');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// 本地临时目录，只在开发环境使用
const LOCAL_TEMP_DIR = path.join(os.tmpdir(), 'cmt_generator_temp');
const LOCAL_OUTPUT_DIR = path.join(os.tmpdir(), 'cmt_generator_output');

// 确保本地目录存在（仅开发环境）
if (process.env.NODE_ENV !== 'production') {
  fs.ensureDirSync(LOCAL_TEMP_DIR);
  fs.ensureDirSync(LOCAL_OUTPUT_DIR);
}

/**
 * 通用存储服务，兼容本地开发和Vercel生产环境
 */
const blobService = {
  /**
   * 保存文件到存储
   * @param {Buffer|Stream} content - 文件内容
   * @param {string} filename - 文件名
   * @param {string} folder - 文件夹路径
   * @param {boolean} isPublic - 是否公开访问
   * @returns {Promise<object>} - 返回文件信息，包括 url, path
   */
  async saveFile(content, filename, folder = '', isPublic = true) {
    const fullPath = folder ? `${folder}/${filename}` : filename;
    
    if (process.env.NODE_ENV === 'production') {
      // 生产环境：使用Vercel Blob Storage
      const blob = await put(fullPath, content, {
        access: isPublic ? 'public' : 'private',
      });
      
      return {
        url: blob.url,
        path: fullPath,
        size: blob.size,
        uploadedAt: new Date().toISOString()
      };
    } else {
      // 开发环境：使用本地文件系统
      const localPath = path.join(LOCAL_TEMP_DIR, fullPath);
      await fs.ensureDir(path.dirname(localPath));
      
      if (Buffer.isBuffer(content) || typeof content === 'string') {
        await fs.writeFile(localPath, content);
      } else {
        // 假设content是可读流
        const writeStream = fs.createWriteStream(localPath);
        content.pipe(writeStream);
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      }
      
      const stats = await fs.stat(localPath);
      return {
        url: `file://${localPath}`,
        path: localPath,
        size: stats.size,
        uploadedAt: new Date().toISOString()
      };
    }
  },
  
  /**
   * 从存储中获取文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<object>} - 返回文件对象
   */
  async getFile(filePath) {
    if (process.env.NODE_ENV === 'production') {
      // 生产环境：使用Vercel Blob Storage
      return await get(filePath);
    } else {
      // 开发环境：使用本地文件系统
      const localPath = filePath.startsWith('file://') 
        ? filePath.slice(7) 
        : path.join(LOCAL_TEMP_DIR, filePath);
        
      if (!fs.existsSync(localPath)) {
        throw new Error(`File not found: ${localPath}`);
      }
      
      const content = await fs.readFile(localPath);
      const stats = await fs.stat(localPath);
      
      return {
        blob: content,
        size: stats.size,
        pathname: localPath,
        url: `file://${localPath}`
      };
    }
  },
  
  /**
   * 将文件从一个位置复制到另一个位置
   * @param {string} sourcePath - 源文件路径
   * @param {string} targetPath - 目标文件路径
   * @param {boolean} isPublic - 是否公开访问
   * @returns {Promise<object>} - 返回目标文件信息
   */
  async copyFile(sourcePath, targetPath, isPublic = true) {
    const sourceFile = await this.getFile(sourcePath);
    return await this.saveFile(sourceFile.blob, path.basename(targetPath), path.dirname(targetPath), isPublic);
  },
  
  /**
   * 删除文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<boolean>} - 操作是否成功
   */
  async deleteFile(filePath) {
    if (process.env.NODE_ENV === 'production') {
      // 生产环境：使用Vercel Blob Storage
      await del(filePath);
      return true;
    } else {
      // 开发环境：使用本地文件系统
      const localPath = filePath.startsWith('file://') 
        ? filePath.slice(7) 
        : path.join(LOCAL_TEMP_DIR, filePath);
        
      if (fs.existsSync(localPath)) {
        await fs.remove(localPath);
      }
      return true;
    }
  },
  
  /**
   * 列出文件夹中的文件
   * @param {string} prefix - 文件夹前缀
   * @returns {Promise<Array>} - 文件列表
   */
  async listFiles(prefix) {
    if (process.env.NODE_ENV === 'production') {
      // 生产环境：使用Vercel Blob Storage
      const { blobs } = await list({ prefix });
      return blobs;
    } else {
      // 开发环境：使用本地文件系统
      const localDir = path.join(LOCAL_TEMP_DIR, prefix);
      if (!fs.existsSync(localDir)) {
        return [];
      }
      
      const files = await fs.readdir(localDir, { withFileTypes: true });
      return Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(localDir, file.name);
          const stats = await fs.stat(fullPath);
          return {
            url: `file://${fullPath}`,
            pathname: path.join(prefix, file.name),
            size: stats.size,
            uploadedAt: stats.mtime.toISOString()
          };
        })
      );
    }
  },
  
  /**
   * 获取本地临时目录路径
   * @returns {string} - 本地临时目录
   */
  getTempDir() {
    return LOCAL_TEMP_DIR;
  },
  
  /**
   * 获取本地输出目录路径
   * @returns {string} - 本地输出目录
   */
  getOutputDir() {
    return LOCAL_OUTPUT_DIR;
  }
};

module.exports = blobService;
