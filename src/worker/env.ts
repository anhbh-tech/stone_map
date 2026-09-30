// Nạp .env trước mọi module khác (db.ts đọc DB_PATH lúc import). Next tự nạp .env; tsx thì không.
try { process.loadEnvFile('.env'); } catch { /* không có .env: chạy offline với provider mock */ }
