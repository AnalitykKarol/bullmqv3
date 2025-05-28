import { envsafe, port, str } from 'envsafe';

export const env = envsafe({
  REDISHOST: str(),
  REDISPORT: port(),
  REDISUSER: str(),
  REDISPASSWORD: str(),
  PORT: port({
    devDefault: 3000,
  }),
  RAILWAY_STATIC_URL: str({
    devDefault: 'http://localhost:3000',
  }),
  N8N_WEBHOOK_URL: str({
    devDefault: 'https://primary-production-f08e.up.railway.app/webhook/e6b2e3ac-1548-4583-8e75-dc40b3875505',
  }),
});