import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { Farmer } from '../entities/farmer.entity';
import { Product } from '../entities/product.entity';
import { Distributor } from '../entities/distributor.entity';

const CDN_BASE = 'https://cdn.agriconnect.com/media';

async function seed() {
  await AppDataSource.initialize();
  const farmerRepo = AppDataSource.getRepository(Farmer);
  const productRepo = AppDataSource.getRepository(Product);
  const distributorRepo = AppDataSource.getRepository(Distributor);

  // Seed distributors
  const distributors = distributorRepo.create([
    { name: 'Global Grains Co.', email: 'contact@globalgrains.com' },
    { name: 'FreshDist Inc.', email: 'ops@freshdist.com' },
  ]);
  await distributorRepo.save(distributors);

  // Seed 10,000 farmers with products
  const BATCH_SIZE = 500;
  for (let batch = 0; batch < 20; batch++) {
    const farmers: Farmer[] = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i + 1;
      const farmer = farmerRepo.create({
        name: `Farmer ${idx}`,
        location: `Region ${(idx % 50) + 1}`,
        imageUrl: `${CDN_BASE}/farmers/farmer-${idx}.jpg`,
      });
      farmers.push(farmer);
    }
    const savedFarmers = await farmerRepo.save(farmers);

    const products: Product[] = [];
    for (const farmer of savedFarmers) {
      for (let p = 1; p <= 3; p++) {
        products.push(
          productRepo.create({
            farmerId: farmer.id,
            name: `Product ${p} by ${farmer.name}`,
            price: parseFloat((Math.random() * 200 + 10).toFixed(2)),
            stockQuantity: Math.floor(Math.random() * 100) + 1,
            imageUrl: `${CDN_BASE}/products/product-${p}.jpg`,
          }),
        );
      }
    }
    await productRepo.save(products);
    console.log(`Seeded batch ${batch + 1}/20`);
  }

  await AppDataSource.destroy();
  console.log('Seeding complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
