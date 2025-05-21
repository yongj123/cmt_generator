const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs-extra');
const CmtGenerator = require('./cmtGenerator');
const portfinder = require('portfinder');
const AesUtil = require('./aesUtil');
const extract = require('extract-zip');
const { v4: uuidv4 } = require('uuid');
const blobService = require('./blobService');
const themeHandler = require('./theme_handler');

const app = express();

// 使用会话中间件
const session = require('express-session');
app.use(session({
    secret: 'cmt-generator-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Set up EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    createParentPath: true,
    limits: { 
        fileSize: 50 * 1024 * 1024 // 50MB max file size
    },
}));

// 获取临时和输出目录 - 兼容本地开发和Vercel环境
// 在生产环境，这些目录只用于临时操作，实际存储将使用Blob Storage
const TEMP_DIR = blobService.getTempDir();
const OUTPUT_DIR = blobService.getOutputDir();

console.log(`App.js 使用 TEMP_DIR: ${TEMP_DIR}`);
console.log(`App.js 使用 OUTPUT_DIR: ${OUTPUT_DIR}`);

// 确保本地开发环境有这些目录
if (process.env.NODE_ENV !== 'production') {
    fs.ensureDirSync(TEMP_DIR);
    fs.ensureDirSync(OUTPUT_DIR);
}

// Main page - display available themes
app.get('/', (req, res) => {
    const themes = CmtGenerator.getSampleThemes();
    res.render('index', { themes });
});

