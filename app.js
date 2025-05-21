const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs-extra');
const CmtGenerator = require('./cmtGenerator');
const portfinder = require('portfinder');
const AesUtil = require('./aesUtil');
const extract = require('extract-zip');
const { v4: uuidv4 } = require('uuid');

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

// Create temp and output directories
// 为Vercel部署和本地开发环境提供临时目录和输出目录
const TEMP_DIR = process.env.APP_TEMP_DIR || path.join(require('os').tmpdir(), 'cmt_generator_temp');
const OUTPUT_DIR = process.env.APP_OUTPUT_DIR || path.join(require('os').tmpdir(), 'cmt_generator_output');

console.log(`App.js using TEMP_DIR: ${TEMP_DIR}`);
console.log(`App.js using OUTPUT_DIR: ${OUTPUT_DIR}`);

// 确保临时目录和输出目录存在
try {
    fs.ensureDirSync(TEMP_DIR);
    fs.ensureDirSync(OUTPUT_DIR);
    console.log('成功创建临时目录和输出目录');
} catch (error) {
    console.error('创建临时目录或输出目录失败:', error);
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
        const tempDir = path.join(TEMP_DIR, importedThemeId);
        const cmtFilePath = path.join(tempDir, 'original.cmt');
        const decryptedFilePath = path.join(tempDir, 'decrypted.dcmt');
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
            // 有些CMT文件解压后可能直接包含主题文件，而不是在theme子目录中
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
        
        // 创建导入的主题对象 - 不再存储在会话中
        const themeName = path.basename(cmtFile.name, '.cmt');
        
        // 直接将主题信息作为URL参数传递
        res.json({ 
            success: true, 
            message: 'CMT文件导入成功',
            redirectUrl: `/theme/${importedThemeId}?name=${encodeURIComponent(themeName)}&imported=true&path=${encodeURIComponent(tempDir)}`
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
        let selectedTheme;
        
        if (isImported) {
            // 从URL参数中获取导入的主题信息
            const themeName = req.query.name || '导入的主题';
            const themePath = req.query.path;
            
            if (!themePath) {
                console.log(`导入的主题路径未提供: ${themeId}`);
                return res.status(400).send('Theme path not provided');
            }
            
            selectedTheme = {
                id: themeId,
                name: themeName,
                samplePath: themePath,
                isImported: true
            };
        } else {
            // 获取默认主题
            const themes = CmtGenerator.getSampleThemes();
            selectedTheme = themes.find(theme => theme.id === themeId);
        }
        
        if (!selectedTheme) {
            console.log(`主题未找到: ${themeId}`);
            return res.status(404).send('Theme not found');
        }

        // 检查是否有用户修改的工作目录
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
        
        let themeDir;
        
        // 判断是否是导入的主题
        const isImportedTheme = selectedTheme.isImported === true;
        
        if (isImportedTheme) {
            // 如果是导入的主题，始终使用theme子目录
            themeDir = path.join(selectedTheme.samplePath, 'theme');
            console.log(`导入的主题，使用theme目录: ${themeDir}`);
        } else {
            // 如果是默认主题，使用工作目录（如果存在），否则使用原始主题目录
            themeDir = fs.existsSync(themeWorkDir) ? themeWorkDir : originalThemeDir;
            console.log(`默认主题，使用目录: ${themeDir}`);
        }
        
        // 获取文件树
        const fileTree = await CmtGenerator.getFileTree(themeDir);
        
        res.render('theme', { 
            theme: selectedTheme,
            fileTree
        });
    } catch (error) {
        console.error('Error loading theme details:', error);
        res.status(500).send('Error loading theme details');
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
        const folderPath = req.body.path || ''; // 目标路径，如果未提供则为根目录
        const isImported = req.query.imported === 'true';
        const themeName = req.query.name;
        const themePath = req.query.path;
        
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

        // 获取上传的文件夹（实际上是zip文件）
        const uploadedFolder = req.files.folder;
        
        // 创建临时目录用于解压
        const tempExtractDir = path.join(TEMP_DIR, `${themeId}_folder_extract_${Date.now()}`);
        await fs.ensureDir(tempExtractDir);
        
        // 保存上传的zip文件
        const zipFilePath = path.join(tempExtractDir, 'folder.zip');
        await uploadedFolder.mv(zipFilePath);
        
        // 解压zip文件
        await extract(zipFilePath, { dir: tempExtractDir });
        
        // 获取文件夹名称（假设上传的文件夹在zip的根目录）
        const folderName = path.basename(folderPath) || path.basename(uploadedFolder.name, '.zip');
        
        // 确定主题工作目录和目标文件夹路径
        let themeWorkDir, originalThemeDir, targetFolderPath;
        
        // 判断是否是导入的主题
        const isImportedTheme = selectedTheme.isImported === true;
        
        if (isImportedTheme) {
            // 如果是导入的主题，确保theme目录存在
            originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
            await fs.ensureDir(originalThemeDir);
            
            // 检查theme目录是否为空，如果为空，则将主目录中的文件复制到theme子目录
            const files = await fs.readdir(originalThemeDir);
            if (files.length === 0) {
                console.log('导入主题的theme目录为空，复制文件到theme子目录');
                
                // 获取主目录中的所有文件和目录（排除theme目录本身和临时文件）
                const mainDirItems = await fs.readdir(selectedTheme.samplePath);
                for (const item of mainDirItems) {
                    if (item !== 'theme' && item !== 'original.cmt' && item !== 'decrypted.dcmt') {
                        const itemPath = path.join(selectedTheme.samplePath, item);
                        const targetPath = path.join(originalThemeDir, item);
                        
                        // 检查源路径是否存在
                        if (await fs.pathExists(itemPath)) {
                            try {
                                await fs.copy(itemPath, targetPath);
                                console.log(`复制 ${itemPath} 到 ${targetPath}`);
                            } catch (copyError) {
                                console.error(`复制 ${itemPath} 到 ${targetPath} 失败:`, copyError);
                            }
                        }
                    }
                }
            }
            
            themeWorkDir = originalThemeDir; // 对于导入的主题，工作目录就是原始目录
            targetFolderPath = path.join(themeWorkDir, folderPath);
        } else {
            // 如果是默认主题，创建工作目录
            themeWorkDir = path.join(TEMP_DIR, themeId);
            originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
            
            // 如果工作目录不存在，先从原始主题复制
            if (!fs.existsSync(themeWorkDir)) {
                await fs.ensureDir(themeWorkDir);
                await fs.copy(originalThemeDir, themeWorkDir);
                console.log(`已创建主题 ${themeId} 的工作目录并复制原始文件`);
            }
            
            targetFolderPath = path.join(themeWorkDir, folderPath);
        }
        
        // 如果解压目录中有与目标文件夹同名的文件夹，直接使用它
        const extractedFolderPath = path.join(tempExtractDir, folderName);
        
        // 创建目标文件夹
        await fs.ensureDir(targetFolderPath);
        
        // 如果目标路径已存在同名文件夹，先删除它
        const targetFolder = path.join(targetFolderPath, folderName);
        if (fs.existsSync(targetFolder)) {
            await fs.remove(targetFolder);
            console.log(`已删除现有文件夹: ${targetFolder}`);
        }
        
        // 复制解压后的文件夹到目标位置
        if (fs.existsSync(extractedFolderPath)) {
            await fs.copy(extractedFolderPath, targetFolder);
            console.log(`已复制文件夹 ${extractedFolderPath} 到 ${targetFolder}`);
        } else {
            // 如果没有找到同名文件夹，尝试复制解压目录中的所有内容
            const items = await fs.readdir(tempExtractDir);
            for (const item of items) {
                if (item !== 'folder.zip') {
                    const itemPath = path.join(tempExtractDir, item);
                    const itemTargetPath = path.join(targetFolderPath, item);
                    await fs.copy(itemPath, itemTargetPath);
                }
            }
            console.log(`已复制解压目录中的所有内容到 ${targetFolderPath}`);
        }
        
        // 清理临时解压目录
        await fs.remove(tempExtractDir);
        
        // 获取更新后的文件树 - 对于导入的主题，确保从theme目录获取
        const fileTreeDir = isImportedTheme ? originalThemeDir : themeWorkDir;
        console.log(`获取文件树，使用目录: ${fileTreeDir}`);
        const fileTree = await CmtGenerator.getFileTree(fileTreeDir);
        
        res.json({ 
            success: true, 
            message: 'Folder uploaded successfully',
            fileTree: fileTree
        });
    } catch (error) {
        console.error('Error uploading folder:', error);
        res.status(500).json({ error: 'Failed to upload folder' });
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

// 处理生成CMT文件的请求
app.post('/generate-cmt/:themeId', async (req, res) => {
    try {
        const themeId = req.params.themeId;
        const isImported = req.query.imported === 'true';
        const themeName = req.query.name || 'Theme';
        const themePath = req.query.path;
        
        // 查找主题
        let selectedTheme;
        
        if (isImported && themePath) {
            // 如果是导入的主题，使用请求中提供的信息
            selectedTheme = {
                id: themeId,
                name: themeName,
                samplePath: themePath,
                isImported: true
            };
        } else {
            // 如果是默认主题，从预设主题中查找
            const themes = CmtGenerator.getSampleThemes();
            selectedTheme = themes.find(theme => theme.id === themeId);
        }
        
        if (!selectedTheme) {
            return res.status(404).json({ error: 'Theme not found' });
        }
        
        // 确定主题目录
        let themeDir;
        
        // 判断是否是导入的主题
        const isImportedTheme = selectedTheme.isImported === true;
        
        if (isImportedTheme) {
            // 如果是导入的主题，先检查theme子目录是否存在
            const themeSubDir = path.join(selectedTheme.samplePath, 'theme');
            
            // 确保theme目录存在
            try {
                await fs.ensureDir(themeSubDir);
                console.log(`确保导入主题的theme目录存在: ${themeSubDir}`);
                
                // 检查theme目录是否为空，如果为空，则将主目录中的文件复制到theme子目录
                const files = await fs.readdir(themeSubDir);
                if (files.length === 0) {
                    console.log('theme目录为空，复制文件到theme子目录');
                    
                    // 获取主目录中的所有文件和目录（排除theme目录本身和临时文件）
                    const mainDirItems = await fs.readdir(selectedTheme.samplePath);
                    for (const item of mainDirItems) {
                        if (item !== 'theme' && item !== 'original.cmt' && item !== 'decrypted.dcmt') {
                            const itemPath = path.join(selectedTheme.samplePath, item);
                            const targetPath = path.join(themeSubDir, item);
                            
                            // 检查源路径是否存在
                            if (await fs.pathExists(itemPath)) {
                                try {
                                    await fs.copy(itemPath, targetPath);
                                    console.log(`复制 ${itemPath} 到 ${targetPath}`);
                                } catch (copyError) {
                                    console.error(`复制 ${itemPath} 到 ${targetPath} 失败:`, copyError);
                                }
                            }
                        }
                    }
                }
            } catch (dirError) {
                console.error('确保theme目录存在时出错:', dirError);
            }
            
            themeDir = themeSubDir;
        } else {
            // 如果是默认主题，检查是否有自定义版本
            const themeWorkDir = path.join(TEMP_DIR, themeId);
            
            if (fs.existsSync(themeWorkDir)) {
                // 如果有自定义版本，使用自定义版本
                themeDir = themeWorkDir;
            } else {
                // 否则使用原始主题目录
                themeDir = path.join(selectedTheme.samplePath, 'theme');
            }
        }
        
        // 生成输出文件名
        const outputFileName = `${themeName.replace(/[^a-zA-Z0-9]/g, '_')}.cmt`;
        const outputPath = path.join(OUTPUT_DIR, outputFileName);
        
        // 确保主题目录存在且有内容
        if (!(await fs.pathExists(themeDir))) {
            console.error(`主题目录不存在: ${themeDir}`);
            return res.status(500).json({ error: `主题目录不存在: ${themeDir}` });
        }
        
        // 生成CMT文件
        await CmtGenerator.generateCMT(themeDir, outputPath);
        
        // 返回下载链接
        res.json({
            success: true,
            downloadUrl: `/download/${encodeURIComponent(outputFileName)}`
        });
    } catch (error) {
        console.error('Error generating CMT file:', error);
        res.status(500).json({ error: 'Failed to generate CMT file' });
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
            console.log(`预览失败: 未找到主题 ${themeId}`);
            return res.status(404).send('Theme not found');
        }

        // 检查是否有自定义版本的文件
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
        
        // 判断是否是导入的主题
        const isImportedTheme = selectedTheme.isImported === true;
        
        let fullFilePath;
        if (isImportedTheme) {
            // 如果是导入的主题，始终从 theme 目录中获取文件
            fullFilePath = path.join(originalThemeDir, filePath);
            console.log(`导入的主题，从 theme 目录获取文件: ${fullFilePath}`);
            
            // 如果文件不存在，尝试不使用theme子目录的路径
            if (!fs.existsSync(fullFilePath)) {
                const alternativePath = path.join(selectedTheme.samplePath, filePath);
                console.log(`尝试替代路径: ${alternativePath}`);
                if (fs.existsSync(alternativePath)) {
                    fullFilePath = alternativePath;
                    console.log(`使用替代路径: ${fullFilePath}`);
                }
            }
        } else if (fs.existsSync(themeWorkDir) && fs.existsSync(path.join(themeWorkDir, filePath))) {
            // 如果是默认主题且有自定义版本，使用自定义版本
            fullFilePath = path.join(themeWorkDir, filePath);
            console.log(`默认主题，使用自定义文件: ${fullFilePath}`);
        } else {
            // 否则使用原始文件
            fullFilePath = path.join(originalThemeDir, filePath);
            console.log(`默认主题，使用原始文件: ${fullFilePath}`);
        }
        
        if (!fs.existsSync(fullFilePath)) {
            console.log(`预览失败: 文件 ${filePath} 不存在`);
            return res.status(404).send('File not found');
        }
        
        // 获取文件扩展名
        const ext = path.extname(fullFilePath).toLowerCase();
        
        console.log(`预览文件: 主题 ${selectedTheme.name} 的文件 ${filePath}`);
        // 如果是图片文件，直接显示
        if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
            // 设置正确的内容类型
            if (ext === '.jpg' || ext === '.jpeg') {
                res.setHeader('Content-Type', 'image/jpeg');
            } else if (ext === '.png') {
                res.setHeader('Content-Type', 'image/png');
            } else if (ext === '.gif') {
                res.setHeader('Content-Type', 'image/gif');
            } else if (ext === '.bmp') {
                res.setHeader('Content-Type', 'image/bmp');
            } else if (ext === '.webp') {
                res.setHeader('Content-Type', 'image/webp');
            }
            
            // 读取文件并发送
            const fileStream = fs.createReadStream(fullFilePath);
            fileStream.pipe(res);
        } else {
            // 其他类型文件，提供下载
            res.download(fullFilePath);
        }
    } catch (error) {
        console.error('Error previewing file:', error);
        res.status(500).send('Error previewing file');
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