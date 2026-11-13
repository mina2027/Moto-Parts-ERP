import type { AlternativeSuggestion, Brand, Category, CategoryNode, ID, LocalizedText, MotorcycleModel, Paginated, PriceHistoryEntry, StockLevel } from '@/types';
import type { ProductCreateInput, ProductUpdateInput } from '@moto/shared';
import type { ProductQuery, ProductWithStock } from '@moto/api-client';
import { api } from './api';

export type { ProductQuery, ProductWithStock };

export const productService = {
  list: (q: ProductQuery = {}): Promise<Paginated<ProductWithStock>> => api.products.list(q),
  all: (branchId?: ID, includeDeleted = false): Promise<ProductWithStock[]> => api.products.all(branchId, includeDeleted),
  get: (id: ID): Promise<ProductWithStock> => api.products.get(id),
  lookup: (term: string, branchId?: ID, limit = 12): Promise<ProductWithStock[]> => api.products.lookup(term, branchId, limit),
  create: (input: ProductCreateInput): Promise<ProductWithStock> => api.products.create(input),
  update: (id: ID, patch: ProductUpdateInput, _userId?: ID, reason?: string): Promise<ProductWithStock> => api.products.update(id, { ...patch, changeReason: reason ?? patch.changeReason }),
  delete: (id: ID): Promise<{ ok: true }> => api.products.delete(id),
  bulkUpdate: async (ids: ID[], patch: ProductUpdateInput): Promise<number> => (await api.products.bulkUpdate(ids, patch)).count,
  stockLevels: (productId: ID): Promise<StockLevel[]> => api.products.stockLevels(productId),
  priceHistory: (query: { productId?: ID; userId?: ID; field?: string; branchId?: ID; from?: string; to?: string } = {}): Promise<PriceHistoryEntry[]> => api.products.priceHistory(query),
  move: async (ids: ID[], categoryId: ID): Promise<number> => (await api.products.move(ids, categoryId)).count,
  regenerateBarcode: (id: ID): Promise<ProductWithStock> => api.products.regenerateBarcode(id),
  alternatives: (id: ID, branchId: ID, inStockOnly = true): Promise<AlternativeSuggestion[]> => api.products.alternatives(id, branchId, inStockOnly),
  brands: (): Promise<Brand[]> => api.products.brands(),
  addBrand: (input: { name: { ar?: string; en?: string }; country?: { ar?: string; en?: string } }): Promise<Brand> => api.products.addBrand(input),
  categories: (): Promise<Category[]> => api.products.categories(),
  categoryTree: (): Promise<CategoryNode[]> => api.products.categoryTree(),
  addCategory: (input: { name: LocalizedText; parentId?: ID | null }): Promise<Category> => api.products.addCategory(input),
  updateCategory: (id: ID, patch: { name?: LocalizedText; parentId?: ID | null; sortOrder?: number; isActive?: boolean }): Promise<Category> => api.products.updateCategory(id, patch),
  reorderCategories: (parentId: ID | null, ids: ID[]): Promise<Category[]> => api.products.reorderCategories(parentId, ids),
  deleteCategory: async (id: ID): Promise<boolean> => {
    await api.products.deleteCategory(id);
    return true;
  },
  models: (): Promise<MotorcycleModel[]> => api.products.models(),
  setCompatibility: (productId: ID, modelId: ID, compatible: boolean): Promise<ID[]> => api.products.setCompatibility(productId, modelId, compatible),
  setAlternative: async (productId: ID, altId: ID, link: boolean): Promise<boolean> => {
    await api.products.setAlternative(productId, altId, link);
    return true;
  },
  addModel: (input: { code: string; name: LocalizedText; manufacturer: string; engineCc: number; years: string }): Promise<MotorcycleModel> => api.products.addModel(input),
};
