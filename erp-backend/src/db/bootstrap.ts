import { DEFAULT_SETTINGS, ROLE_PERMISSIONS, defaultLabelTemplate, defaultPrintProfiles } from '@moto/shared';
import type { RoleKey } from '@moto/shared';
import { logger } from '../lib/logger.js';
import { ensureCategoryTree } from '../modules/products/categories.js';
import { backfillProductBarcodes } from '../modules/products/service.js';
import { DEFAULT_WHATSAPP_TEMPLATES } from '../modules/whatsapp/templates.js';
import { migrateCompanyLogo } from '../modules/settings/logo.js';
import { BranchModel, CashRegisterModel, LabelTemplateModel, PriceHistoryModel, PrintProfileModel, ProductModel, RoleModel, SettingsModel, WhatsAppTemplateModel } from './models.js';

export const ROLE_META: Record<RoleKey, { name: { ar: string; en: string }; description: { ar: string; en: string } }> = {
  admin: { name: { ar: 'مدير النظام', en: 'Administrator' }, description: { ar: 'صلاحيات كاملة على كل الفروع', en: 'Full access to all branches' } },
  branch_manager: { name: { ar: 'مدير فرع', en: 'Branch manager' }, description: { ar: 'إدارة الفرع والاعتمادات', en: 'Branch operations and approvals' } },
  accountant: { name: { ar: 'محاسب', en: 'Accountant' }, description: { ar: 'التقارير المالية والمدفوعات', en: 'Financial reports and payments' } },
  cashier: { name: { ar: 'كاشير', en: 'Cashier' }, description: { ar: 'نقطة البيع والخزنة', en: 'POS and register' } },
  sales: { name: { ar: 'مبيعات', en: 'Sales' }, description: { ar: 'بيع وجملة وعملاء', en: 'Sales, wholesale and customers' } },
  warehouse: { name: { ar: 'أمين مخزن', en: 'Warehouse' }, description: { ar: 'المخزون والاستلام والتحويلات', en: 'Inventory, receiving, transfers' } },
};

export async function ensureBranchCashRegister(branch: { _id: string; code: string; name: { ar: string; en?: string } }) {
  if (await CashRegisterModel.exists({ branchId: branch._id })) return;
  await CashRegisterModel.create({
    _id: `reg-${branch._id}`,
    code: `${branch.code}-REG-1`,
    name: { ar: `خزنة ${branch.name.ar}`, en: `${branch.name.en || branch.code} Register` },
    branchId: branch._id,
    isActive: true,
    currentSessionId: null,
  });
}

/** Idempotent system configuration only; never creates business records or accounts. */
export async function ensureBootstrap() {
  for (const key of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    await RoleModel.updateOne({ _id: key }, { $setOnInsert: { permissions: ROLE_PERMISSIONS[key], ...ROLE_META[key] } }, { upsert: true });
  }
  await SettingsModel.updateOne({ _id: 'app' }, { $setOnInsert: { value: DEFAULT_SETTINGS } }, { upsert: true });
  for (const { key, ...template } of DEFAULT_WHATSAPP_TEMPLATES) {
    await WhatsAppTemplateModel.updateOne({ _id: key }, { $setOnInsert: template }, { upsert: true });
  }
  if ((await PrintProfileModel.countDocuments()) === 0) {
    await PrintProfileModel.insertMany(defaultPrintProfiles().map(({ id, ...p }) => ({ _id: id, ...p })));
  }
  if ((await LabelTemplateModel.countDocuments()) === 0) {
    const { id, ...t } = defaultLabelTemplate();
    await LabelTemplateModel.create({ _id: id, ...t });
  }
  await runMigrations();
}

/** Additive, idempotent upgrades for databases created before the taxonomy/barcode/price-history changes. */
async function runMigrations() {
  const branches = await BranchModel.find().select('_id code name').lean();
  for (const branch of branches) await ensureBranchCashRegister(branch);
  await migrateCompanyLogo();
  await ensureCategoryTree();
  const barcodes = await backfillProductBarcodes();
  if (barcodes) logger.info({ count: barcodes }, 'backfilled internal barcodes');
  await PriceHistoryModel.updateMany({ source: { $exists: false } }, { $set: { source: 'single' } });
  await PriceHistoryModel.updateMany({ branchId: { $exists: false } }, { $set: { branchId: '' } });
  await PrintProfileModel.updateMany({ showStamp: { $exists: false } }, { $set: { showStamp: true, showReviewStamp: false } });
  await migrateDiscountAmounts();
  // Managing the POS quick grid used to ride on settings.edit; give it to whoever already had that.
  await RoleModel.updateMany({ permissions: 'settings.edit' }, { $addToSet: { permissions: 'settings.quick_grid' } });
  await RoleModel.updateOne({ _id: 'branch_manager' }, { $addToSet: { permissions: 'settings.quick_grid' } });
}

async function migrateDiscountAmounts() {
  await ProductModel.updateMany(
    { maxDiscountAmount: { $exists: false }, maxDiscountPercent: { $exists: true } },
    [{ $set: { maxDiscountAmount: '$maxDiscountPercent' } }, { $unset: 'maxDiscountPercent' }],
  );
  const settings = await SettingsModel.findById('app').lean();
  const value = settings?.value as { pos?: { maxDiscountPercent?: number }; alerts?: { unusualDiscountPercent?: number } } | undefined;
  const updates: Record<string, number> = {};
  const unset: Record<string, 1> = {};
  if (value?.pos?.maxDiscountPercent != null) {
    updates['value.pos.maxDiscountAmount'] = value.pos.maxDiscountPercent;
    unset['value.pos.maxDiscountPercent'] = 1;
  }
  if (value?.alerts?.unusualDiscountPercent != null) {
    updates['value.alerts.unusualDiscountAmount'] = value.alerts.unusualDiscountPercent;
    unset['value.alerts.unusualDiscountPercent'] = 1;
  }
  if (Object.keys(updates).length) await SettingsModel.updateOne({ _id: 'app' }, { $set: updates, $unset: unset });
}
