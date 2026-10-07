// Point the app at the TEST database before any app module loads config.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://servicehub:servicehub@localhost:5432/servicehub_test';
process.env.JWT_ACCESS_SECRET ||= 'test-secret-test-secret-test-secret-123456';
process.env.BCRYPT_ROUNDS = '4';
process.env.UPLOAD_DIR = '/tmp/servicehub-test-uploads';
