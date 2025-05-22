# CMT Generator (CMT 主题生成工具)

## 项目概述

CMT Generator 是一个用于生成 CMT 主题文件的工具，支持主题文件的预览、自定义和打包。该工具提供了一个友好的 Web 界面，允许用户选择预设主题模板，替换模板中的文件，并生成加密的 CMT 主题文件。

## 技术架构

- **前端**：HTML, CSS, JavaScript, Bootstrap 5, EJS 模板引擎
- **后端**：Node.js, Express.js
- **部署**：支持NGINX部署

## 核心功能

1. **主题浏览**：提供多个预设主题模板供选择
2. **文件预览**：查看主题中的文件，包括图片预览
3. **文件替换**：上传文件替换主题模板中的原始文件
4. **主题重置**：将自定义的主题重置为原始状态
5. **CMT 生成**：将主题打包并加密为 CMT 文件
6. **文件下载**：下载生成的 CMT 主题文件

## 项目结构

```
cmt_generator/
├── app.js                   # 主应用程序入口（Express服务器）
├── cmtGenerator.js          # CMT生成器核心类
├── aesUtil.js               # AES加密工具
├── package.json             # 项目配置和依赖
├── views/                   # EJS模板文件
│   ├── index.ejs            # 主页 - 展示可用主题
│   └── theme.ejs            # 主题编辑页面
├── public/                  # 静态资源
│   ├── css/                 # 样式文件
│   └── js/                  # 客户端脚本
├── assets/                  # 主题资源文件
│   ├── 蝴蝶/                # Next Tech主题模板
│   ├── 3D 金魚水族箱/       # Koi主题模板
│   ├── 紅色花瓣/            # Solar主题模板
│   ├── 月夜/                # Ice Wolf主题模板
│   └── 3D實景科技/          # Video主题模板
├── temp/                    # 临时文件目录
└── output/                  # 输出文件目录
```

## API接口

### 页面路由

- `GET /` - 首页，显示所有可用的主题模板
- `GET /theme/:id` - 主题编辑页面，显示特定主题的文件结构

### 文件处理接口

- `GET /preview/:themeId/*` - 预览主题文件
- `POST /upload/:themeId` - 上传并替换主题文件
- `POST /reset/:themeId` - 重置主题到原始状态
- `POST /generate/:themeId` - 生成加密的CMT主题文件
- `GET /download/:filename` - 下载生成的CMT文件

## 使用方法

### 本地开发

```bash
# 安装依赖
npm install

# 启动服务器
npm start
```

服务器将在端口3333（或自动选择的下一个可用端口）上运行。

### NGINX部署

项目支持部署到NGINX服务器：

1. 在服务器上安装Node.js环境（推荐v16或更高版本）
2. 克隆或上传项目代码到服务器
3. 安装项目依赖：`npm install`
4. 使用PM2启动应用：`pm2 start app.js --name "cmt-generator"`
5. 配置NGINX作为反向代理：

```nginx
server {
    listen 80;
    server_name your-domain.com; # 替换为你的域名

    location / {
        proxy_pass http://localhost:3333; # 指向Node.js应用
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M; # 允许上传大小限制
    }
}
```

6. 重启NGINX：`sudo service nginx restart`

### 环境变量配置

可以通过以下环境变量自定义应用配置：

- `PORT`: 应用监听端口（默认自动查找3333-3383范围内可用端口）
- `APP_TEMP_DIR`: 临时文件目录（默认为项目根目录下的`temp`文件夹）
- `APP_OUTPUT_DIR`: 输出文件目录（默认为项目根目录下的`output`文件夹）
- `NODE_ENV`: 设置为`production`以启用生产环境优化

## 核心流程

1. 用户从首页选择一个主题模板
2. 进入主题编辑页面，可以看到主题文件结构
3. 用户可以点击文件进行预览，或使用"替换"按钮上传新文件
4. 完成自定义后，点击"生成CMT文件"按钮
5. 系统将主题文件打包为zip格式，然后使用AES加密为CMT文件
6. 用户可以下载生成的CMT文件

## 安全机制

- 使用AES-128-CBC加密算法保护CMT文件内容
- 文件上传时校验文件类型，确保安全性
- 临时文件处理，定期清理

## 注意事项

1. 此工具仅供内部使用
2. 默认支持的主题模板包括：Next Tech、Koi、Solar、Ice Wolf和Video
3. 生成的CMT文件命名格式为：`[主题名称]_theme.cmt`
4. 部署到NGINX服务器时，临时文件和输出文件会保存在服务器的文件系统中，需定期清理