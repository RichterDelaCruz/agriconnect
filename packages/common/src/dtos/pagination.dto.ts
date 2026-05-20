export interface PaginationQueryDto {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponseDto<T> {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
}
