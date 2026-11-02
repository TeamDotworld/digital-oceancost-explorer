const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { fetchAllPages, fetchInvoices, fetchInvoiceItems, sumItemsByResource } = require('../utils/doApi');

const API = 'https://api.digitalocean.com/v2';
const PANEL = 'https://cloud.digitalocean.com';

// DigitalOcean list prices, only used when a resource isn't on the last invoice yet
const LIST_PRICES = {
  volumePerGb: 0.10,
  snapshotPerGb: 0.06,
  idleReservedIp: 5.00,
  loadBalancerNode: 12.00
};

// Snapshots younger than this are never reported; the page lets the user raise the threshold
const MIN_SNAPSHOT_AGE_DAYS = 30;

const safeFetch = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error fetching ${label}:`, error.response?.data || error.message);
    return fallback;
  }
};

const ageInDays = (date) => Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));

// Find resources that are billed but look unused, with their monthly cost
router.get('/', authMiddleware, async (req, res) => {
  const token = req.doAccessToken;

  try {
    const [droplets, volumes, snapshots, reservedIps, loadBalancers, { invoices }] = await Promise.all([
      fetchAllPages(`${API}/droplets?per_page=200`, 'droplets', token),
      safeFetch('volumes', () => fetchAllPages(`${API}/volumes?per_page=200`, 'volumes', token), []),
      safeFetch('snapshots', () => fetchAllPages(`${API}/snapshots?per_page=200`, 'snapshots', token), []),
      safeFetch('reserved IPs', () => fetchAllPages(`${API}/reserved_ips?per_page=200`, 'reserved_ips', token), []),
      safeFetch('load balancers', () => fetchAllPages(`${API}/load_balancers?per_page=200`, 'load_balancers', token), []),
      safeFetch('invoices', () => fetchInvoices(token), { invoices: [] })
    ]);

    // Actual billed amounts from the most recent finalized invoice
    const lastInvoice = invoices[0] || null;
    const billed = lastInvoice
      ? sumItemsByResource(await safeFetch('last invoice items', () => fetchInvoiceItems(lastInvoice.invoice_uuid, token), []))
      : {};

    const costFor = (keys, fallbackCost, fallbackSource = 'estimate') => {
      for (const key of keys.filter(Boolean).map(String)) {
        if (billed[key] > 0) return { monthlyCost: billed[key], costSource: 'invoice' };
      }
      return { monthlyCost: fallbackCost, costSource: fallbackSource };
    };

    const dropletIds = new Set(droplets.map(droplet => String(droplet.id)));
    const volumeIds = new Set(volumes.map(volume => volume.id));
    const items = [];

    // Droplets that are switched off are still billed in full
    droplets.filter(droplet => droplet.status === 'off').forEach(droplet => {
      items.push({
        id: `droplet-${droplet.id}`,
        category: 'Powered-off droplet',
        name: droplet.name,
        resourceId: droplet.id,
        region: droplet.region?.name || droplet.region?.slug || '',
        reason: 'Switched off but still billed. Snapshot and destroy it if it is no longer needed.',
        details: `${droplet.size_slug} · ${droplet.vcpus} vCPU · ${droplet.memory / 1024} GB RAM`,
        createdAt: droplet.created_at,
        ...costFor([droplet.id], droplet.size?.price_monthly || 0, 'price'),
        url: `${PANEL}/droplets/${droplet.id}`
      });
    });

    // Volumes not attached to any droplet
    volumes.filter(volume => !volume.droplet_ids || volume.droplet_ids.length === 0).forEach(volume => {
      items.push({
        id: `volume-${volume.id}`,
        category: 'Unattached volume',
        name: volume.name,
        resourceId: volume.id,
        region: volume.region?.name || volume.region?.slug || '',
        reason: 'Not attached to any droplet.',
        details: `${volume.size_gigabytes} GB`,
        sizeGb: volume.size_gigabytes,
        createdAt: volume.created_at,
        ...costFor([volume.id], volume.size_gigabytes * LIST_PRICES.volumePerGb),
        url: `${PANEL}/volumes`
      });
    });

    // Snapshots: old ones, and ones whose source droplet or volume no longer exists
    snapshots.forEach(snapshot => {
      const age = ageInDays(snapshot.created_at);
      const sourceGone = snapshot.resource_type === 'volume'
        ? !volumeIds.has(snapshot.resource_id)
        : !dropletIds.has(String(snapshot.resource_id));
      if (age < MIN_SNAPSHOT_AGE_DAYS && !sourceGone) return;

      items.push({
        id: `snapshot-${snapshot.id}`,
        category: 'Old snapshot',
        name: snapshot.name,
        resourceId: snapshot.id,
        region: (snapshot.regions || []).join(', '),
        reason: sourceGone
          ? `Source ${snapshot.resource_type} no longer exists.`
          : `${age} days old.`,
        details: `${snapshot.size_gigabytes} GB ${snapshot.resource_type} snapshot`,
        sizeGb: snapshot.size_gigabytes,
        ageDays: age,
        sourceGone,
        createdAt: snapshot.created_at,
        ...costFor([snapshot.id], snapshot.size_gigabytes * LIST_PRICES.snapshotPerGb),
        url: `${PANEL}/images/snapshots/${snapshot.resource_type === 'volume' ? 'volumes' : 'droplets'}`
      });
    });

    // Reserved IPs that aren't assigned to a droplet
    reservedIps.filter(reserved => !reserved.droplet).forEach(reserved => {
      items.push({
        id: `reserved-${reserved.ip}`,
        category: 'Idle reserved IP',
        name: reserved.ip,
        resourceId: reserved.ip,
        region: reserved.region?.name || reserved.region?.slug || '',
        reason: 'Not assigned to any droplet. Unassigned reserved IPs are billed.',
        details: 'Reserved IPv4',
        ...costFor([reserved.ip], LIST_PRICES.idleReservedIp),
        url: `${PANEL}/networking/reserved_ips`
      });
    });

    // Load balancers with nothing behind them
    loadBalancers.filter(lb => !lb.droplet_ids || lb.droplet_ids.length === 0).forEach(lb => {
      items.push({
        id: `lb-${lb.id}`,
        category: 'Empty load balancer',
        name: lb.name,
        resourceId: lb.id,
        region: lb.region?.name || lb.region?.slug || '',
        reason: lb.tag ? `No droplets have the "${lb.tag}" tag.` : 'No droplets behind it.',
        details: lb.ip ? `IP ${lb.ip}` : '',
        createdAt: lb.created_at,
        ...costFor([lb.id], (lb.size_unit || 1) * LIST_PRICES.loadBalancerNode),
        url: `${PANEL}/networking/load_balancers/${lb.id}`
      });
    });

    items.sort((a, b) => b.monthlyCost - a.monthlyCost);

    res.json({
      items,
      invoicePeriod: lastInvoice?.invoice_period || null,
      listPrices: LIST_PRICES,
      minSnapshotAgeDays: MIN_SNAPSHOT_AGE_DAYS,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error finding unused resources:', error.response?.data || error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching resources from DigitalOcean API',
        error: error.response.data
      });
    }

    res.status(500).json({ message: 'Error finding unused resources', error: error.message });
  }
});

module.exports = router;
