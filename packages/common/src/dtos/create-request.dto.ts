export interface CreateRequestItemDto {
  productId: number;
  quantity: number;
}

export interface CreateRequestDto {
  distributorId: string;
  farmerIds: number[];
  items: CreateRequestItemDto[];
}
