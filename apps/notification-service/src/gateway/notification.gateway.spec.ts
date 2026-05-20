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
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationGateway],
    }).compile();

    gateway = module.get(NotificationGateway);

    // Inject a mock Socket.IO server — to() returns a target room you can emit to
    emitMock = jest.fn();
    toMock   = jest.fn().mockReturnValue({ emit: emitMock });
    gateway.server = { to: toMock } as never;

    mockSocket = { id: 'socket-abc' };
  });

  describe('handleRegister', () => {
    it('registers a farmer and maps their farmerId to the socket id', () => {
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);

      // After registration, notifyFarmer must route to this socket
      const payload: FarmerNotificationPayload = {
        farmerId: 'farmer-1', requestId: 'req-1', message: 'New order',
      };
      gateway.notifyFarmer(payload);

      expect(toMock).toHaveBeenCalledWith('socket-abc');
    });

    it('returns a "registered" acknowledgement', () => {
      const result = gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);
      expect(result).toEqual({ event: 'registered', data: { farmerId: 'farmer-1' } });
    });
  });

  describe('handleDisconnect', () => {
    it('removes the farmer mapping so future notifications are skipped', () => {
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);
      gateway.handleDisconnect(mockSocket as Socket);

      gateway.notifyFarmer({ farmerId: 'farmer-1', requestId: 'req-1', message: 'New order' });

      expect(toMock).not.toHaveBeenCalled();
    });
  });

  describe('notifyFarmer', () => {
    it('emits "new_request" with the full payload to the correct socket', () => {
      gateway.handleRegister({ farmerId: 'farmer-1' }, mockSocket as Socket);

      const payload: FarmerNotificationPayload = {
        farmerId: 'farmer-1', requestId: 'req-99', message: 'You have a new order',
      };
      gateway.notifyFarmer(payload);

      expect(toMock).toHaveBeenCalledWith('socket-abc');
      expect(emitMock).toHaveBeenCalledWith('new_request', payload);
    });

    it('does nothing when the farmer is not registered on this instance', () => {
      // Simulates farmer connected to a different server instance
      gateway.notifyFarmer({ farmerId: 'unknown-farmer', requestId: 'req-1', message: 'test' });

      expect(toMock).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();
    });

    it('routes to the correct socket when multiple farmers are registered', () => {
      const socketA = { id: 'socket-A' } as Partial<Socket>;
      const socketB = { id: 'socket-B' } as Partial<Socket>;

      gateway.handleRegister({ farmerId: 'farmer-A' }, socketA as Socket);
      gateway.handleRegister({ farmerId: 'farmer-B' }, socketB as Socket);

      gateway.notifyFarmer({ farmerId: 'farmer-B', requestId: 'req-1', message: 'test' });

      expect(toMock).toHaveBeenCalledWith('socket-B');
      expect(toMock).not.toHaveBeenCalledWith('socket-A');
    });
  });
});
