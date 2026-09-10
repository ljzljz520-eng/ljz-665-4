module.exports = {
  apps: [{
    name: 'coldstore-archive',
    script: 'server/index.js',
    instances: 1,          // 使用内存会话与 SQLite，单实例即可；如需多实例请改用 redis 会话
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
