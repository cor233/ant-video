module.exports = {
  // API 密码为空表示沿用原项目的公开模式；建议部署后设置密码。
  API_PWD: '',
  // 留空后 miniapp:// 接口可直接被宿主消费；局域网共享仍受宿主共享令牌保护。
  API_AUTH_NAME: '',
  API_AUTH_CODE: '',
  API_TIMEOUT: '20',
  API_ACTION_TIMEOUT: '60',
  LOG_LEVEL: 'warn',
  LOG_WITH_FILE: '0',
};
