import type { ID, ListQuery, MessageStatus, Paginated, WhatsAppMessage, WhatsAppTemplate, WhatsAppTemplateKey } from '@/types';
import { api } from './api';

export function renderTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{([a-zA-Z_]+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export const whatsappService = {
  mode: 'api' as const,
  templates: (): Promise<WhatsAppTemplate[]> => api.whatsapp.templates(),
  saveTemplate: (key: WhatsAppTemplateKey, patch: Partial<WhatsAppTemplate>): Promise<WhatsAppTemplate> => api.whatsapp.saveTemplate(key, patch),
  messages: (q: ListQuery & { customerId?: ID; status?: MessageStatus; templateKey?: WhatsAppTemplateKey } = {}): Promise<Paginated<WhatsAppMessage>> => api.whatsapp.messages(q),
  stats: () => api.whatsapp.stats(),
  send: (input: { customerId: ID; phone: string; templateKey: WhatsAppTemplateKey; body: string; userId?: ID; referenceId?: ID }): Promise<WhatsAppMessage> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.whatsapp.send(rest);
  },
  retry: (id: ID): Promise<WhatsAppMessage> => api.whatsapp.retry(id),
};
