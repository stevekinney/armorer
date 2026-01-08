import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createArmorer } from '../src/create-armorer';
import type { ToolConfig } from '../src/is-tool';
import { searchTools } from '../src/registry';

const makeRegistry = (embed?: (texts: string[]) => number[][]) =>
  createArmorer(realWorldTools(), embed ? { embed } : undefined);

describe('search real-world scenarios', () => {
  it('ranks refund workflows highest for refund searches', () => {
    const armorer = makeRegistry();
    const results = searchTools(armorer, {
      rank: { text: 'refund order' },
      limit: 3,
    });

    expect(results[0]?.tool.name).toBe('issue-refund');
  });

  it('highlights schema key matches in explain output', () => {
    const armorer = makeRegistry();
    const results = searchTools(armorer, {
      rank: { text: 'trackingId' },
      explain: true,
      limit: 2,
    });

    const top = results[0];
    expect(top?.tool.name).toBe('track-shipment');
    expect(top?.reasons).toContain('text:schema-keys(trackingId)');
    expect(top?.matches?.schemaKeys).toEqual(['trackingId']);
  });

  it('matches metadata keys for localization tools', () => {
    const armorer = makeRegistry();
    const results = searchTools(armorer, {
      rank: { text: 'locale' },
      explain: true,
      limit: 2,
    });

    const top = results[0];
    expect(top?.tool.name).toBe('translate-message');
    expect(top?.reasons).toContain('text:metadata-keys(locale)');
    expect(top?.matches?.metadataKeys).toEqual(['locale']);
  });

  it('honors tag boosts for risk investigations', () => {
    const armorer = makeRegistry();
    const results = searchTools(armorer, {
      rank: { tags: ['fraud', 'risk'], tagBoosts: { fraud: 3 } },
      limit: 3,
    });

    expect(results[0]?.tool.name).toBe('flag-fraud');
    expect(results[0]?.reasons).toContain('tag:fraud');
  });

  it('uses embeddings to surface shipping tools for parcel searches', () => {
    const embed = (texts: string[]) =>
      texts.map((text) => {
        const normalized = text.toLowerCase();
        if (
          normalized.includes('shipment') ||
          normalized.includes('tracking') ||
          normalized.includes('parcel') ||
          normalized.includes('location')
        ) {
          return [1, 0];
        }
        if (normalized.includes('delivery')) {
          return [0.8, 0.2];
        }
        if (
          normalized.includes('refund') ||
          normalized.includes('payment') ||
          normalized.includes('invoice')
        ) {
          return [0, 1];
        }
        return [0, 0];
      });

    const armorer = makeRegistry(embed);
    const results = searchTools(armorer, {
      rank: { text: { query: 'parcel location', mode: 'fuzzy', threshold: 0.4 } },
      explain: true,
      limit: 3,
    });

    expect(results[0]?.tool.name).toBe('track-shipment');
    expect(results[0]?.reasons.some((reason) => reason.startsWith('embedding:'))).toBe(
      true,
    );
    expect(results.map((entry) => entry.tool.name)).toEqual(
      expect.arrayContaining(['schedule-delivery']),
    );
  });
});

function realWorldTools(): ToolConfig[] {
  return [
    {
      name: 'issue-refund',
      description: 'issue refund for an order with item-level adjustments',
      tags: ['billing', 'refund', 'orders'],
      metadata: { domain: 'billing', tier: 'pro' },
      schema: z.object({
        orderId: z.string(),
        amount: z.number().optional(),
        reason: z.string().optional(),
      }),
      execute: async () => null,
    },
    {
      name: 'capture-payment',
      description: 'capture an authorized card payment for an order',
      tags: ['billing', 'payments'],
      metadata: { domain: 'billing', tier: 'pro' },
      schema: z.object({
        paymentId: z.string(),
        amount: z.number(),
      }),
      execute: async () => null,
    },
    {
      name: 'track-shipment',
      description: 'track shipment status and carrier updates',
      tags: ['shipping', 'tracking', 'orders'],
      metadata: { domain: 'logistics', tier: 'free' },
      schema: z.object({
        trackingId: z.string(),
        carrier: z.string().optional(),
      }),
      execute: async () => null,
    },
    {
      name: 'schedule-delivery',
      description: 'schedule a delivery window for an order',
      tags: ['shipping', 'delivery'],
      metadata: { domain: 'logistics', locale: 'en-US' },
      schema: z.object({
        orderId: z.string(),
        date: z.string(),
      }),
      execute: async () => null,
    },
    {
      name: 'update-inventory',
      description: 'update inventory counts for a SKU',
      tags: ['inventory', 'catalog'],
      metadata: { domain: 'catalog', pii: false },
      schema: z.object({
        sku: z.string(),
        quantity: z.number(),
      }),
      execute: async () => null,
    },
    {
      name: 'summarize-support-tickets',
      description: 'summarize open support tickets by category',
      tags: ['support', 'analysis'],
      metadata: { domain: 'support', owner: 'team-support' },
      schema: z.object({
        since: z.string(),
        limit: z.number().optional(),
      }),
      execute: async () => null,
    },
    {
      name: 'translate-message',
      description: 'translate a customer message to the requested locale',
      tags: ['localization', 'text'],
      metadata: { domain: 'support', locale: 'es-ES' },
      schema: z.object({
        text: z.string(),
        locale: z.string(),
      }),
      execute: async () => null,
    },
    {
      name: 'flag-fraud',
      description: 'flag suspicious orders for manual review',
      tags: ['risk', 'fraud', 'orders'],
      metadata: { domain: 'risk', tier: 'enterprise' },
      schema: z.object({
        orderId: z.string(),
        score: z.number(),
      }),
      execute: async () => null,
    },
    {
      name: 'get-order-status',
      description: 'fetch the current order status and last update',
      tags: ['orders', 'status'],
      metadata: { domain: 'orders', cache: 'short' },
      schema: z.object({
        orderId: z.string(),
      }),
      execute: async () => null,
    },
    {
      name: 'create-customer-profile',
      description: 'create a customer profile with marketing preferences',
      tags: ['customers', 'crm'],
      metadata: { domain: 'crm', pii: true },
      schema: z.object({
        email: z.string(),
        name: z.string(),
      }),
      execute: async () => null,
    },
    {
      name: 'list-invoices',
      description: 'list invoices for a billing account',
      tags: ['billing', 'invoices'],
      metadata: { domain: 'billing', tier: 'pro' },
      schema: z.object({
        accountId: z.string(),
      }),
      execute: async () => null,
    },
    {
      name: 'log-audit-event',
      description: 'write audit log entries for compliance',
      tags: ['audit', 'logs'],
      metadata: { domain: 'compliance' },
      schema: z.object({
        event: z.string(),
        actorId: z.string(),
      }),
      execute: async () => null,
    },
  ];
}