// 处理CMT文件上传和解压（通过首页弹窗提交）
app.post('/import/cmt', async (req, res) => {
    try {
        if (!req.files || !req.files.cmtFile) {
            return res.status(400).json({ error: '没有上传CMT文件' });
        }

        const cmtFile = req.files.cmtFile;
        const fileExt = path.extname(cmtFile.name).toLowerCase();
        
        if (fileExt !== '.cmt') {
            return res.status(400).json({ error: '请上传.cmt格式的文件' });
        }

        // 生成唯一ID作为导入主题的ID
        const importedThemeId = `imported-${uuidv4()}`;
        
        // 创建临时工作区域 - 在生产环境使用Blob Storage，开发环境使用本地文件系统
        let cmtFilePath, decryptedFilePath;
        let themeFiles = [];
        
        if (process.env.NODE_ENV === 'production') {
            // 在生产环境中，保存上传的CMT文件到Blob Storage
            const savedCmtFile = await blobService.saveFile(
                cmtFile.data, 
                'original.cmt', 
                `${importedThemeId}`,
                true // 使用公开访问权限
            );
            cmtFilePath = savedCmtFile.path;
            
            // 在本地临时目录解密和解压（仍需本地操作后上传）
            const tempLocalDir = path.join(require('os').tmpdir(), importedThemeId);
            await fs.ensureDir(tempLocalDir);
            
            const tempCmtPath = path.join(tempLocalDir, 'original.cmt');
            await fs.writeFile(tempCmtPath, cmtFile.data);
            
            decryptedFilePath = path.join(tempLocalDir, 'decrypted.dcmt');
            await AesUtil.decryptFile(tempCmtPath, decryptedFilePath);
            
            // 解压文件
            try {
                await extract(decryptedFilePath, { dir: tempLocalDir });
                console.log('CMT文件解压成功');
                
                // 确保解压后有theme目录
                const extractDir = path.join(tempLocalDir, 'theme');
                if (!fs.existsSync(extractDir)) {
                    await fs.ensureDir(extractDir);
                    
                    // 将文件移动到theme目录
                    const items = await fs.readdir(tempLocalDir);
                    for (const item of items) {
                        if (item !== 'theme' && item !== 'original.cmt' && item !== 'decrypted.dcmt') {
                            const itemPath = path.join(tempLocalDir, item);
                            const targetPath = path.join(extractDir, item);
                            await fs.move(itemPath, targetPath);
                        }
                    }
                }
                
                // 上传解压后的所有文件到Blob Storage
                const uploadFiles = async (dir, baseDir, prefix) => {
                    const items = await fs.readdir(dir);
                    for (const item of items) {
                        const itemPath = path.join(dir, item);
                        const stat = await fs.stat(itemPath);
                        
                        if (stat.isDirectory()) {
                            // 递归处理子目录
                            await uploadFiles(itemPath, baseDir, `${prefix}/${item}`);
                        } else {
                            // 上传文件
                            const relativePath = path.relative(baseDir, itemPath);
                            const fileData = await fs.readFile(itemPath);
                            
                            const savedFile = await blobService.saveFile(
                                fileData,
                                path.basename(itemPath),
                                `${importedThemeId}/theme/${path.dirname(relativePath)}`,
                                true // 公开访问
                            );
                            
                            themeFiles.push({
                                path: relativePath,
                                url: savedFile.url,
                                size: savedFile.size
                            });
                        }
                    }
                };
                
                await uploadFiles(extractDir, extractDir, `${importedThemeId}/theme`);
                console.log(`已上传 ${themeFiles.length} 个主题文件到Blob Storage`);
                
                // 清理本地临时文件
                await fs.remove(tempLocalDir);
                
            } catch (extractError) {
                console.error('解压文件失败:', extractError);
                await fs.remove(tempLocalDir);
                return res.status(500).json({ error: '解压CMT文件失败' });
            }
        } else {
            // 在开发环境中，使用本地文件系统
            const tempDir = path.join(TEMP_DIR, importedThemeId);
            cmtFilePath = path.join(tempDir, 'original.cmt');
            decryptedFilePath = path.join(tempDir, 'decrypted.dcmt');
            const extractDir = path.join(tempDir, 'theme');
            
            // 创建临时目录
            await fs.ensureDir(tempDir);
            
            // 保存上传的CMT文件
            await cmtFile.mv(cmtFilePath);
            
            // 解密CMT文件
            await AesUtil.decryptFile(cmtFilePath, decryptedFilePath);
            
            // 创建解压目录
            await fs.ensureDir(extractDir);
            
            // 解压文件
            try {
                await extract(decryptedFilePath, { dir: tempDir });
                console.log('CMT文件解压成功');
                
                // 检查解压后的文件结构，确保有theme目录
                const hasThemeDir = fs.existsSync(extractDir);
                if (!hasThemeDir) {
                    // 如果没有theme目录，创建一个并将所有文件移动到其中
                    await fs.ensureDir(extractDir);
                    
                    // 获取tempDir中的所有文件和目录（排除theme目录本身和临时文件）
                    const items = await fs.readdir(tempDir);
                    for (const item of items) {
                        if (item !== 'theme' && item !== 'original.cmt' && item !== 'decrypted.dcmt') {
                            const itemPath = path.join(tempDir, item);
                            const targetPath = path.join(extractDir, item);
                            await fs.move(itemPath, targetPath);
                        }
                    }
                    console.log('已将文件移动到theme目录');
                }
            } catch (extractError) {
                console.error('解压文件失败:', extractError);
                return res.status(500).json({ error: '解压CMT文件失败' });
            }
        }
        
        // 创建导入的主题对象
        // 解决中文文件名乱码问题
        const originalFileName = Buffer.from(cmtFile.name, 'latin1').toString('utf8');
        const themeName = path.basename(originalFileName, '.cmt');
        
        // 存储有关该主题的额外信息
        const themeInfo = {
            id: importedThemeId,
            name: themeName,
            files: themeFiles,
            createdAt: new Date().toISOString()
        };
        
        // 将主题信息序列化并保存到blob storage
        if (process.env.NODE_ENV === 'production') {
            await blobService.saveFile(
                JSON.stringify(themeInfo),
                'theme-info.json',
                importedThemeId,
                true // 使用公开访问权限
            );
        }
        
        // 直接将主题信息作为URL参数传递
        let redirectUrl = `/theme/${importedThemeId}?name=${encodeURIComponent(themeName)}&imported=true`;
        
        // 在开发环境中，需要添加path参数
        if (process.env.NODE_ENV !== 'production') {
            const tempDir = path.join(TEMP_DIR, importedThemeId);
            redirectUrl += `&path=${encodeURIComponent(tempDir)}`;
        }
        
        res.json({ 
            success: true, 
            message: 'CMT文件导入成功',
            redirectUrl: redirectUrl
        });
    } catch (error) {
        console.error('导入CMT文件失败:', error);
        res.status(500).json({ error: '导入CMT文件失败' });
    }
});

