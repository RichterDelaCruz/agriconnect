import { Test, TestingModule } from '@nestjs/testing';
import { NotificationGateway } from './notification.gateway';
import { RedisSubscriberService } from './redis-subscriber.service';

// ── Module-level Redis mock (hoisted before imports by Jest) ─────────────────

const listeners: Record<string, ((...args: string[]) => void)[]> = {};

const redisMock = {
  subscribe: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
  /** Helper used in tests to simulate incoming Redis messages */
  emit: (event: string, ...args: string[]) => {
    (listeners[event] ?? []).forEach((l) => l(...args));
  },
};

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => redisMock),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RedisSubscriberService', () => {
  let service: RedisSubscriberService;
  let gateway: { notifyFarmer: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear captured listeners between tests
    Object.keys(listeners).forEach((k) => delete listeners[k]);

    // subscribe mock: call the callback immediately (simulates ioredis behaviour)
    redisMock.subscribe.mockImplementation(
      (_channel: string, cb: (err: null, count: number) => void) => {
        cb(null, 1);
      },
    );

    // on mock: capture listeners so emit() can trigger them
    redisMock.on.mockImplementation(
      (event: string, listener: (...args: string[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(listener);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisSubscriberService,
        { provide: NotificationGateway, useValue: { notifyFarmer: jest.fn() } },
      ],
    }).compile();

    service = module.get(RedisSubscriberService);
    gateway = module.get(NotificationGateway) as { notifyFarmer: jest.Mock };

    service.onModuleInit();
  });

  it('subscribes to the farmer_notifications channel on init', () => {
    expect(redisMock.subscribe).toHaveBeenCalledWith(
      'farmer_notifications',
      expect.any(Function),
    );
  });

  it('forwards a valid message to NotificationGateway.notifyFarmer', () => {
    const payload = {
      farmerId: 'farmer-1',
      requestId: 'req-1',
      message: 'New request',
    };

    redisMock.emit('message', 'farmer_notifications', JSON.stringify(payload));

    expect(gateway.notifyFarmer).toHaveBeenCalledWith(payload);
  });

  it('does not throw and does not call notifyFarmer for malformed JSON', () => {
    redisMock.emit('message', 'farmer_notifications', 'NOT_VALID_JSON');

    expect(gateway.notifyFarmer).not.toHaveBeenCalled();
  });

  it('disconnects Redis on module destroy', () => {
    service.onModuleDestroy();
    expect(redisMock.disconnect).toHaveBeenCalled();
  });
});

