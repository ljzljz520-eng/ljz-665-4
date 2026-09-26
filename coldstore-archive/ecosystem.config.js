module.exports = {
  apps: [{
    name: 'coldstore-archive',
    script: 'src/server.js',
    env: { NODE_ENV: 'production', PORT: 3000 },
    max_memory_restart: '300M',
  }],
};
