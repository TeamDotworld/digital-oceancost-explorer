const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const { doHeaders, fetchAllPages, mapWithLimit, fetchDropletProjects, fetchInvoicePayments } = require('../utils/doApi');

// Helper function to process droplet cost data
const calculateDropletCosts = (droplets) => {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  // Cap billing hours at 672 (28 days * 24 hours) per DO's billing policy
  const hoursInMonth = Math.min(lastDayOfMonth * 24, 672);
  
  // Calculate cost metrics for this month
  return droplets.map(droplet => {
    const createdAt = new Date(droplet.created_at);
    let hoursRunning;
    
    // Check if created in current month
    if (createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear) {
      // Calculate hours from creation to end of month
      const daysRemaining = lastDayOfMonth - createdAt.getDate();
      const hoursRemainingInCreationDay = 24 - createdAt.getHours();
      hoursRunning = Math.min((daysRemaining * 24) + hoursRemainingInCreationDay, 672);
    } else {
      // Assume it runs for the whole month (capped at 672 hours)
      hoursRunning = hoursInMonth;
    }
    
    // Calculate costs
    const monthlyCost = droplet.size.price_monthly;
    const hourlyCost = droplet.size.price_hourly;
    const projectedCost = hoursRunning * hourlyCost;
    const fullMonthCost = 672 * hourlyCost; // DigitalOcean caps monthly billing at 672 hours
    
    return {
      id: droplet.id,
      name: droplet.name,
      region: droplet.region.slug,
      regionName: droplet.region.name,
      memory: droplet.size.memory,
      vcpus: droplet.size.vcpus,
      disk: droplet.size.disk,
      size: droplet.size.slug,
      created_at: droplet.created_at,
      hourly_price: hourlyCost,
      monthly_price: monthlyCost,
      projected_cost: projectedCost,
      full_month_cost: fullMonthCost,
      hours_running: hoursRunning,
      tags: droplet.tags || []
    };
  });
};

