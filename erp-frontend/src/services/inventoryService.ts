import type { AdjustmentReason, ID, ListQuery, Paginated, StockAdjustment, StockCount, StockLevel, StockMovement, StockMovementType, Transfer, TransferStatus, Warehouse } from '@/types';
import type { WarehouseSaveInput } from '@moto/shared';
import type { InventoryRow } from '@moto/api-client';
import { api } from './api';

export type { InventoryRow };
export interface MovementQuery extends ListQuery {
  productId?: ID;
  warehouseId?: ID;
  type?: StockMovementType;
  userId?: ID;
}

export const inventoryService = {
  overview: (branchId?: ID, warehouseId?: ID) => api.inventory.overview(branchId, warehouseId),
  levels: (filter: { productId?: ID; branchId?: ID; warehouseId?: ID } = {}): Promise<StockLevel[]> => api.inventory.levels(filter),
  movements: (q: MovementQuery = {}): Promise<Paginated<StockMovement>> => api.inventory.movements(q),
  movementsForProduct: (productId: ID, limit = 50): Promise<StockMovement[]> => api.inventory.movementsForProduct(productId, limit),
  adjustments: (q: ListQuery = {}): Promise<Paginated<StockAdjustment>> => api.inventory.adjustments(q),
  createAdjustment: (input: { branchId: ID; warehouseId: ID; productId: ID; direction: 'increase' | 'decrease'; quantity: number; reason: AdjustmentReason; notes: string; userId?: ID }): Promise<StockAdjustment> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.inventory.createAdjustment(rest);
  },
  counts: (): Promise<StockCount[]> => api.inventory.counts(),
  getCount: (id: ID): Promise<StockCount> => api.inventory.getCount(id),
  createCount: (input: { branchId: ID; warehouseId: ID; userId?: ID; productIds: ID[] }): Promise<StockCount> => api.inventory.createCount({ branchId: input.branchId, warehouseId: input.warehouseId, productIds: input.productIds }),
  updateCountItem: (countId: ID, productId: ID, counted: number | null): Promise<StockCount> => api.inventory.updateCountItem(countId, productId, counted),
  finishCount: (countId: ID, _userId?: ID): Promise<StockCount> => api.inventory.finishCount(countId),
  warehouses: (branchId?: ID): Promise<Warehouse[]> => api.inventory.warehouses(branchId),
  getWarehouse: (id: ID): Promise<Warehouse> => api.inventory.getWarehouse(id),
  warehouseStats: (id: ID) => api.inventory.warehouseStats(id),
  saveWarehouse: (input: Partial<Warehouse> & { id?: ID }): Promise<Warehouse> => api.inventory.saveWarehouse(input as WarehouseSaveInput),
  transfers: (q: ListQuery & { status?: TransferStatus; direction?: 'in' | 'out' } = {}): Promise<Paginated<Transfer>> => api.inventory.transfers(q),
  getTransfer: (id: ID): Promise<Transfer> => api.inventory.getTransfer(id),
  createTransfer: (input: { sourceBranchId: ID; sourceWarehouseId?: ID; destinationBranchId: ID; items: { productId: ID; requestedQty: number }[]; userId?: ID; notes?: string; submit: boolean }): Promise<Transfer> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.inventory.createTransfer(rest);
  },
  advanceTransfer: (id: ID, next: TransferStatus, _userId?: ID, note?: string, quantities?: Record<ID, number>): Promise<Transfer> => api.inventory.advanceTransfer(id, next, note, quantities),
};