// Theme details page - display file tree
app.get('/theme/:id', async (req, res) => {
    try {
        const themeId = req.params.id;
        const isImported = req.query.imported === 'true';
        const themeName = req.query.name || '导入的主题';
        
        // 使用主题处理模块获取主题详情
        const { theme, fileTree } = await themeHandler.getThemeDetails(
            themeId,
            isImported,
            themeName,
            TEMP_DIR,
            CmtGenerator
        );
        
        res.render('theme', { theme, fileTree });
    } catch (error) {
        console.error('加载主题详情时出错:', error);
        res.status(500).send(`加载主题详情时出错: ${error.message}`);
    }
});

// 处理文件夹上传替换
app.post('/upload-folder/:themeId', async (req, res) => {
    try {
        if (!req.files || !req.files.folder) {
            console.log('上传失败: 没有上传文件夹');
            return res.status(400).json({ error: 'No folder was uploaded' });
        }

        const themeId = req.params.themeId;
        const folderPath = req.body.folderPath;
        const isImported = req.body.isImported === 'true';
        const themeName = req.body.themeName;
        
        // 获取上传的文件夹（实际上是zip文件）
        const uploadedFolder = req.files.folder;
        
        // 创建临时目录用于解压（本地操作）
        const tempExtractDir = path.join(require('os').tmpdir(), `${themeId}_folder_extract_${Date.now()}`);
        await fs.ensureDir(tempExtractDir);
        
        // 保存上传的zip文件到本地临时目录
        const zipFilePath = path.join(tempExtractDir, 'folder.zip');
        await uploadedFolder.mv(zipFilePath);
        
        // 解压zip文件
        try {
            await extract(zipFilePath, { dir: tempExtractDir });
            console.log('ZIP文件解压成功');
        } catch (extractError) {
            console.error('解压文件夹失败:', extractError);
            await fs.remove(tempExtractDir);
            return res.status(500).json({ error: '解压文件夹失败' });
        }
        
        // 获取文件夹名称
        const folderName = path.basename(folderPath);
        
        // 处理不同环境下的替换操作
        if (process.env.NODE_ENV === 'production') {
            if (isImported) {
                // 生产环境下的导入主题处理 - 使用Blob Storage
                
                // 1. 获取解压后的文件列表
                const extractedItems = await fs.readdir(tempExtractDir);
                console.log('解压目录内容:', extractedItems);
                
                // 2. 上传所有文件到Blob Storage，保持文件夹结构
                const uploadFiles = async (dir, baseDir, targetPath) => {
                    const items = await fs.readdir(dir);
                    for (const item of items) {
                        const itemPath = path.join(dir, item);
                        const stat = await fs.stat(itemPath);
                        
                        if (stat.isDirectory()) {
                            // 递归处理子目录
                            await uploadFiles(itemPath, baseDir, `${targetPath}/${item}`);
                        } else {
                            // 上传文件
                            const relativePath = path.relative(baseDir, itemPath);
                            const fileData = await fs.readFile(itemPath);
                            
                            await blobService.saveFile(
                                fileData,
                                path.basename(itemPath),
                                `${themeId}/theme/${targetPath}/${path.dirname(relativePath)}`,
                                true // 公开访问
                            );
                        }
                    }
                };
                
                // 对于每个解压后的项目（排除原始zip）
                for (const item of extractedItems) {
                    if (item !== 'folder.zip') {
                        const itemPath = path.join(tempExtractDir, item);
                        const stat = await fs.stat(itemPath);
                        
                        if (stat.isDirectory()) {
                            // 删除目标文件夹中现有的所有文件
                            // 通过前缀匹配删除文件
                            const folderPrefix = `${themeId}/theme/${folderPath}`;
                            const existingFiles = await blobService.listFiles(folderPrefix);
                            
                            for (const file of existingFiles) {
                                await blobService.deleteFile(file.pathname);
                            }
                            
                            // 上传新文件
                            await uploadFiles(itemPath, itemPath, folderPath);
                        } else {
                            // 单个文件情况，直接上传到目标文件夹
                            const fileData = await fs.readFile(itemPath);
                            await blobService.saveFile(
                                fileData,
                                item,
                                `${themeId}/theme/${folderPath}`,
                                true
                            );
                        }
                    }
                }
                
                console.log(`已替换文件夹 ${folderPath} 的内容并上传到Blob Storage`);
            } else {
                // 默认主题处理 - 使用临时目录然后复制到Blob Storage
                const themes = CmtGenerator.getSampleThemes();
                const selectedTheme = themes.find(theme => theme.id === themeId);
                
                if (!selectedTheme) {
                    await fs.remove(tempExtractDir);
                    return res.status(404).json({ error: '主题未找到' });
                }
                
                // 获取该主题的工作目录（临时）
                const themeWorkDir = path.join(require('os').tmpdir(), themeId);
                const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
                
                // 如果工作目录不存在，复制原始主题目录
                if (!fs.existsSync(themeWorkDir)) {
                    await fs.copy(originalThemeDir, themeWorkDir);
                }
                
                // 目标文件夹路径
                const targetFolderPath = path.join(themeWorkDir, folderPath);
                
                // 确保目标文件夹存在
                await fs.ensureDir(path.dirname(targetFolderPath));
                
                // 如果目标文件夹存在，先删除它
                if (fs.existsSync(targetFolderPath)) {
                    await fs.remove(targetFolderPath);
                }
                
                // 创建目标文件夹
                await fs.ensureDir(targetFolderPath);
                
                // 复制解压后的内容到目标文件夹
                const extractedItems = await fs.readdir(tempExtractDir);
                for (const item of extractedItems) {
                    if (item !== 'folder.zip') {
                        const itemPath = path.join(tempExtractDir, item);
                        const itemTargetPath = path.join(targetFolderPath, item);
                        await fs.copy(itemPath, itemTargetPath);
                    }
                }
                
                // 将整个工作目录保存到Blob Storage用于后续操作
                const uploadFolder = async (dir, baseDir) => {
                    const items = await fs.readdir(dir);
                    for (const item of items) {
                        const itemPath = path.join(dir, item);
                        const stat = await fs.stat(itemPath);
                        
                        if (stat.isDirectory()) {
                            await uploadFolder(itemPath, baseDir);
                        } else {
                            const relativePath = path.relative(baseDir, itemPath);
                            const fileData = await fs.readFile(itemPath);
                            
                            await blobService.saveFile(
                                fileData,
                                path.basename(itemPath),
                                `${themeId}/${path.dirname(relativePath)}`,
                                true
                            );
                        }
                    }
                };
                
                await uploadFolder(themeWorkDir, themeWorkDir);
                console.log(`已替换默认主题 ${selectedTheme.name} 的文件夹 ${folderPath} 并上传到Blob Storage`);
            }
        } else {
            // 本地开发环境处理 - 使用本地文件系统
            // 查找主题
            let selectedTheme;
            let themePath = req.body.themePath;
            
            if (isImported && themePath) {
                // 导入的主题
                selectedTheme = {
                    id: themeId,
                    name: themeName || '导入的主题',
                    samplePath: themePath,
                    isImported: true
                };
            } else {
                // 默认主题
                const themes = CmtGenerator.getSampleThemes();
                selectedTheme = themes.find(theme => theme.id === themeId);
            }
            
            if (!selectedTheme) {
                await fs.remove(tempExtractDir);
                return res.status(404).json({ error: '主题未找到' });
            }
            
            let themeWorkDir, originalThemeDir, targetFolderPath;
            
            if (isImported) {
                // 导入的主题，直接使用theme目录
                originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
                themeWorkDir = originalThemeDir; // 对于导入的主题，工作目录就是原始目录
                targetFolderPath = path.join(themeWorkDir, folderPath);
            } else {
                // 默认主题，创建工作目录
                themeWorkDir = path.join(TEMP_DIR, themeId);
                originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
                
                // 如果工作目录不存在，复制原始主题目录
                if (!fs.existsSync(themeWorkDir)) {
                    await fs.copy(originalThemeDir, themeWorkDir);
                }
                
                // 目标文件夹路径
                targetFolderPath = path.join(themeWorkDir, folderPath);
            }
            
            // 确保目标文件夹存在
            await fs.ensureDir(path.dirname(targetFolderPath));
            
            // 如果目标文件夹存在，先删除它
            if (fs.existsSync(targetFolderPath)) {
                await fs.remove(targetFolderPath);
            }
            
            // 创建目标文件夹
            await fs.ensureDir(targetFolderPath);
            
            // 复制解压后的内容到目标文件夹
            const extractedItems = await fs.readdir(tempExtractDir);
            console.log('解压目录内容:', extractedItems);
            
            for (const item of extractedItems) {
                if (item !== 'folder.zip') { // 跳过原始zip文件
                    const itemPath = path.join(tempExtractDir, item);
                    const itemTargetPath = path.join(targetFolderPath, item);
                    await fs.copy(itemPath, itemTargetPath);
                }
            }
            
            console.log(`上传成功: 主题 ${selectedTheme.name} 文件夹 ${folderPath} 已替换`);
        }
        
        // 清理临时解压目录
        await fs.remove(tempExtractDir);
        
        res.json({ success: true, message: 'Folder replaced successfully' });
    } catch (error) {
        console.error('替换文件夹失败:', error);
        res.status(500).json({ error: `替换文件夹失败: ${error.message}` });
    }
});

