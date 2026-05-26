import { Test, TestingModule } from '@nestjs/testing';
import { NotificationGateway } from './notification.gateway';
import { RedisSubscriberService } from './redis-subscriber.service';

// ── Module-level Redis mock ───────────────────────────────────────────────────
// We mock 'ioredis' at the module level (before imports) because Jest hoists
// jest.mock() calls to the top of the file.
//
// The mock creates a single redisMock object that all tests share.
// It has a custom emit() helper so tests can simulate incoming Redis messages.

const listeners: Record<string, ((...args: string[]) => void)[]> = {};

const redisMock = {
  subscribe: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
  /** Helper: simulates Redis emitting an event (e.g., 'message') */
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
    // Clear captured listeners between tests so emit() from previous test doesn't leak
    Object.keys(listeners).forEach((k) => delete listeners[k]);

    // Simulate ioredis behaviour: subscribe() calls the callback immediately
    redisMock.subscribe.mockImplementation(
      (_channel: string, cb: (err: null, count: number) => void) => {
        cb(null, 1);
      },
    );

    // on() captures event listeners so our emit() helper can trigger them
    redisMock.on.mockImplementation(
      (event: string, listener: (...args: string[]) => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(listener);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisSubscriberService,
        // Mock the NotificationGateway — we only care that notifyFarmer was called
        { provide: NotificationGateway, useValue: { notifyFarmer: jest.fn() } },
      ],
    }).compile();

    service = module.get(RedisSubscriberService);
    gateway = module.get(NotificationGateway) as { notifyFarmer: jest.Mock };

    // Manually trigger onModuleInit() since NestJS won't auto-invoke it in testing
    service.onModuleInit();
  });

  // ── Test: Subscribe on init ────────────────────────────────────────────
  it('subscribes to the farmer_notifications channel on init', () => {
    expect(redisMock.subscribe).toHaveBeenCalledWith(
      'farmer_notifications',
      expect.any(Function),
    );
  });

  // ── Test: Valid JSON is forwarded ───────────────────────────────────────
  it('forwards a valid message to NotificationGateway.notifyFarmer', () => {
    const payload = {
      farmerId: 'farmer-1',
      requestId: 'req-1',
      message: 'New request',
    };

    // Simulate Redis sending a message on the channel
    redisMock.emit('message', 'farmer_notifications', JSON.stringify(payload));

    // The service parses the JSON and forwards it to the gateway
    expect(gateway.notifyFarmer).toHaveBeenCalledWith(payload);
  });

  // ── Test: Malformed JSON is gracefully handled ──────────────────────────
  it('does not throw and does not call notifyFarmer for malformed JSON', () => {
    // Simulate a garbage message on the Redis channel
    redisMock.emit('message', 'farmer_notifications', 'NOT_VALID_JSON');

    // The service catches the JSON.parse error, logs a warning, and moves on.
    // It should NOT crash or forward garbage to the gateway.
    expect(gateway.notifyFarmer).not.toHaveBeenCalled();
  });

  // ── Test: Clean disconnect on destroy ───────────────────────────────────
  it('disconnects Redis on module destroy', () => {
    service.onModuleDestroy();
    expect(redisMock.disconnect).toHaveBeenCalled();
  });
});

