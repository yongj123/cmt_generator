/**
 * 打包脚本 - 将CMT生成器应用打包为部署产物
 */
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');

// 打包配置
const config = {
    // 打包排除的文件/文件夹
    excludes: [
        'node_modules',
        '.git',
        'dist',
        'temp',
        'output',
        '.DS_Store',
        '*.log',
        '*.zip'
    ],
    // 输出文件名
    outputFile: 'cmt-generator-dist.zip'
};

// 创建dist文件夹
const distPath = path.join(__dirname, 'dist');
const outputZip = path.join(__dirname, config.outputFile);

// 清理旧文件
console.log('正在清理旧的打包文件...');
fs.removeSync(distPath);
fs.removeSync(outputZip);
fs.ensureDirSync(distPath);

// 创建用于存放临时文件和输出文件的目录
fs.ensureDirSync(path.join(distPath, 'temp'));
fs.ensureDirSync(path.join(distPath, 'output'));

// 创建zip文件流
const output = fs.createWriteStream(outputZip);
const archive = archiver('zip', {
    zlib: { level: 9 } // 最高压缩级别
});

output.on('close', () => {
    const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅ 打包完成！共 ${sizeInMB}MB`);
    console.log(`📦 打包文件位置: ${outputZip}`);
    console.log('\n部署步骤:');
    console.log('1. 将生成的zip文件上传到服务器');
    console.log('2. 解压文件: unzip cmt-generator-dist.zip -d cmt-generator');
    console.log('3. 进入目录: cd cmt-generator');
    console.log('4. 安装依赖: npm install --production');
    console.log('5. 启动应用: pm2 start app.js --name "cmt-generator"');
});

archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
        console.warn('警告:', err);
    } else {
        throw err;
    }
});

archive.on('error', (err) => {
    throw err;
});

archive.pipe(output);

// 读取项目目录下的所有文件和文件夹
const rootDir = __dirname;
const allFiles = fs.readdirSync(rootDir);

// 添加文件到打包中
console.log('正在打包以下文件:');

allFiles.forEach(file => {
    const fullPath = path.join(rootDir, file);
    const relativePath = file;
    
    // 跳过被排除的文件和文件夹
    if (config.excludes.includes(file)) {
        return;
    }
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isFile()) {
        console.log(`- 文件: ${relativePath}`);
        archive.file(fullPath, { name: relativePath });
    } else if (stat.isDirectory()) {
        console.log(`- 目录: ${relativePath}`);
        archive.directory(fullPath, relativePath);
    }
});

// 创建示例环境变量配置文件
const envExampleContent = `# CMT生成器环境变量配置示例
# 重命名此文件为.env并根据需要修改

# 应用端口
PORT=3333

# 临时文件目录
APP_TEMP_DIR=./temp

# 输出文件目录
APP_OUTPUT_DIR=./output

# 环境设置
NODE_ENV=production
`;

fs.writeFileSync(path.join(distPath, '.env.example'), envExampleContent);
archive.file(path.join(distPath, '.env.example'), { name: '.env.example' });
console.log('- 文件: .env.example');

// 添加NGINX配置示例
const nginxConfigContent = `# NGINX配置示例 - 保存为 /etc/nginx/sites-available/cmt-generator
# 启用: sudo ln -s /etc/nginx/sites-available/cmt-generator /etc/nginx/sites-enabled/

server {
    listen 80;
    server_name your-domain.com;  # 替换为您的域名
    
    # 日志配置
    access_log /var/log/nginx/cmt-generator-access.log;
    error_log /var/log/nginx/cmt-generator-error.log;

    location / {
        proxy_pass http://localhost:3333;  # 指向Node应用的端口
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 允许最大50MB的上传
        client_max_body_size 50M;
    }
}
`;

fs.writeFileSync(path.join(distPath, 'nginx-example.conf'), nginxConfigContent);
archive.file(path.join(distPath, 'nginx-example.conf'), { name: 'nginx-example.conf' });
console.log('- 文件: nginx-example.conf');

// 添加PM2配置文件
const pm2ConfigContent = `{
  "apps": [
    {
      "name": "cmt-generator",
      "script": "app.js",
      "instances": 1,
      "autorestart": true,
      "watch": false,
      "max_memory_restart": "500M",
      "env": {
        "NODE_ENV": "production",
        "PORT": 3333,
        "APP_TEMP_DIR": "./temp",
        "APP_OUTPUT_DIR": "./output"
      }
    }
  ]
}
`;

fs.writeFileSync(path.join(distPath, 'ecosystem.config.json'), pm2ConfigContent);
archive.file(path.join(distPath, 'ecosystem.config.json'), { name: 'ecosystem.config.json' });
console.log('- 文件: ecosystem.config.json');

// 创建部署说明
const deploymentGuideContent = `# CMT生成器部署指南

## 服务器要求
- Node.js 16.x或更高版本
- NGINX
- PM2 (用于进程管理)

## 部署步骤

### 1. 解压部署包
\`\`\`bash
unzip cmt-generator-dist.zip -d cmt-generator
cd cmt-generator
\`\`\`

### 2. 安装依赖
\`\`\`bash
npm install --production
\`\`\`

### 3. 配置环境
\`\`\`bash
# 复制环境变量示例文件
cp .env.example .env

# 根据需要编辑
nano .env
\`\`\`

### 4. 使用PM2启动应用
方法1: 直接启动
\`\`\`bash
pm2 start app.js --name "cmt-generator"
\`\`\`

方法2: 使用配置文件启动
\`\`\`bash
pm2 start ecosystem.config.json
\`\`\`

### 5. 配置NGINX
\`\`\`bash
# 复制NGINX配置文件
sudo cp nginx-example.conf /etc/nginx/sites-available/cmt-generator

# 修改配置中的域名
sudo nano /etc/nginx/sites-available/cmt-generator

# 创建符号链接以启用站点
sudo ln -s /etc/nginx/sites-available/cmt-generator /etc/nginx/sites-enabled/

# 测试NGINX配置
sudo nginx -t

# 重启NGINX
sudo systemctl restart nginx
\`\`\`

### 6. 验证部署
访问您配置的域名或服务器IP，确认应用正常运行

## 维护

### 查看应用状态
\`\`\`bash
pm2 status
pm2 logs cmt-generator
\`\`\`

### 重启应用
\`\`\`bash
pm2 restart cmt-generator
\`\`\`

### 清理临时文件
定期清理temp和output目录以释放磁盘空间
\`\`\`bash
# 例如，清理超过7天的文件
find temp -type f -mtime +7 -exec rm {} \\;
find output -type f -mtime +7 -exec rm {} \\;
\`\`\`
`;

fs.writeFileSync(path.join(distPath, 'DEPLOY.md'), deploymentGuideContent);
archive.file(path.join(distPath, 'DEPLOY.md'), { name: 'DEPLOY.md' });
console.log('- 文件: DEPLOY.md');

// 完成归档
archive.finalize();
console.log('\n正在生成部署包，请稍候...');