// Handle file replacement uploads
app.post('/upload/:themeId', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            console.log('上传失败: 没有上传文件');
            return res.status(400).json({ error: 'No files were uploaded' });
        }

        const themeId = req.params.themeId;
        const filePath = req.body.filePath;
        const originalExtension = path.extname(filePath);
        const isImported = req.body.isImported === 'true';
        const themeName = req.body.themeName;
        const themePath = req.body.themePath;
        
        // 查找主题
        let selectedTheme;
        
        if (isImported && themePath) {
            // 如果是导入的主题，使用请求中提供的信息
            selectedTheme = {
                id: themeId,
                name: themeName || '导入的主题',
                samplePath: themePath,
                isImported: true
            };
        } else {
            // 如果是默认主题，从预设主题中查找
            const themes = CmtGenerator.getSampleThemes();
            selectedTheme = themes.find(theme => theme.id === themeId);
        }
        
        if (!selectedTheme) {
            console.log(`上传失败: 未找到主题 ${themeId}`);
            return res.status(404).json({ error: 'Theme not found' });
        }

        // Get the upload file
        const uploadedFile = req.files.file;
        const uploadedExtension = path.extname(uploadedFile.name);

        // Validate file extension
        if (uploadedExtension.toLowerCase() !== originalExtension.toLowerCase()) {
            console.log(`上传失败: 文件扩展名不匹配，需要 ${originalExtension}，但上传的是 ${uploadedExtension}`);
            return res.status(400).json({ 
                error: `File extension must be ${originalExtension}. Uploaded file has extension ${uploadedExtension}` 
            });
        }

        // 判断是否是导入的主题
        const isImportedTheme = selectedTheme.isImported === true;
        
        let themeWorkDir, originalThemeDir, targetFilePath;
        
        if (isImportedTheme) {
            // 如果是导入的主题，直接使用theme目录
            originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
            themeWorkDir = originalThemeDir; // 对于导入的主题，工作目录就是原始目录
            targetFilePath = path.join(themeWorkDir, filePath);
        } else {
            // 如果是默认主题，创建工作目录
            themeWorkDir = path.join(TEMP_DIR, themeId);
            originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
            
            // 如果工作目录不存在，复制原始主题目录
            if (!fs.existsSync(themeWorkDir)) {
                await fs.copy(originalThemeDir, themeWorkDir);
            }
            
            // 目标文件路径
            targetFilePath = path.join(themeWorkDir, filePath);
        }
        await fs.ensureDir(path.dirname(targetFilePath));
        await uploadedFile.mv(targetFilePath);

        console.log(`上传成功: 主题 ${selectedTheme.name} 文件 ${filePath} 已替换`);
        res.json({ success: true, message: 'File replaced successfully' });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Generate CMT file
