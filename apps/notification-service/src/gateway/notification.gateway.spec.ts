import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { NotificationGateway } from './notification.gateway';
import { FarmerNotificationPayload } from '@agriconnect/common';

describe('NotificationGateway', () => {
  let gateway: NotificationGateway;
  let emitMock: jest.Mock;
  let toMock: jest.Mock;
  let mockSocket: Partial<Socket>;

  beforeEach(async () => {
    // Create a NestJS testing module with just the gateway (no real server)
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationGateway],
    }).compile();

    gateway = module.get(NotificationGateway);

    // ── Mock the Socket.IO server ──
    // In production, gateway.server is set by @WebSocketServer() decorator.
    // We manually inject a mock: server.to(socketId) returns an object with emit().
    // This lets us verify which socket received which event.
    emitMock = jest.fn();
    toMock   = jest.fn().mockReturnValue({ emit: emitMock });
    gateway.server = { to: toMock } as never;

    // A minimal mock Socket that only has an id
    mockSocket = { id: 'socket-abc' };
  });

  describe('handleRegister', () => {
    // ── Test: Registration creates farmerId → socketId mapping ────────────
    it('registers a farmer and maps their farmerId to the socket id', () => {
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);

      // After registration, notifyFarmer should route to this socket
      const payload: FarmerNotificationPayload = {
        farmerId: 'farmer-1', requestId: 'req-1', message: 'New order',
      };
      gateway.notifyFarmer(payload);

      // Verify it called server.to('socket-abc') → the registered socket
      expect(toMock).toHaveBeenCalledWith('socket-abc');
    });

    // ── Test: Registration returns acknowledgement ────────────────────────
    it('returns a "registered" acknowledgement', () => {
      const result = gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);
      expect(result).toEqual({ event: 'registered', data: { farmerId: 'farmer-1' } });
    });
  });

  describe('handleDisconnect', () => {
    // ── Test: Cleanup on disconnect ───────────────────────────────────────
    it('removes the farmer mapping so future notifications are skipped', () => {
      // Register, then disconnect
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);
      gateway.handleDisconnect(mockSocket as Socket);

      // Try to notify the disconnected farmer
      gateway.notifyFarmer({ farmerId: 'farmer-1', requestId: 'req-1', message: 'New order' });

      // The mapping was removed → server.to() should NOT have been called
      expect(toMock).not.toHaveBeenCalled();
    });
  });

  describe('notifyFarmer', () => {
    // ── Test: Notification is emitted to the correct socket ───────────────
    it('emits "new_request" with the full payload to the correct socket', () => {
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);

      const payload: FarmerNotificationPayload = {
        farmerId: 'farmer-1', requestId: 'req-99', message: 'You have a new order',
      };
      gateway.notifyFarmer(payload);

      // Verify server.to() was called with the right socket
      expect(toMock).toHaveBeenCalledWith('socket-abc');
      // Verify emit() was called with the right event and payload
      expect(emitMock).toHaveBeenCalledWith('new_request', payload);
    });

    // ── Test: Unregistered farmer is silently ignored ─────────────────────
    it('does nothing when the farmer is not registered on this instance', () => {
      // This simulates horizontal scaling: the farmer's WebSocket is connected
      // to Instance B, but this notification arrived on Instance A via Redis fan-out.
      gateway.notifyFarmer({ farmerId: 'unknown-farmer', requestId: 'req-1', message: 'test' });

      // No server.to() → no emit() → no WebSocket message sent
      expect(toMock).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();
    });

    // ── Test: Correct routing among multiple farmers ──────────────────────
    it('routes to the correct socket when multiple farmers are registered', () => {
      const socketA = { id: 'socket-A' } as Partial<Socket>;
      const socketB = { id: 'socket-B' } as Partial<Socket>;

      // Register two farmers on two different sockets
      gateway.handleRegister({ farmerId: 'farmer-A' }, socketA as Socket);
      gateway.handleRegister({ farmerId: 'farmer-B' }, socketB as Socket);

      // Notify only farmer-B
      gateway.notifyFarmer({ farmerId: 'farmer-B', requestId: 'req-1', message: 'test' });

      // Only socket-B should receive the message
      expect(toMock).toHaveBeenCalledWith('socket-B');
      expect(toMock).not.toHaveBeenCalledWith('socket-A');
    });
  });
});
