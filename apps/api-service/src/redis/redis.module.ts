import { Module, Global } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_PUBLISHER,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        }),
    },
  ],
  exports: [REDIS_PUBLISHER],
})
export class RedisModule {}
