import type { ClientSession } from 'mongoose';
import { RegisterSessionModel } from '../../db/models.js';
import { HttpError } from '../../lib/errors.js';

/** Resolve the paying/receiving drawer without choosing an arbitrary cashier's session. */
export async function resolveCashSession(branchId: string, userId: string, preferredId?: string | null, session?: ClientSession) {
  if (preferredId) {
    const selected = await RegisterSessionModel.findById(preferredId).session(session ?? null);
    if (!selected || selected.status !== 'open') throw new HttpError(422, 'SESSION_CLOSED', 'Selected drawer is closed');
    if (selected.branchId !== branchId) throw new HttpError(403, 'BRANCH_DENIED', 'Selected drawer belongs to another branch');
    return selected;
  }
  const owned = await RegisterSessionModel.find({ branchId, status: 'open', userId }).limit(2).session(session ?? null);
  if (owned.length === 1) return owned[0]!;
  const candidates = owned.length ? owned : await RegisterSessionModel.find({ branchId, status: 'open' }).limit(2).session(session ?? null);
  if (candidates.length > 1) throw new HttpError(409, 'REGISTER_SESSION_REQUIRED', 'Select the drawer handling this cash transaction');
  return candidates[0] ?? null;
}