app.post('/generate/:themeId', async (req, res) => {
    const themeId = req.params.themeId;
    const isImported = req.body.isImported === 'true';
    const themeName = req.body.themeName;
    const themePath = req.body.themePath;
    
    // 查找主题
    let selectedTheme;
    
    if (isImported && themePath) {
        // 如果是导入的主题，使用请求中提供的信息
        selectedTheme = {
            id: themeId,
            name: themeName || '导入的主题',
            samplePath: themePath,
            isImported: true
        };
    } else {
        // 如果是默认主题，从预设主题中查找
        const themes = CmtGenerator.getSampleThemes();
        selectedTheme = themes.find(theme => theme.id === themeId);
    }

    if (!selectedTheme) {
        console.log(`生成失败: 未找到主题 ${themeId}`);
        return res.status(404).json({ error: 'Theme not found' });
    }

    // 判断是否是导入的主题
    const isImportedTheme = selectedTheme.isImported === true;
    
    let generationSourceDir;
    
    try {
        if (isImportedTheme) {
            // 如果是导入的主题，直接使用theme目录的父目录
            const importedThemePath = selectedTheme.samplePath; // 导入的主题的根目录
            generationSourceDir = path.join(TEMP_DIR, `${themeId}_generation_temp_${Date.now()}`);
            
            // 确保临时生成目录是干净的并创建它
            await fs.remove(generationSourceDir);
            await fs.ensureDir(generationSourceDir);
            
            // 将导入的主题目录下的theme目录内容复制到生成目录的theme目录
            const themeSourceDir = path.join(importedThemePath, 'theme');
            const themeTargetDir = path.join(generationSourceDir, 'theme');
            await fs.ensureDir(themeTargetDir);

            await fs.copy(themeSourceDir, themeTargetDir);
        } else {
            // 如果是默认主题
            const userModifiedDir = path.join(TEMP_DIR, themeId); // 用户修改的文件所在目录
            const originalThemePath = path.join(selectedTheme.samplePath, 'theme'); // 原始主题目录
            generationSourceDir = path.join(TEMP_DIR, `${themeId}_generation_temp_${Date.now()}`);
            
            // 确保临时生成目录是干净的并创建它
            await fs.remove(generationSourceDir);
            await fs.ensureDir(generationSourceDir);
            
            // 创建 theme 目录
            const themeDir = path.join(generationSourceDir, 'theme');
            await fs.ensureDir(themeDir);
            
            // 将原始主题内容复制到临时生成目录的theme目录
            console.log(`默认主题，从 ${originalThemePath} 复制到 ${themeDir}`);
            await fs.copy(originalThemePath, themeDir);
            
            // 如果用户修改的目录存在，则将其内容覆盖到临时生成目录的theme目录
            if (fs.existsSync(userModifiedDir)) {
                console.log(`存在用户修改，从 ${userModifiedDir} 复制到 ${themeDir}`);
                await fs.copy(userModifiedDir, themeDir, { overwrite: true });
            }
        }
        
        // Generate CMT file using the prepared generationSourceDir
        const outputFileName = `${selectedTheme.name.replace(/\s+/g, '_')}_theme.cmt`;
        const outputPath = path.join(OUTPUT_DIR, outputFileName);
        
        await CmtGenerator.generateCMT(generationSourceDir, outputPath);
        
        console.log(`生成成功: 主题 ${selectedTheme.name} 的CMT文件已生成 - ${outputFileName}`);
        res.json({ 
            success: true, 
            message: 'CMT file generated successfully',
            downloadPath: `/download/${outputFileName}`
        });
    } catch (error) {
        console.error('Error generating CMT file:', error);
        res.status(500).json({ error: 'Failed to generate CMT file' });
    } finally {
        // 4. 清理临时生成目录
        if (fs.existsSync(generationSourceDir)) {
            await fs.remove(generationSourceDir);
        }
    }
});

