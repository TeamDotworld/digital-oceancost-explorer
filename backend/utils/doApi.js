const axios = require('axios');

const doHeaders = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
});

// Fetch every page of a DO list endpoint and return the combined items under `key`
const fetchAllPages = async (url, key, token, maxPages = 25) => {
  const items = [];
  let nextUrl = url;
  let pages = 0;

  while (nextUrl && pages < maxPages) {
    const response = await axios.get(nextUrl, { headers: doHeaders(token) });
    items.push(...(response.data[key] || []));
    nextUrl = response.data.links?.pages?.next || null;
    pages++;
  }

  return items;
};

// Run async tasks with a concurrency limit to avoid hitting DO rate limits
const mapWithLimit = async (items, limit, fn) => {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
};

// Build a map of resource URN (e.g. "do:droplet:123") -> { id, name } of the project it belongs to
const fetchResourceProjects = async (token) => {
  const projects = await fetchAllPages('https://api.digitalocean.com/v2/projects?per_page=200', 'projects', token);
  const resourceProjects = {};

  await mapWithLimit(projects, 5, async (project) => {
    const resources = await fetchAllPages(
      `https://api.digitalocean.com/v2/projects/${project.id}/resources?per_page=200`,
      'resources',
      token
    );

    resources.forEach(resource => {
      if (resource.urn) {
        resourceProjects[resource.urn] = { id: project.id, name: project.name };
      }
    });
  });

  return resourceProjects;
};

// Build a map of droplet ID -> { id, name } for the project each droplet belongs to
const fetchDropletProjects = async (token) => {
  const resourceProjects = await fetchResourceProjects(token);
  const dropletProjects = {};

  Object.entries(resourceProjects).forEach(([urn, project]) => {
    const match = urn.match(/^do:droplet:(\d+)$/);
    if (match) {
      dropletProjects[match[1]] = project;
    }
  });

  return dropletProjects;
};

// Fetch all invoices (newest first) plus the in-progress preview for the current month
const fetchInvoices = async (token) => {
  const invoices = [];
  let preview = null;
  let nextUrl = 'https://api.digitalocean.com/v2/customers/my/invoices?per_page=200';

  while (nextUrl) {
    const response = await axios.get(nextUrl, { headers: doHeaders(token) });
    invoices.push(...(response.data.invoices || []));
    if (response.data.invoice_preview) preview = response.data.invoice_preview;
    nextUrl = response.data.links?.pages?.next || null;
  }

  invoices.sort((a, b) => b.invoice_period.localeCompare(a.invoice_period));
  return { invoices, preview };
};

const fetchInvoiceItems = (invoiceUuid, token) => fetchAllPages(
  `https://api.digitalocean.com/v2/customers/my/invoices/${invoiceUuid}?per_page=200`,
  'invoice_items',
  token
);

// Sum invoice line item amounts per resource, keyed by both resource UUID and resource ID
const sumItemsByResource = (items) => {
  const totals = {};
  items.forEach(item => {
    const amount = parseFloat(item.amount || 0);
    [item.resource_uuid, item.resource_id].filter(Boolean).forEach(key => {
      totals[String(key)] = (totals[String(key)] || 0) + amount;
    });
  });
  return totals;
};

// "Payment (Visa 4242)" -> "Visa 4242"; credits and other entries keep a readable label
const paymentMethodLabel = (entry) => {
  if (entry.type === 'Payment') {
    const match = /\(([^)]+)\)/.exec(entry.description || '');
    return match ? match[1].trim() : (entry.description || 'Payment');
  }
  if (entry.type === 'Credit') return 'Account credit';
  return entry.description || entry.type || 'Other';
};

const fetchBillingHistory = (token) => fetchAllPages(
  'https://api.digitalocean.com/v2/customers/my/billing_history?per_page=200',
  'billing_history',
  token
);

/**
 * Work out which payment method(s) paid each invoice.
 * DigitalOcean's billing history lists invoices and payments separately without linking them, so payments
 * and credits are applied to the oldest unpaid invoice first, like a running account balance.
 * Returns {
 *   invoices: { [invoice_uuid]: { total, payments: [{ method, amount }], unpaid } },
 *   payments: [{ date, amount, method, type, description, receiptId, appliedTo: [{ invoiceUuid, amount }] }]
 * }
 */
const allocatePayments = (history) => {
  const byDate = (a, b) => new Date(a.date) - new Date(b.date);

  const invoices = history
    .filter(entry => entry.type === 'Invoice' && entry.invoice_uuid && parseFloat(entry.amount) > 0)
    .sort(byDate)
    .map(entry => ({ uuid: entry.invoice_uuid, total: parseFloat(entry.amount), remaining: parseFloat(entry.amount), payments: [] }));

  const payments = history
    .filter(entry => entry.type !== 'Invoice' && parseFloat(entry.amount) < 0)
    .sort(byDate)
    .map(entry => {
      let left = -parseFloat(entry.amount);
      const method = paymentMethodLabel(entry);
      const appliedTo = [];

      for (const invoice of invoices) {
        if (left <= 0.005) break;
        if (invoice.remaining <= 0.005) continue;
        const applied = Math.min(left, invoice.remaining);
        const existing = invoice.payments.find(p => p.method === method);
        if (existing) existing.amount += applied;
        else invoice.payments.push({ method, amount: applied });
        appliedTo.push({ invoiceUuid: invoice.uuid, amount: applied });
        invoice.remaining -= applied;
        left -= applied;
      }

      return {
        date: entry.date,
        amount: -parseFloat(entry.amount),
        method,
        type: entry.type,
        description: entry.description || '',
        receiptId: entry.receipt_id || null,
        appliedTo
      };
    });

  return {
    invoices: Object.fromEntries(invoices.map(invoice => [invoice.uuid, {
      total: invoice.total,
      payments: invoice.payments,
      unpaid: Math.max(0, invoice.remaining)
    }])),
    payments
  };
};

// Returns { [invoice_uuid]: { total, payments: [{ method, amount }], unpaid } }
const fetchInvoicePayments = async (token) => allocatePayments(await fetchBillingHistory(token)).invoices;

module.exports = {
  fetchInvoicePayments,
  fetchBillingHistory,
  allocatePayments,
  doHeaders,
  fetchAllPages,
  mapWithLimit,
  fetchResourceProjects,
  fetchDropletProjects,
  fetchInvoices,
  fetchInvoiceItems,
  sumItemsByResource
};
