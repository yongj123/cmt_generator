const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs-extra');
const CmtGenerator = require('./cmtGenerator');
const portfinder = require('portfinder');

const app = express();

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

fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// Main page - display available themes
app.get('/', (req, res) => {
    const themes = CmtGenerator.getSampleThemes();
    res.render('index', { themes });
});

// Theme details page - display file tree
app.get('/theme/:id', async (req, res) => {
    try {
        const themeId = req.params.id;
        const themes = CmtGenerator.getSampleThemes();
        const selectedTheme = themes.find(theme => theme.id === themeId);
        
        if (!selectedTheme) {
            return res.status(404).send('Theme not found');
        }

        const themeDir = path.join(selectedTheme.samplePath, 'theme');
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
        
        // Find the theme
        const themes = CmtGenerator.getSampleThemes();
        const selectedTheme = themes.find(theme => theme.id === themeId);
        
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

        // Create temp theme directory if it doesn't exist
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
        
        // Copy theme directory if it doesn't exist yet
        if (!fs.existsSync(themeWorkDir)) {
            await fs.copy(originalThemeDir, themeWorkDir);
        }

        // Save the uploaded file to the temp directory
        const targetFilePath = path.join(themeWorkDir, filePath);
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
    const themes = CmtGenerator.getSampleThemes();
    const selectedTheme = themes.find(theme => theme.id === themeId);

    if (!selectedTheme) {
        console.log(`生成失败: 未找到主题 ${themeId}`);
        return res.status(404).json({ error: 'Theme not found' });
    }

    const userModifiedDir = path.join(TEMP_DIR, themeId); // 用户修改的文件所在目录
    const originalThemePath = path.join(selectedTheme.samplePath, 'theme'); // 原始主题目录
    const generationSourceDir = path.join(TEMP_DIR, `${themeId}_generation_temp_${Date.now()}`);

    try {
        // 1. 确保临时生成目录是干净的并创建它
        await fs.remove(generationSourceDir); 
        await fs.ensureDir(generationSourceDir);

        // 2. 将原始主题完整复制到临时生成目录
        await fs.copy(originalThemePath, generationSourceDir);

        // 3. 如果用户修改的目录存在，则将其内容覆盖到临时生成目录
        if (fs.existsSync(userModifiedDir)) {
            await fs.copy(userModifiedDir, generationSourceDir, { overwrite: true });
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
        
        // 查找主题
        const themes = CmtGenerator.getSampleThemes();
        const selectedTheme = themes.find(theme => theme.id === themeId);
        
        if (!selectedTheme) {
            console.log(`预览失败: 未找到主题 ${themeId}`);
            return res.status(404).send('Theme not found');
        }

        // 检查是否有自定义版本的文件
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        const originalThemeDir = path.join(selectedTheme.samplePath, 'theme');
        
        let fullFilePath;
        if (fs.existsSync(themeWorkDir) && fs.existsSync(path.join(themeWorkDir, filePath))) {
            fullFilePath = path.join(themeWorkDir, filePath);
        } else {
            fullFilePath = path.join(originalThemeDir, filePath);
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
        const themeWorkDir = path.join(TEMP_DIR, themeId);
        
        if (fs.existsSync(themeWorkDir)) {
            await fs.remove(themeWorkDir);
            console.log(`重置成功: 主题 ${themeId} 已重置为默认状态`);
        } else {
            console.log(`重置提示: 主题 ${themeId} 没有自定义内容，无需重置`);
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