// Download generated CMT file
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(OUTPUT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        console.log(`下载失败: 文件 ${filename} 不存在`);
        return res.status(404).send('File not found');
    }
    
    console.log(`下载开始: 文件 ${filename}`);
    res.download(filePath);
});

// Preview theme file
app.get('/preview/:themeId/*', async (req, res) => {
    try {
        const themeId = req.params.themeId;
        const filePath = req.params[0]; // 获取匹配/*的所有路径部分
        const isImported = req.query.imported === 'true';
        const themeName = req.query.name;
        const themePath = req.query.path;
        
        console.log(`预览请求参数: themeId=${themeId}, filePath=${filePath}, isImported=${isImported}, themeName=${themeName}, themePath=${themePath}`);
        
        if (isImported && !themePath && process.env.NODE_ENV !== 'production') {
            // 在开发环境中，如果是导入的主题但是没有路径参数，尝试从临时目录构造路径
            console.log(`尝试从临时目录构造路径给导入的主题 ${themeId}`);
            const constructedPath = path.join(TEMP_DIR, themeId);
            if (fs.existsSync(constructedPath)) {
                console.log(`找到导入主题的路径: ${constructedPath}`);
                req.query.path = constructedPath;
            }
        }
        
        // 使用主题处理模块获取文件预览
        const fileInfo = await themeHandler.getFilePreview(
            themeId,
            filePath,
            isImported,
            themeName,
            req.query.path, // 使用可能更新过的path
            TEMP_DIR,
            CmtGenerator
        );
        
        // 设置内容类型
        res.setHeader('Content-Type', fileInfo.contentType);
        
        console.log(`预览文件: ${filePath}, 内容类型: ${fileInfo.contentType}`);
        
        if (process.env.NODE_ENV === 'production' && fileInfo.isBlob) {
            // 在生产环境中，对于从Blob Storage获取的文件，可以选择重定向到URL或直接发送内容
            if (fileInfo.contentType.startsWith('image/') || fileInfo.contentType === 'video/mp4') {
                // 对于媒体文件，可以重定向到Blob URL以提高性能
                return res.redirect(fileInfo.url);
            } else {
                // 对于其他文件，发送内容
                return res.send(fileInfo.content);
            }
        } else {
            // 在开发环境中或非blob文件，直接发送文件内容
            if (fileInfo.contentType.startsWith('image/') || fileInfo.contentType === 'video/mp4') {
                // 对于媒体文件，流式传输
                const fileStream = fs.createReadStream(fileInfo.path);
                return fileStream.pipe(res);
            } else {
                // 对于其他文件，提供下载
                return res.download(fileInfo.path);
            }
        }
    } catch (error) {
        console.error('预览文件失败:', error);
        res.status(500).send(`预览文件失败: ${error.message}`);
    }
});

