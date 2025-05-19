const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const AesUtil = require('./aesUtil');

class CmtGenerator {
    /**
     * Generate a CMT file from a theme directory
     * @param {string} themeDir - Source directory of the theme
     * @param {string} outputPath - Path for the output CMT file
     * @returns {Promise<boolean>} - Whether the operation succeeded
     */
    static async generateCMT(themeDir, outputPath) {
        try {
            // Create output directory if it doesn't exist
            const outputDir = path.dirname(outputPath);
            await fs.ensureDir(outputDir);

            // Create intermediate zip file
            const intermediateZipPath = `${outputPath}.zip`;
            await this.zipDirectory(themeDir, intermediateZipPath);

            // Encrypt the zip file to create the CMT file
            await AesUtil.encryptFile(intermediateZipPath, outputPath);

            // Delete the intermediate zip file
            await fs.remove(intermediateZipPath);

            return true;
        } catch (error) {
            console.error('Error generating CMT file:', error);
            throw error;
        }
    }

    /**
     * Create a zip file from a directory
     * @param {string} sourceDir - Source directory to zip
     * @param {string} outputPath - Path for the output zip file
     * @returns {Promise<void>}
     */
    static zipDirectory(sourceDir, outputPath) {
        return new Promise((resolve, reject) => {
            // Create a file to stream archive data to
            const output = fs.createWriteStream(outputPath);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Best compression
            });

            // Listen for all archive data to be written
            output.on('close', () => {
                resolve();
            });

            // Good practice to catch warnings
            archive.on('warning', (err) => {
                if (err.code === 'ENOENT') {
                    console.warn(err);
                } else {
                    reject(err);
                }
            });

            // Handle errors
            archive.on('error', (err) => {
                reject(err);
            });

            // Pipe archive data to the file
            archive.pipe(output);

            // 获取目录中的所有文件和子目录
            const walkSync = (dir, baseDir) => {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    const relativePath = path.relative(baseDir, filePath);
                    
                    if (stat.isDirectory()) {
                        // 递归处理子目录
                        walkSync(filePath, baseDir);
                    } else {
                        // 添加文件到压缩包，保持相对路径结构
                        archive.file(filePath, { name: `theme/${relativePath}` });
                    }
                });
            };
            
            // 遍历目录并添加所有文件
            walkSync(sourceDir, sourceDir);

            // Finalize the archive
            archive.finalize();
        });
    }

    /**
     * Get a list of sample themes with their paths
     * @returns {Object[]} Array of theme objects
     */
    static getSampleThemes() {
        const appPath = process.env.APP_PATH;
        let assetsRoot;

        if (appPath && appPath.includes('app.asar')) {
            // Packaged app: assets are in app.asar.unpacked
            assetsRoot = path.join(path.dirname(appPath), 'app.asar.unpacked', 'assets');
        } else if (appPath) {
            // Development: assets are relative to appPath (project root)
            assetsRoot = path.join(appPath, 'assets');
        } else {
            // Fallback for safety, though APP_PATH should always be set
            // This assumes cmtGenerator.js and assets are relative to __dirname in a flat structure or common root
            assetsRoot = path.join(__dirname, 'assets');
            console.warn('APP_PATH environment variable not found, falling back to __dirname for assets path. This might be incorrect in packaged app.');
        }

        return [
            {
                id: 'next-tech',
                name: 'Next Tech',
                samplePath: path.join(assetsRoot, '蝴蝶')
            },
            {
                id: 'koi',
                name: 'Koi',
                samplePath: path.join(assetsRoot, '3D 金魚水族箱')
            },
            {
                id: 'solar',
                name: 'Solar',
                samplePath: path.join(assetsRoot, '紅色花瓣')
            },
            {
                id: 'ice-wolf',
                name: 'Ice Wolf',
                samplePath: path.join(assetsRoot, '月夜')
            },
            {
                id: 'video',
                name: 'Video',
                samplePath: path.join(assetsRoot, '3D實景科技')
            }
        ];
    }

    /**
     * Get the file tree of a theme directory
     * @param {string} dirPath - Path to the directory
     * @param {string} basePath - Base path for calculating relative paths
     * @returns {Object[]} File tree structure
     */
    static async getFileTree(dirPath, basePath = null) {
        if (!basePath) {
            basePath = dirPath;
        }

        const result = [];
        const directories = [];
        const files = [];
        
        // Read directory contents
        const items = await fs.readdir(dirPath);

        // Process each item
        for (const item of items) {
            if (item === '.DS_Store') continue;

            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);
            const relativePath = path.relative(basePath, itemPath);

            if (stats.isDirectory()) {
                const children = await this.getFileTree(itemPath, basePath);
                directories.push({
                    name: item,
                    path: relativePath,
                    type: 'directory',
                    children: children
                });
            } else {
                files.push({
                    name: item,
                    path: relativePath,
                    type: 'file',
                    extension: path.extname(item).toLowerCase()
                });
            }
        }

        // Sort directories and files alphabetically
        directories.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        // Combine with directories first, then files
        return [...directories, ...files];
    }
}

module.exports = CmtGenerator; 