// Get all droplets with cost data
router.get('/live-costs', authMiddleware, async (req, res) => {
  try {
    const droplets = [];
    let page = 1;
    let hasMorePages = true;
    
    // Handle pagination to get all droplets
    while (hasMorePages) {
      const response = await axios.get(
        `https://api.digitalocean.com/v2/droplets?page=${page}&per_page=200`,
        {
          headers: {
            'Authorization': `Bearer ${req.doAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.droplets && response.data.droplets.length > 0) {
        droplets.push(...response.data.droplets);
        
        // Check if there are more pages
        if (response.data.links && 
            response.data.links.pages && 
            response.data.links.pages.next) {
          page++;
        } else {
          hasMorePages = false;
        }
      } else {
        hasMorePages = false;
      }
      
      // Safety check for too many droplets
      if (page > 25) { // 5000 droplets / 200 per page = 25 pages max
        hasMorePages = false;
      }
    }
    
    // Project lookup is best-effort so the page still works if it fails
    let dropletProjects = {};
    try {
      dropletProjects = await fetchDropletProjects(req.doAccessToken);
    } catch (projectError) {
      console.error('Error fetching projects:', projectError.response?.data || projectError.message);
    }

    // Calculate costs for all droplets
    const dropletsWithCosts = calculateDropletCosts(droplets).map(droplet => ({
      ...droplet,
      project: dropletProjects[String(droplet.id)] || null
    }));

    // Calculate summary by project
    const projectSummary = dropletsWithCosts.reduce((acc, droplet) => {
      const key = droplet.project ? droplet.project.id : 'none';
      if (!acc[key]) {
        acc[key] = {
          name: droplet.project ? droplet.project.name : 'No Project',
          count: 0,
          totalCost: 0,
          fullMonthCost: 0
        };
      }

      acc[key].count++;
      acc[key].totalCost += droplet.projected_cost;
      acc[key].fullMonthCost += droplet.full_month_cost;
      return acc;
    }, {});

    // Calculate summary by region
    const regionSummary = dropletsWithCosts.reduce((acc, droplet) => {
      if (!acc[droplet.region]) {
        acc[droplet.region] = {
          regionName: droplet.regionName,
          count: 0,
          totalCost: 0,
          fullMonthCost: 0
        };
      }
      
      acc[droplet.region].count++;
      acc[droplet.region].totalCost += droplet.projected_cost;
      acc[droplet.region].fullMonthCost += droplet.full_month_cost;
      return acc;
    }, {});
    
    // Calculate summary by tag
    const tagSummary = dropletsWithCosts.reduce((acc, droplet) => {
      if (droplet.tags && droplet.tags.length > 0) {
        droplet.tags.forEach(tag => {
          if (!acc[tag]) {
            acc[tag] = {
              count: 0,
              totalCost: 0,
              fullMonthCost: 0
            };
          }
          
          acc[tag].count++;
          acc[tag].totalCost += droplet.projected_cost;
          acc[tag].fullMonthCost += droplet.full_month_cost;
        });
      }
      return acc;
    }, {});
    
    // Calculate total cost
    const totalCost = dropletsWithCosts.reduce((sum, droplet) => sum + droplet.projected_cost, 0);
    const totalFullMonthCost = dropletsWithCosts.reduce((sum, droplet) => sum + droplet.full_month_cost, 0);
    
    res.json({
      droplets: dropletsWithCosts,
      regionSummary,
      tagSummary,
      projectSummary,
      totalCost,
      totalFullMonthCost,
      count: dropletsWithCosts.length
    });
    
  } catch (error) {
    console.error('Error fetching droplet data:', error);
    
    // Handle specific API errors
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      
      return res.status(error.response.status).json({
        message: 'Error fetching droplet data from DigitalOcean API',
        error: error.response.data
      });
    }
    
    res.status(500).json({
      message: 'Error fetching droplet data',
      error: error.message
    });
  }
});

// Get droplet names by IDs
router.post('/names', authMiddleware, async (req, res) => {
  try {
    const { dropletIds } = req.body;
    
    if (!dropletIds || !Array.isArray(dropletIds)) {
      return res.status(400).json({
        message: 'dropletIds array is required'
      });
    }

    if (dropletIds.length === 0) {
      return res.json({});
    }

    // Limit to prevent abuse
    if (dropletIds.length > 100) {
      return res.status(400).json({
        message: 'Maximum 100 droplet IDs allowed per request'
      });
    }

    const dropletNames = {};
    
    // Fetch droplets in batches to avoid URL length limits
    const batchSize = 20;
    for (let i = 0; i < dropletIds.length; i += batchSize) {
      const batch = dropletIds.slice(i, i + batchSize);
      const idsParam = batch.join(',');
      
      const response = await axios.get(
        `https://api.digitalocean.com/v2/droplets?ids=${idsParam}`,
        {
          headers: {
            'Authorization': `Bearer ${req.doAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data.droplets) {
        response.data.droplets.forEach(droplet => {
          dropletNames[droplet.id.toString()] = droplet.name;
        });
      }
    }
    
    res.json(dropletNames);
    
  } catch (error) {
    console.error('Error fetching droplet names:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching droplet names from DigitalOcean API',
        error: error.response.data
      });
    }
    
    res.status(500).json({
      message: 'Error fetching droplet names',
      error: error.message
    });
  }
});

// Estimate a droplet's cost for one month from its hourly rate (capped at 672 hours)
const estimateMonthCost = (monthStart, createdAt, hourlyPrice, now) => {
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const start = createdAt > monthStart ? createdAt : monthStart;
  const end = now < nextMonthStart ? now : nextMonthStart;
  const hours = Math.max(0, Math.ceil((end - start) / (60 * 60 * 1000)));
  return Math.min(hours, 672) * hourlyPrice;
};

const MAX_DETAIL_DROPLETS = 50;

// Get month-wise cost history for one or more droplets, from the earliest creation date until today
// Usage: GET /monthly-costs?ids=123,456
router.get('/monthly-costs', authMiddleware, async (req, res) => {
  const dropletIds = [...new Set(String(req.query.ids || '').split(',').map(id => id.trim()).filter(Boolean))];
  
  if (dropletIds.length === 0 || !dropletIds.every(id => /^\d+$/.test(id))) {
    return res.status(400).json({ message: 'ids must be a comma-separated list of droplet IDs' });
  }
  
  if (dropletIds.length > MAX_DETAIL_DROPLETS) {
    return res.status(400).json({ message: `Maximum ${MAX_DETAIL_DROPLETS} droplets allowed per request` });
  }
  
  try {
    const droplets = await mapWithLimit(dropletIds, 5, async (id) => {
      const response = await axios.get(
        `https://api.digitalocean.com/v2/droplets/${id}`,
        { headers: doHeaders(req.doAccessToken) }
      );
      return response.data.droplet;
    });
    const now = new Date();
    
    // Collect all invoices plus the in-progress preview for the current month
    const invoicesByPeriod = {};
    let nextUrl = 'https://api.digitalocean.com/v2/customers/my/invoices?per_page=200';
    while (nextUrl) {
      const response = await axios.get(nextUrl, { headers: doHeaders(req.doAccessToken) });
      (response.data.invoices || []).forEach(invoice => {
        invoicesByPeriod[invoice.invoice_period] = { ...invoice, isPreview: false };
      });
      if (response.data.invoice_preview) {
        const preview = response.data.invoice_preview;
        invoicesByPeriod[preview.invoice_period] = { ...preview, isPreview: true };
      }
      nextUrl = response.data.links?.pages?.next || null;
    }
    
    // Which payment method(s) paid each invoice; best-effort so the page still works without it
    let invoicePayments = {};
    try {
      invoicePayments = await fetchInvoicePayments(req.doAccessToken);
    } catch (paymentError) {
      console.error('Error fetching billing history:', paymentError.response?.data || paymentError.message);
    }
    
    // Share of a month's invoice paid by each method, e.g. [{ method: 'Visa 4242', fraction: 1 }]
    const paymentsFor = (invoice) => {
      if (!invoice) return [{ method: 'Unknown', fraction: 1 }];
      if (invoice.isPreview) return [{ method: 'Not yet invoiced', fraction: 1 }];
      const allocation = invoicePayments[invoice.invoice_uuid];
      if (!allocation || allocation.total <= 0) return [{ method: 'Unknown', fraction: 1 }];
      const split = allocation.payments.map(payment => ({ method: payment.method, fraction: payment.amount / allocation.total }));
      if (allocation.unpaid > 0.005) split.push({ method: 'Unpaid', fraction: allocation.unpaid / allocation.total });
      return split;
    };
    
    // Build the list of months from the earliest creation month to the current month
    const earliestCreated = new Date(Math.min(...droplets.map(droplet => new Date(droplet.created_at).getTime())));
    const months = [];
    const cursor = new Date(Date.UTC(earliestCreated.getUTCFullYear(), earliestCreated.getUTCMonth(), 1));
    while (cursor <= now) {
      months.push(new Date(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    
    const monthlyCosts = await mapWithLimit(months, 4, async (monthStart) => {
      const period = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
      const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
      const invoice = invoicesByPeriod[period];
      
      // Invoice line items are fetched once per month and shared across all selected droplets
      let items = null;
      if (invoice) {
        try {
          items = await fetchAllPages(
            `https://api.digitalocean.com/v2/customers/my/invoices/${invoice.invoice_uuid}?per_page=200`,
            'invoice_items',
            req.doAccessToken
          );
        } catch (invoiceError) {
          console.error(`Error fetching invoice items for ${period}:`, invoiceError.response?.data || invoiceError.message);
        }
      }
      
      const dropletCosts = {};
      droplets.forEach(droplet => {
        const id = String(droplet.id);
        const createdAt = new Date(droplet.created_at);
        
        // Skip months before this droplet existed
        if (createdAt >= nextMonthStart) return;
        
        const dropletItems = items ? items.filter(item => String(item.resource_id) === id) : [];
        
        if (dropletItems.length > 0) {
          // Group by product so droplet, backups, etc. are shown separately
          const breakdown = {};
          dropletItems.forEach(item => {
            const product = item.product || 'Other';
            breakdown[product] = (breakdown[product] || 0) + parseFloat(item.amount || 0);
          });
          
          dropletCosts[id] = {
            amount: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
            breakdown,
            source: invoice.isPreview ? 'preview' : 'invoice'
          };
        } else {
          // No billed line items found for this month, fall back to an estimate
          dropletCosts[id] = {
            amount: estimateMonthCost(monthStart, createdAt, droplet.size.price_hourly, now),
            breakdown: {},
            source: 'estimate'
          };
        }
      });
      
      return {
        period,
        amount: Object.values(dropletCosts).reduce((sum, cost) => sum + cost.amount, 0),
        droplets: dropletCosts,
        payments: paymentsFor(invoice)
      };
    });
    
    res.json({
      droplets: droplets.map(droplet => ({
        id: droplet.id,
        name: droplet.name,
        size: droplet.size.slug,
        region: droplet.region.slug,
        regionName: droplet.region.name,
        status: droplet.status,
        memory: droplet.size.memory,
        vcpus: droplet.size.vcpus,
        disk: droplet.size.disk,
        hourly_price: droplet.size.price_hourly,
        monthly_price: droplet.size.price_monthly,
        created_at: droplet.created_at,
        tags: droplet.tags || [],
        totalCost: monthlyCosts.reduce((sum, month) => sum + (month.droplets[String(droplet.id)]?.amount || 0), 0)
      })),
      monthlyCosts,
      totalCost: monthlyCosts.reduce((sum, month) => sum + month.amount, 0)
    });
    
  } catch (error) {
    console.error('Error fetching droplet monthly costs:', error.response?.data || error.message);
    
    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching droplet cost history from DigitalOcean API',
        error: error.response.data
      });
    }
    
    res.status(500).json({
      message: 'Error fetching droplet cost history',
      error: error.message
    });
  }
});

module.exports = router; 