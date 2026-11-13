import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Eye, EyeOff, FolderPlus, FolderTree, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CategoryNode } from '@/types';
import type { ProductWithStock } from '@/services/productService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ExportMenu, FilterSelect, Money, PageHeader, SearchInput } from '@/components/shared/page';
import { EmptyState, LoadingState } from '@/components/shared/states';
import { StockBadge } from '@/components/shared/status-badge';
import { ProductFormDialog } from './ProductFormDialog';
import { productService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { ExportPayload } from '@/lib/export';

interface EditState {
  mode: 'create' | 'rename';
  parentId: string | null;
  id?: string;
  ar: string;
  en: string;
}

function flatten(nodes: CategoryNode[], expanded: Set<string>, depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...(expanded.has(n.id) ? flatten(n.children, expanded, depth + 1) : [])]);
}

export default function CategoriesPage() {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('inventory.adjust') || hasPermission('prices.edit') || hasPermission('settings.edit');
  const canDelete = hasPermission('settings.edit');
  const canCost = hasPermission('prices.view_cost');
  const { options, brandName } = useLookups();

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<EditState | null>(null);
  const [deleting, setDeleting] = React.useState<CategoryNode | null>(null);
  const [search, setSearch] = React.useState('');
  const [productSearch, setProductSearch] = React.useState('');
  const [includeDescendants, setIncludeDescendants] = React.useState(true);
  const [addProductOpen, setAddProductOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<string | undefined>();
  const [checked, setChecked] = React.useState<Set<string>>(new Set());

  const tree = useQuery({ queryKey: ['categories', 'tree'], queryFn: productService.categoryTree });
  const products = useQuery({
    queryKey: ['products', 'byCategory', selected, includeDescendants, productSearch],
    queryFn: () => productService.list({ categoryId: selected!, includeDescendants, search: productSearch || undefined, pageSize: 200 }),
    enabled: Boolean(selected),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const saveCategory = useMutation({
    mutationFn: async (state: EditState) => {
      const name = { ar: state.ar.trim(), en: state.en.trim() || undefined };
      return state.mode === 'create' ? productService.addCategory({ name, parentId: state.parentId }) : productService.updateCategory(state.id!, { name });
    },
    onSuccess: (_d, state) => {
      toast.success(t('common.saved'));
      if (state.parentId) setExpanded((p) => new Set(p).add(state.parentId!));
      setEdit(null);
      invalidate();
    },
    onError: () => toast.error(t('common.error')),
  });

  const toggleActive = useMutation({
    mutationFn: (n: CategoryNode) => productService.updateCategory(n.id, { isActive: !n.isActive }),
    onSuccess: () => { toast.success(t('common.updated')); invalidate(); },
  });

  const removeCategory = useMutation({
    mutationFn: (id: string) => productService.deleteCategory(id),
    onSuccess: () => { toast.success(t('common.deleted')); setDeleting(null); setSelected(null); invalidate(); },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code;
      toast.error(code === 'CATEGORY_NOT_EMPTY' ? t('categories.notEmpty') : t('common.error'));
      setDeleting(null);
    },
  });

  const move = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string }) => productService.move(ids, categoryId),
    onSuccess: (count) => { toast.success(t('categories.moved', { n: count })); setChecked(new Set()); setMoveTarget(undefined); invalidate(); },
    onError: () => toast.error(t('common.error')),
  });

  const nodes = tree.data ?? [];
  const nodeById = React.useMemo(() => {
    const map = new Map<string, CategoryNode>();
    const walk = (list: CategoryNode[]) => list.forEach((n) => { map.set(n.id, n); walk(n.children); });
    walk(nodes);
    return map;
  }, [nodes]);

  // A search expands every ancestor of a hit so the match is visible in place.
  const visible = React.useMemo(() => {
    if (!search.trim()) return flatten(nodes, expanded);
    const term = search.trim().toLowerCase();
    const hits = Array.from(nodeById.values()).filter((n) => `${n.name.ar} ${n.name.en ?? ''}`.toLowerCase().includes(term));
    const keep = new Set<string>();
    for (const h of hits) {
      keep.add(h.id);
      h.ancestors.forEach((a) => keep.add(a));
    }
    const all = new Set(Array.from(keep));
    return flatten(nodes, all).filter((r) => keep.has(r.node.id));
  }, [nodes, expanded, search, nodeById]);

  const current = selected ? nodeById.get(selected) : undefined;
  const rows = products.data?.data ?? [];

  const exportPayload = (): ExportPayload<ProductWithStock> => ({
    filename: 'category-products',
    title: current ? tx(current.name) : t('categories.title'),
    columns: [
      { header: t('common.product'), value: (p) => tx(p.name) },
      { header: t('common.sku'), value: (p) => p.sku },
      { header: t('common.barcode'), value: (p) => p.internalBarcode },
      { header: t('common.brand'), value: (p) => brandName(p.brandId) },
      { header: t('products.currentStock'), value: (p) => p.totalStock, numeric: true },
      { header: t('products.minStock'), value: (p) => p.minStock, numeric: true },
      ...(canCost ? [{ header: t('common.cost'), value: (p: ProductWithStock) => p.lastPurchaseCost, numeric: true }] : []),
      { header: t('upgrade.tierRetail1'), value: (p) => p.prices.retail1, numeric: true },
    ],
    rows,
    meta: [
      { label: t('common.category'), value: current ? [...current.ancestors.map((a) => tx(nodeById.get(a)?.name)), tx(current.name)].filter(Boolean).join(' › ') : '—' },
      { label: t('categories.includeDescendants'), value: includeDescendants ? t('common.yes') : t('common.no') },
    ],
  });

  const toggleExpand = (id: string) => setExpanded((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div>
      <PageHeader
        title={t('categories.title')}
        subtitle={t('categories.subtitle')}
        actions={canEdit ? <Button onClick={() => setEdit({ mode: 'create', parentId: null, ar: '', en: '' })}><FolderPlus /> {t('categories.newDepartment')}</Button> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="rounded-lg border bg-card">
          <div className="border-b p-2"><SearchInput value={search} onChange={setSearch} placeholder={t('categories.searchTree')} /></div>
          {tree.isLoading ? <LoadingState rows={8} /> : !visible.length ? <EmptyState /> : (
            <ul className="max-h-[70vh] overflow-y-auto p-1 text-sm">
              {visible.map(({ node, depth }) => (
                <li key={node.id}>
                  <div
                    className={`group flex items-center gap-1 rounded px-1 py-1 hover:bg-accent ${selected === node.id ? 'bg-accent' : ''}`}
                    style={{ paddingInlineStart: `${depth * 14 + 4}px` }}
                  >
                    <button type="button" className="shrink-0 text-muted-foreground disabled:opacity-0" disabled={!node.children.length} onClick={() => toggleExpand(node.id)} aria-label={t('common.expand')}>
                      {expanded.has(node.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}
                    </button>
                    <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => setSelected(node.id)}>
                      <span className={node.isActive ? '' : 'text-muted-foreground line-through'}>{tx(node.name)}</span>
                      <span className="ms-1 num text-[10px] text-muted-foreground">{node.totalProductCount}</span>
                    </button>
                    {canEdit ? (
                      <span className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <Button size="icon-sm" variant="ghost" onClick={() => setEdit({ mode: 'create', parentId: node.id, ar: '', en: '' })} aria-label={t('categories.addChild')}><Plus className="size-3.5" /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setEdit({ mode: 'rename', parentId: node.parentId, id: node.id, ar: node.name.ar, en: node.name.en ?? '' })} aria-label={t('common.edit')}><Pencil className="size-3.5" /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => toggleActive.mutate(node)} aria-label={t('common.status')}>{node.isActive ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</Button>
                        {canDelete ? <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(node)} aria-label={t('common.delete')}><Trash2 className="size-3.5 text-destructive" /></Button> : null}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border bg-card">
          {!current ? (
            <div className="flex h-60 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"><FolderTree className="size-8" />{t('categories.pickNode')}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b p-2">
                <div className="me-auto min-w-0">
                  <div className="truncate font-medium">{[...current.ancestors.map((a) => tx(nodeById.get(a)?.name)), tx(current.name)].filter(Boolean).join(' › ')}</div>
                  <div className="text-[11px] text-muted-foreground">{t('categories.directCount', { n: current.productCount })} · {t('categories.totalCount', { n: current.totalProductCount })}</div>
                </div>
                <Button size="xs" variant={includeDescendants ? 'secondary' : 'outline'} onClick={() => setIncludeDescendants((v) => !v)}>{t('categories.includeDescendants')}</Button>
                <ExportMenu size="xs" payload={exportPayload} />
                {canEdit ? <Button size="xs" onClick={() => setAddProductOpen(true)}><Plus /> {t('products.addProduct')}</Button> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b p-2">
                <SearchInput value={productSearch} onChange={setProductSearch} className="sm:w-64" />
                {canEdit && checked.size > 0 ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1">
                    <span className="text-xs">{t('categories.selected', { n: checked.size })}</span>
                    <FilterSelect value={moveTarget} onChange={setMoveTarget} options={options.categories} allLabel={t('categories.moveTo')} width="w-56" className="h-7" />
                    <Button size="xs" disabled={!moveTarget || moveTarget === 'all' || move.isPending} onClick={() => move.mutate({ ids: Array.from(checked), categoryId: moveTarget! })}>{t('categories.move')}</Button>
                  </div>
                ) : null}
              </div>
              {products.isLoading ? <LoadingState /> : !rows.length ? <EmptyState /> : (
                <div className="max-h-[60vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        {canEdit ? <th className="w-8 px-2 py-2"><input type="checkbox" checked={checked.size === rows.length && rows.length > 0} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label={t('common.selectAll')} /></th> : null}
                        <th className="px-3 py-2 text-start font-medium">{t('common.product')}</th>
                        <th className="px-3 py-2 text-start font-medium">{t('common.barcode')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('upgrade.tierRetail1')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('products.currentStock')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className="border-t">
                          {canEdit ? (
                            <td className="px-2 py-1.5">
                              <input type="checkbox" checked={checked.has(p.id)} onChange={(e) => setChecked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} aria-label={tx(p.name)} />
                            </td>
                          ) : null}
                          <td className="px-3 py-1.5">
                            <Link to={`/products/${p.id}`} className="font-medium hover:underline">{tx(p.name)}</Link>
                            <div className="text-[10px] text-muted-foreground">{p.sku}{p.size ? ` · ${p.size}` : ''}</div>
                          </td>
                          <td className="px-3 py-1.5 num text-xs">{p.internalBarcode}</td>
                          <td className="px-3 py-1.5 text-end"><Money value={p.prices.retail1} /></td>
                          <td className="px-3 py-1.5 text-end"><span className="num me-2">{p.totalStock}</span><StockBadge qty={p.totalStock} min={p.minStock} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {edit?.mode === 'rename' ? t('categories.renameNode') : edit?.parentId ? t('categories.addChild') : t('categories.newDepartment')}
            </DialogTitle>
          </DialogHeader>
          {edit?.parentId ? <div className="text-xs text-muted-foreground">{t('categories.under')}: {tx(nodeById.get(edit.parentId)?.name)}</div> : null}
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">{t('common.nameAr')}<Input value={edit?.ar ?? ''} onChange={(e) => setEdit((p) => p && { ...p, ar: e.target.value })} dir="rtl" /></label>
            <label className="grid gap-1 text-sm">{t('common.nameEn')}<Input value={edit?.en ?? ''} onChange={(e) => setEdit((p) => p && { ...p, en: e.target.value })} dir="ltr" /></label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
            <Button disabled={!edit || (!edit.ar.trim() && !edit.en.trim()) || saveCategory.isPending} onClick={() => edit && saveCategory.mutate(edit)}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('categories.deleteNode')}
        description={deleting ? t('categories.deleteConfirm', { name: tx(deleting.name), n: deleting.totalProductCount }) : ''}
        variant="destructive"
        onConfirm={() => { if (deleting) removeCategory.mutate(deleting.id); }}
      />

      <ProductFormDialog open={addProductOpen} onOpenChange={setAddProductOpen} defaultCategoryId={selected ?? undefined} />
      <Badge className="sr-only"><Package className="size-3" /></Badge>
    </div>
  );
}
