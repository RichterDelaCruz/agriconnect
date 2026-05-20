import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1716000000000 implements MigrationInterface {
  name = 'InitSchema1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "distributor" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_distributor_email" UNIQUE ("email"),
        CONSTRAINT "PK_distributor" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "farmer" (
        "id" SERIAL NOT NULL,
        "name" varchar(255) NOT NULL,
        "location" varchar(255) NOT NULL,
        "imageUrl" varchar(1024),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_farmer" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_farmer_location" ON "farmer" ("location")`
    );

    await queryRunner.query(`
      CREATE TABLE "product" (
        "id" SERIAL NOT NULL,
        "farmerId" integer NOT NULL,
        "name" varchar(255) NOT NULL,
        "price" numeric(12,2) NOT NULL,
        "stockQuantity" integer NOT NULL DEFAULT 0,
        "imageUrl" varchar(1024),
        CONSTRAINT "PK_product" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_farmer" FOREIGN KEY ("farmerId") REFERENCES "farmer"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_product_farmer_price" ON "product" ("farmerId", "price")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_active_products" ON "product" ("id") WHERE "stockQuantity" > 0`
    );

    await queryRunner.query(`
      CREATE TYPE "request_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED')
    `);
    await queryRunner.query(`
      CREATE TABLE "request" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "distributorId" uuid NOT NULL,
        "farmerId" integer NOT NULL,
        "status" "request_status_enum" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_request" PRIMARY KEY ("id"),
        CONSTRAINT "FK_request_distributor" FOREIGN KEY ("distributorId") REFERENCES "distributor"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_request_farmer" FOREIGN KEY ("farmerId") REFERENCES "farmer"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_request_farmer" ON "request" ("farmerId")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_request_distributor" ON "request" ("distributorId")`
    );

    await queryRunner.query(`
      CREATE TABLE "request_item" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "productId" integer NOT NULL,
        "quantity" integer NOT NULL,
        CONSTRAINT "PK_request_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_request_item_request" FOREIGN KEY ("requestId") REFERENCES "request"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_request_item_product" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "request_item"`);
    await queryRunner.query(`DROP TABLE "request"`);
    await queryRunner.query(`DROP TYPE "request_status_enum"`);
    await queryRunner.query(`DROP TABLE "product"`);
    await queryRunner.query(`DROP TABLE "farmer"`);
    await queryRunner.query(`DROP TABLE "distributor"`);
  }
}
