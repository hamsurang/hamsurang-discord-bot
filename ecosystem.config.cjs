module.exports = {
  apps: [
    {
      name: "hamsurang-bot",
      script: "dist/index.js",
      node_args: "--env-file=.env",
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
