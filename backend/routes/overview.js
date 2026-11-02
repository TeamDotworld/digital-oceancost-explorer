const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const { doHeaders, fetchAllPages, fetchInvoices, fetchInvoiceItems } = require('../utils/doApi');

const API = 'https://api.digitalocean.com/v2';

const safeFetch = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error fetching ${label}:`, error.response?.data || error.message);
    return fallback;
  }
};

const periodOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

// Group invoice line items and return the most expensive groups
const topGroups = (items, keyFn, nameFn, limit = 5) => {
  const groups = {};
  items.forEach(item => {
    const key = keyFn(item);
    if (!key) return;
    if (!groups[key]) groups[key] = { key, name: nameFn(item), product: item.product || '', amount: 0 };
    groups[key].amount += parseFloat(item.amount || 0);
  });
  return Object.values(groups)
    .filter(group => group.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
};

// Month-at-a-glance numbers: spend so far, projection, last month, top resources and projects
router.get('/', authMiddleware, async (req, res) => {
  const token = req.doAccessToken;

  try {
    const [balance, { invoices, preview }, droplets, volumes, databases, loadBalancers, clusters] = await Promise.all([
      safeFetch('balance', async () => (await axios.get(`${API}/customers/my/balance`, { headers: doHeaders(token) })).data, null),
      fetchInvoices(token),
      safeFetch('droplets', () => fetchAllPages(`${API}/droplets?per_page=200`, 'droplets', token), []),
      safeFetch('volumes', () => fetchAllPages(`${API}/volumes?per_page=200`, 'volumes', token), []),
      safeFetch('databases', () => fetchAllPages(`${API}/databases`, 'databases', token), []),
      safeFetch('load balancers', () => fetchAllPages(`${API}/load_balancers?per_page=200`, 'load_balancers', token), []),
      safeFetch('Kubernetes clusters', () => fetchAllPages(`${API}/kubernetes/clusters?per_page=200`, 'kubernetes_clusters', token), [])
    ]);

    // Friendly names for invoice line items, keyed by resource ID / UUID
    const resourceNames = {};
    droplets.forEach(d => { resourceNames[String(d.id)] = d.name; });
    volumes.forEach(v => { resourceNames[v.id] = v.name; });
    databases.forEach(db => { resourceNames[db.id] = db.name; });
    loadBalancers.forEach(lb => { resourceNames[lb.id] = lb.name; });
    clusters.forEach(cluster => { resourceNames[cluster.id] = cluster.name; });

    const previewItems = preview
      ? await safeFetch('current month invoice items', () => fetchInvoiceItems(preview.invoice_uuid, token), [])
      : [];

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const elapsedFraction = Math.min(1, Math.max(0.01, (now - monthStart) / (nextMonthStart - monthStart)));

    const monthToDate = balance?.month_to_date_usage != null
      ? parseFloat(balance.month_to_date_usage)
      : parseFloat(preview?.amount || 0);
    const projected = monthToDate / elapsedFraction;

    const lastPeriod = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const lastInvoice = invoices.find(invoice => invoice.invoice_period === lastPeriod) || null;
    const lastMonthTotal = lastInvoice ? parseFloat(lastInvoice.amount) : null;

    const itemName = (item) => resourceNames[String(item.resource_uuid)] || resourceNames[String(item.resource_id)] ||
      item.description || item.group_description || item.product || 'Unknown';

    const topResources = topGroups(
      previewItems,
      item => item.resource_uuid || item.resource_id || `${item.product}:${item.description}`,
      itemName
    );
    const topProjects = topGroups(previewItems, item => item.project_name || 'No project', item => item.project_name || 'No project');
    const byCategory = topGroups(previewItems, item => item.product || 'Other', item => item.product || 'Other', 50);

    // Last 12 invoiced months plus the current month (actual so far and projected)
    const history = invoices
      .slice(0, 12)
      .map(invoice => ({ period: invoice.invoice_period, amount: parseFloat(invoice.amount) }))
      .reverse();
    history.push({ period: periodOf(now), amount: monthToDate, projected, current: true });

    res.json({
      period: periodOf(now),
      monthToDate,
      projected,
      elapsedFraction,
      lastMonth: lastInvoice ? { period: lastPeriod, amount: lastMonthTotal } : null,
      // Last month's spend pro-rated to the same point in the month, for a like-for-like comparison
      lastMonthToDate: lastMonthTotal != null ? lastMonthTotal * elapsedFraction : null,
      accountBalance: balance?.account_balance != null ? parseFloat(balance.account_balance) : null,
      topResources,
      topProjects,
      byCategory,
      history,
      generatedAt: now.toISOString()
    });

  } catch (error) {
    console.error('Error building overview:', error.response?.data || error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching overview data from DigitalOcean API',
        error: error.response.data
      });
    }

    res.status(500).json({ message: 'Error building overview', error: error.message });
  }
});

module.exports = router;