// Reset the theme (remove custom uploads)
app.post('/reset/:themeId', async (req, res) => {
    try {
        const themeId = req.params.themeId;
        const themePath = req.body.themePath;
        const isImported = req.body.isImported === 'true';
        
        // 如果是导入的主题，需要重新解压
        if (isImported && themePath) {
            const tempDir = themePath;
            const decryptedFilePath = path.join(tempDir, 'decrypted.dcmt');
            const extractDir = path.join(tempDir, 'theme');
            
            // 检查解密文件是否存在
            if (fs.existsSync(decryptedFilePath)) {
                // 先删除现有的theme目录
                if (fs.existsSync(extractDir)) {
                    await fs.remove(extractDir);
                }
                
                // 重新创建解压目录
                await fs.ensureDir(extractDir);
                
                // 重新解压文件
                await extract(decryptedFilePath, { dir: tempDir });
                console.log(`重置成功: 导入的主题 ${themeId} 已重新解压`);
                
                // 检查解压后的文件结构，确保theme目录存在并有内容
                const hasThemeDir = fs.existsSync(extractDir) && (await fs.readdir(extractDir)).length > 0;
                if (!hasThemeDir) {
                    // 如果没有theme目录或目录为空，创建一个并将所有文件移动到其中
                    await fs.ensureDir(extractDir);
                    
                    // 获取tempDir中的所有文件和目录（排除theme目录本身和临时文件）
                    const items = await fs.readdir(tempDir);
                    for (const item of items) {
                        if (item !== 'theme' && item !== 'original.cmt' && item !== 'decrypted.dcmt') {
                            const itemPath = path.join(tempDir, item);
                            const targetPath = path.join(extractDir, item);
                            await fs.move(itemPath, targetPath);
                        }
                    }
                    console.log('已将文件移动到theme目录');
                }
            } else {
                console.log(`重置失败: 找不到导入的主题 ${themeId} 的解密文件`);
                return res.status(404).json({ error: '找不到导入的主题的解密文件' });
            }
        } else {
            // 如果是默认主题，只需要删除工作目录
            const themeWorkDir = path.join(TEMP_DIR, themeId);
            
            if (fs.existsSync(themeWorkDir)) {
                await fs.remove(themeWorkDir);
                console.log(`重置成功: 主题 ${themeId} 已重置为默认状态`);
            } else {
                console.log(`重置提示: 主题 ${themeId} 没有自定义内容，无需重置`);
            }
        }
        
        res.json({ success: true, message: 'Theme reset successfully' });
    } catch (error) {
        console.error('Error resetting theme:', error);
        res.status(500).json({ error: 'Failed to reset theme' });
    }
});

