const fs = require('fs');
const crypto = require('crypto');

class AesUtil {
    static DEFAULT_KEY = "202CB962AC59075B964B07152D234B70";
    static DEFAULT_IV = "D1D99CA9B7EC0708C83ECCA4B635DBF1";

    static hexStringToByteArray(s) {
        const len = s.length;
        const data = Buffer.alloc(len / 2);

        for (let i = 0; i < len; i += 2) {
            data[i / 2] = (parseInt(s.charAt(i), 16) << 4) + parseInt(s.charAt(i + 1), 16);
        }
        return data;
    }

    static encryptFile(sourceFilePath, targetFilePath, key = AesUtil.DEFAULT_KEY, iv = AesUtil.DEFAULT_IV) {
        return new Promise((resolve, reject) => {
            try {
                const cipher = AesUtil.initCipher(1, key, iv); // 1 = Cipher.ENCRYPT_MODE
                
                // 创建目标文件目录（如果不存在）
                const targetDir = require('path').dirname(targetFilePath);
                fs.mkdirSync(targetDir, { recursive: true });
                
                const input = fs.createReadStream(sourceFilePath);
                const output = fs.createWriteStream(targetFilePath);

                input.pipe(cipher).pipe(output);

                output.on('finish', () => {
                    resolve(true);
                });

                output.on('error', (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    static decryptFile(sourceFilePath, targetFilePath, key = AesUtil.DEFAULT_KEY, iv = AesUtil.DEFAULT_IV) {
        return new Promise((resolve, reject) => {
            try {
                const decipher = AesUtil.initCipher(2, key, iv); // 2 = Cipher.DECRYPT_MODE
                
                // 创建目标文件目录（如果不存在）
                const targetDir = require('path').dirname(targetFilePath);
                fs.mkdirSync(targetDir, { recursive: true });
                
                const input = fs.createReadStream(sourceFilePath);
                const output = fs.createWriteStream(targetFilePath);

                input.pipe(decipher).pipe(output);

                output.on('finish', () => {
                    resolve(true);
                });

                output.on('error', (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    static initCipher(cipherMode, key, iv) {
        try {
            const secretKey = AesUtil.hexStringToByteArray(key);
            const initVector = AesUtil.hexStringToByteArray(iv);
            
            // 使用AES/CBC/PKCS5Padding，与Java实现一致
            // Node.js中没有PKCS5Padding，但PKCS7Padding与其兼容
            if (cipherMode === 1) { // ENCRYPT_MODE
                return crypto.createCipheriv('aes-128-cbc', secretKey, initVector);
            } else if (cipherMode === 2) { // DECRYPT_MODE
                return crypto.createDecipheriv('aes-128-cbc', secretKey, initVector);
            }
        } catch (err) {
            console.error(err);
            throw err;
        }
        return null;
    }
}

module.exports = AesUtil; 