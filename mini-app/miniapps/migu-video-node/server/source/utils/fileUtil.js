import fs from "node:fs"
function createFile(filePath) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, "")
  }
}

function writeFile(filePath, content) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, content, error => {
      if (error) {
        reject(new Error(`${filePath}:写入${content}失败`));
        return;
      }
      resolve();
    });
  });
}

function appendFile(filePath, content) {
  return new Promise((resolve, reject) => {
    fs.appendFile(filePath, content, error => {
      if (error) {
        reject(new Error(`${filePath}:追加${content}失败`));
        return;
      }
      resolve();
    });
  });
}

function appendFileSync(filePath, content) {
  try {
    fs.appendFileSync(filePath, content);
  } catch (error) {
    throw new Error(`${filePath}:同步追加${content}失败`);
  }
}

function readFileSync(filePath) {
  return fs.readFileSync(filePath)
}

function renameFileSync(oldFilePath, newFilePath) {
  try {
    fs.renameSync(oldFilePath, newFilePath);
  } catch (err) {
    throw new Error(`文件重命名失败${oldFilePath} -> ${newFilePath}`);
  }
}
function copyFileSync(filePath, newFilePath, mode) {
  try {
    fs.copyFileSync(filePath, newFilePath, mode);
  } catch (err) {
    throw new Error(`文件复制失败${filePath} -> ${newFilePath}`);
  }
}

export { createFile, writeFile, appendFile, appendFileSync, readFileSync, renameFileSync, copyFileSync }
