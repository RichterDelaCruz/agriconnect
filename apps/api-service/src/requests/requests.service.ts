import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product, Request as FarmerRequest, RequestItem } from '@agriconnect/database';
import { CreateRequestDto, FarmerNotificationPayload } from '@agriconnect/common';
import { RequestStatus } from '@agriconnect/database';
import { Redis } from 'ioredis';
import { REDIS_PUBLISHER } from '../redis/redis.module';

export const FARMER_NOTIFICATIONS_CHANNEL = 'farmer_notifications';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    @InjectRepository(FarmerRequest)
    private readonly requestRepository: Repository<FarmerRequest>,
    @InjectRepository(RequestItem)
    private readonly requestItemRepository: Repository<RequestItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(REDIS_PUBLISHER)
    private readonly redisPublisher: Redis,
  ) {}

  /**
   * Routes concurrent distributor requests to multiple farmers using a
   * database transaction with row-level locking (SELECT FOR UPDATE).
   *
   * Flow:
   *  1. Open an explicit READ COMMITTED transaction.
   *  2. Lock all target Product rows with FOR UPDATE — this serializes
   *     concurrent writes on those rows, preventing overselling.
   *  3. Validate stock for every requested product.
   *  4. Decrement stock and insert Request + RequestItem records atomically.
   *  5. Commit. On any failure the transaction rolls back automatically.
   *  6. Publish a notification event to Redis for each farmer so the
   *     notification-service can push it over WebSocket in real-time.
   *
   * @param dto  The request payload from the distributor client.
   * @returns    Array of persisted Request entities, one per farmer.
   */
  async createRequests(dto: CreateRequestDto): Promise<FarmerRequest[]> {
    const savedRequests = await this.dataSource.transaction(
      async (manager) => {
        const productIds = dto.items.map((i) => i.productId);

        // Step 1 & 2: Lock product rows — blocks concurrent transactions
        // from reading-for-update or modifying these rows until we commit.
        const lockedProducts = await manager
          .createQueryBuilder(Product, 'product')
          .setLock('pessimistic_write') // translates to FOR UPDATE
          .whereInIds(productIds)
          .getMany();

        if (lockedProducts.length !== productIds.length) {
          throw new NotFoundException('One or more products not found.');
        }

        const productMap = new Map(lockedProducts.map((p) => [p.id, p]));

        // Step 3: Validate stock levels while holding the locks
        for (const item of dto.items) {
          const product = productMap.get(item.productId)!;
          if (product.stockQuantity < item.quantity) {
            throw new BadRequestException(
              `Insufficient stock for product "${product.name}". ` +
                `Requested: ${item.quantity}, Available: ${product.stockQuantity}`,
            );
          }
        }

        // Step 4: Deduct stock and create request records per farmer
        const requests: FarmerRequest[] = [];

        for (const farmerId of dto.farmerIds) {
          // Deduct stock for items belonging to this farmer
          const farmerItems = dto.items.filter(
            (i) => productMap.get(i.productId)?.farmerId === farmerId,
          );

          for (const item of farmerItems) {
            const product = productMap.get(item.productId)!;
            product.stockQuantity -= item.quantity;
            await manager.save(Product, product);
          }

          const request = manager.create(FarmerRequest, {
            distributorId: dto.distributorId,
            farmerId,
            status: RequestStatus.PENDING,
            items: farmerItems.map((i) =>
              manager.create(RequestItem, {
                productId: i.productId,
                quantity: i.quantity,
              }),
            ),
          });

          const saved = await manager.save(FarmerRequest, request);
          requests.push(saved);
        }

        return requests;
      },
    );

    // Step 5 & 6: Transaction committed — publish notifications outside
    // the transaction so a Redis failure never rolls back committed data.
    await this.publishNotifications(savedRequests);

    return savedRequests;
  }

  /**
   * Publishes a notification payload to the Redis `farmer_notifications`
   * channel for each saved request. The notification-service instances
   * subscribed to this channel will route the message to the connected
   * farmer's WebSocket client.
   */
  private async publishNotifications(
    requests: FarmerRequest[],
  ): Promise<void> {
    const publishPromises = requests.map((req) => {
      const payload: FarmerNotificationPayload = {
        farmerId: String(req.farmerId),
        requestId: req.id,
        message: 'You have received a new distributor request.',
      };
      return this.redisPublisher
        .publish(
          FARMER_NOTIFICATIONS_CHANNEL,
          JSON.stringify(payload),
        )
        .catch((err: unknown) => {
          // Log but do not throw — notification failure must not
          // reverse an already-committed database transaction.
          this.logger.error(
            `Failed to publish notification for request ${req.id}`,
            err,
          );
        });
    });

    await Promise.all(publishPromises);
  }
}