// Start the server
const startServer = async () => {
    let portToListenOn;

    if (process.env.PORT) {
        portToListenOn = parseInt(process.env.PORT, 10);
        if (isNaN(portToListenOn)) {
            console.error(`Error: Invalid PORT environment variable value "${process.env.PORT}". It must be a number.`);
            process.exit(1);
            return;
        }
    } else {
        // Not running on Vercel or similar (no process.env.PORT), find a port for local dev
        try {
            portToListenOn = await portfinder.getPortPromise({
                port: 3333,    // Default port to start searching from
                stopPort: 3383 // Upper limit for port search
            });
        } catch (err) {
            console.error("Failed to find an available port using portfinder:", err);
            console.error("Please ensure a port in the range 3333-3383 is free, or specify one using the PORT environment variable if applicable.");
            process.exit(1);
            return; 
        }
    }

    const server = app.listen(portToListenOn, () => {
        console.log(`Server is running on http://localhost:${portToListenOn}`);
    });

    server.on('error', (err) => { 
        if (err.code === 'EADDRINUSE') {
            console.error(`Error: Port ${portToListenOn} is already in use.`);
            if (process.env.PORT) {
                console.error(`This port was specified by the PORT environment variable.`);
            } else {
                console.error(`The default port or a port found by portfinder is in use.`);
            }
            console.error("Please try again, free the port, or specify a different PORT environment variable if applicable.");
        } else {
            console.error("Failed to start server:", err);
        }
        process.exit(1);
    });
};

startServer(); // 调用异步函数来启动服务器 