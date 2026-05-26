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
    // --- PHASE 1: DATABASE TRANSACTION (atomic) ---
    // Everything inside this callback runs in a single DB transaction.
    // If ANY error is thrown, ALL changes are rolled back automatically.
    const savedRequests = await this.dataSource.transaction(
      async (manager) => {
        // --- Step 1: Collect all product IDs we need to lock ---
        const productIds = dto.items.map((i) => i.productId);

        // --- Step 2: Lock product rows with FOR UPDATE ---
        // This is THE concurrency trick. We acquire pessimistic write locks
        // on the product rows BEFORE reading or modifying anything.
        //
        // Why? When 50 distributors try to buy the last 1 item simultaneously:
        //   Request A gets the lock first → sees stock=1 → deducts → commits
        //   Requests B–C–D... wait in a queue for the lock
        //   When they get the lock, they see stock=0 → reject → rollback
        //
        // Without this lock, all 50 requests would read stock=1 at the same time
        // and oversell the product by 49 units!
        const lockedProducts = await manager
          .createQueryBuilder(Product, 'product')
          .setLock('pessimistic_write') // translates to: SELECT ... FOR UPDATE
          .whereInIds(productIds)
          .getMany();

        // --- Step 3: Verify all products exist ---
        // If the client sent a productId that doesn't exist in the database,
        // the lockedProducts array will be shorter than productIds.
        // Reject immediately — no point continuing.
        if (lockedProducts.length !== productIds.length) {
          throw new NotFoundException('One or more products not found.');
        }

        // Build a quick lookup map: productId → Product entity
        // This avoids O(n²) lookups inside the loops below.
        const productMap = new Map(lockedProducts.map((p) => [p.id, p]));

        // --- Step 4: Validate stock levels (while holding locks) ---
        // We hold the FOR UPDATE locks, so no other transaction can change
        // stock quantities while we check. This is the "validate while locked" pattern.
        for (const item of dto.items) {
          const product = productMap.get(item.productId)!;
          if (product.stockQuantity < item.quantity) {
            throw new BadRequestException(
              `Insufficient stock for product "${product.name}". ` +
                `Requested: ${item.quantity}, Available: ${product.stockQuantity}`,
            );
          }
        }

        // --- Step 5: Deduct stock & create requests, one farmer at a time ---
        const requests: FarmerRequest[] = [];

        for (const farmerId of dto.farmerIds) {
          // Filter items that belong to THIS farmer
          const farmerItems = dto.items.filter(
            (i) => productMap.get(i.productId)?.farmerId === farmerId,
          );

          // Deduct stock for each product this farmer sells
          for (const item of farmerItems) {
            const product = productMap.get(item.productId)!;
            product.stockQuantity -= item.quantity;
            await manager.save(Product, product);
          }

          // Create the request record (status = PENDING)
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

        // --- Step 6: Transaction commits automatically here ---
        // If we reach this line, all saves succeeded atomically.
        // If any error occurred above, the transaction rolls back and
        // this function never reaches here.
        return requests;
      },
    );

    // --- PHASE 2: PUBLISH NOTIFICATIONS (outside transaction) ---
    // The transaction has COMMITTED — the data is safely in PostgreSQL.
    // Now we notify farmers via Redis Pub/Sub.
    //
    // IMPORTANT: Redis publish failures are logged but NOT thrown.
    // Why? If Redis is down, we don't want to undo an already-committed
    // database transaction. The notification is "best effort" — the data
    // is safe in the database regardless.
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
    // For each saved request, publish a JSON payload to the
    // `farmer_notifications` Redis channel.
    //
    // All notification-service instances are subscribed to this channel.
    // The instance whose NotificationGateway has the farmer's WebSocket
    // connection will deliver the message; others will silently no-op.
    const publishPromises = requests.map((req) => {
      const payload: FarmerNotificationPayload = {
        farmerId: String(req.farmerId),
        requestId: req.id,
        message: 'You have received a new distributor request.',
      };

      // Publish to Redis channel. The channel name ('farmer_notifications')
      // must match exactly what the subscriber service listens to.
      return this.redisPublisher
        .publish(
          FARMER_NOTIFICATIONS_CHANNEL,
          JSON.stringify(payload),
        )
        .catch((err: unknown) => {
          // CRITICAL: We catch the error here instead of letting it propagate.
          // If Redis publish fails, the database transaction has ALREADY committed.
          // Throwing would send an HTTP 500 to the client even though the
          // request was saved successfully — the farmer just won't get a
          // real-time notification (they'll see it on next refresh).
          this.logger.error(
            `Failed to publish notification for request ${req.id}`,
            err,
          );
        });
    });

    // Fire all publish calls concurrently — don't wait for one farmer
    // to be notified before starting the next.
    await Promise.all(publishPromises);
  }
}
