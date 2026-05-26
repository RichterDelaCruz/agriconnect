import { Module, Global } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';

/**
 * Redis Module — provides a singleton Redis publisher client to the
 * entire API service.
 *
 * Marked @Global so any module can inject `@Inject(REDIS_PUBLISHER)`
 * without importing RedisModule. The connection is configured via
 * environment variables REDIS_HOST and REDIS_PORT.
 *
 * This publisher is used exclusively by RequestsService to publish
 * new-request notifications to the `farmer_notifications` channel.
 *
 * Provider: REDIS_PUBLISHER — an ioredis `Redis` instance
 */
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
