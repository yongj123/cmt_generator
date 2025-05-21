// 主题处理模块
const path = require('path');
const fs = require('fs-extra');
const blobService = require('./blobService');

/**
 * 主题处理服务
 */
const themeHandler = {
  /**
   * 获取主题详情
   * @param {string} themeId - 主题ID
   * @param {boolean} isImported - 是否是导入的主题
   * @param {string} themeName - 主题名称
   * @param {string} TEMP_DIR - 临时目录
   * @returns {Promise<Object>} - 返回主题信息和文件树
   */
  async getThemeDetails(themeId, isImported, themeName, TEMP_DIR, CmtGenerator) {
    let selectedTheme;
    let fileTree = [];
    
    if (isImported) {
      // 导入的主题
      if (process.env.NODE_ENV === 'production') {
        // 生产环境：从Blob Storage获取主题信息
        try {
          // 尝试获取主题信息文件
          const themeInfoFile = await blobService.getFile(`${themeId}/theme-info.json`);
          const themeInfo = JSON.parse(themeInfoFile.blob.toString());
          
          selectedTheme = {
            id: themeId,
            name: themeInfo.name || themeName,
            files: themeInfo.files,
            isImported: true
          };
          
          // 列出主题文件夹结构
          const blobs = await blobService.listFiles(`${themeId}/theme`);
          
          // 根据文件路径构建文件树
          fileTree = CmtGenerator.buildFileTreeFromPaths(
            blobs.map(blob => {
              // 从 pathname 提取出相对路径
              const pathParts = blob.pathname.split('/');
              // 去除前两部分 (themeId 和 theme)
              const relativePath = pathParts.slice(2).join('/');
              return {
                path: relativePath,
                url: blob.url,
                size: blob.size,
                isDirectory: false
              };
            })
          );
          
          console.log(`从Blob Storage获取了 ${blobs.length} 个文件`);
        } catch (error) {
          console.error(`无法从Blob Storage加载主题 ${themeId}:`, error);
          throw new Error('无法找到主题或主题数据已过期');
        }
      } else {
        // 开发环境：使用本地文件系统
        const themePath = path.join(TEMP_DIR, themeId);
        
        if (!fs.existsSync(themePath)) {
          console.log(`开发环境中未找到导入的主题路径: ${themePath}`);
          throw new Error('Theme not found');
        }
        
        selectedTheme = {
          id: themeId,
          name: themeName,
          samplePath: themePath,
          isImported: true
        };
        
        // 获取文件树
        const themeDir = path.join(themePath, 'theme');
        fileTree = await CmtGenerator.getFileTree(themeDir);
        console.log(`开发环境中使用本地目录: ${themeDir}`);
      }
    } else {
      // 默认主题
      const themes = CmtGenerator.getSampleThemes();
      selectedTheme = themes.find(theme => theme.id === themeId);
      
      if (!selectedTheme) {
        console.log(`主题未找到: ${themeId}`);
        throw new Error('Theme not found');
      }

      // 判断是否有用户修改的工作目录
      const themeWorkDir = path.join(TEMP_DIR, themeId);
      const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
      
      // 默认主题使用工作目录（如果存在），否则使用原始主题目录
      const themeDir = fs.existsSync(themeWorkDir) ? themeWorkDir : originalThemeDir;
      console.log(`默认主题，使用目录: ${themeDir}`);
      
      // 获取文件树
      fileTree = await CmtGenerator.getFileTree(themeDir);
    }
    
    return {
      theme: selectedTheme,
      fileTree
    };
  },
  
  /**
   * 处理文件预览
   * @param {string} themeId - 主题ID
   * @param {string} filePath - 文件路径
   * @param {boolean} isImported - 是否是导入的主题
   * @param {string} themeName - 主题名称
   * @param {string} themePath - 主题路径
   * @param {string} TEMP_DIR - 临时目录
   * @param {Object} CmtGenerator - CMT生成器对象
   * @returns {Promise<Object>} - 返回文件信息
   */
  async getFilePreview(themeId, filePath, isImported, themeName, themePath, TEMP_DIR, CmtGenerator) {
    try {
      // 查找主题
      let selectedTheme;
      let fullFilePath;
      let fileContent;
      
      console.log(`预览文件参数: themeId=${themeId}, filePath=${filePath}, isImported=${isImported}, themeName=${themeName}, themePath=${themePath}`);
      
      if (isImported) {
        if (process.env.NODE_ENV === 'production') {
          // 生产环境：从Blob Storage获取文件
          const blobPath = `${themeId}/theme/${filePath}`;
          try {
            const file = await blobService.getFile(blobPath);
            return {
              content: file.blob,
              contentType: this.getContentType(path.extname(filePath)),
              isBlob: true,
              url: file.url
            };
          } catch (error) {
            console.error(`无法从Blob Storage获取文件 ${blobPath}:`, error);
            throw new Error(`无法找到文件: ${filePath}`);
          }
        } else {
          // 开发环境：从本地文件系统获取
          // 检查themePath是否存在
          if (!themePath) {
            throw new Error(`导入主题的路径不存在，请重新导入主题`);
          }
          
          selectedTheme = {
            id: themeId,
            name: themeName || '导入的主题',
            samplePath: themePath,
            isImported: true
          };
          
          // 如果是导入的主题，始终从 theme 目录中获取文件
          const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
          fullFilePath = path.join(originalThemeDir, filePath);
          
          console.log(`开发环境中导入主题文件路径: ${fullFilePath}`);
          
          if (!fs.existsSync(fullFilePath)) {
            throw new Error(`无法找到文件: ${filePath}`);
          }
        }
      } else {
        // 默认主题
        const themes = CmtGenerator.getSampleThemes();
        selectedTheme = themes.find(theme => theme.id === themeId);
        
        if (!selectedTheme) {
          throw new Error(`无法找到主题: ${themeId}`);
        }
        
        // 检查是否有自定义版本的文件
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
        
        if (fs.existsSync(themeWorkDir) && fs.existsSync(path.join(themeWorkDir, filePath))) {
          // 如果是默认主题且有自定义版本，使用自定义版本
          fullFilePath = path.join(themeWorkDir, filePath);
          console.log(`默认主题，使用自定义文件: ${fullFilePath}`);
        } else {
          // 否则使用原始文件
          fullFilePath = path.join(originalThemeDir, filePath);
          console.log(`默认主题，使用原始文件: ${fullFilePath}`);
        }
        
        if (!fs.existsSync(fullFilePath)) {
          throw new Error(`无法找到文件: ${filePath}`);
        }
      }
      
      // 读取文件
      fileContent = await fs.readFile(fullFilePath);
      
      return {
        content: fileContent,
        contentType: this.getContentType(path.extname(fullFilePath)),
        isBlob: false,
        path: fullFilePath
      };
    } catch (error) {
      console.error('获取文件预览失败:', error);
      throw error; // 重新抛出错误以便于上层捕获
    }
  },
  
  /**
   * 获取文件的内容类型
   * @param {string} ext - 文件扩展名
   * @returns {string} - 内容类型
   */
  getContentType(ext) {
    ext = ext.toLowerCase();
    
    if (ext === '.jpg' || ext === '.jpeg') {
      return 'image/jpeg';
    } else if (ext === '.png') {
      return 'image/png';
    } else if (ext === '.gif') {
      return 'image/gif';
    } else if (ext === '.bmp') {
      return 'image/bmp';
    } else if (ext === '.webp') {
      return 'image/webp';
    } else if (ext === '.mp4') {
      return 'video/mp4';
    } else {
      return 'application/octet-stream';
    }
  }
};

module.exports = themeHandler;
