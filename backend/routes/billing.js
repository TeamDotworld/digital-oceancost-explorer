const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { fetchBillingHistory, allocatePayments, fetchInvoices } = require('../utils/doApi');

// Every payment and credit, which invoice(s) it paid, and totals per payment method
router.get('/payments', authMiddleware, async (req, res) => {
  const token = req.doAccessToken;

  try {
    const [history, invoiceData] = await Promise.all([
      fetchBillingHistory(token),
      fetchInvoices(token).catch(error => {
        console.error('Error fetching invoices:', error.response?.data || error.message);
        return { invoices: [] };
      })
    ]);

    const periodByUuid = Object.fromEntries(invoiceData.invoices.map(invoice => [invoice.invoice_uuid, invoice.invoice_period]));
    const { payments } = allocatePayments(history);

    // Newest first, with the billing month of each invoice the payment went towards
    const rows = payments
      .map(payment => ({
        ...payment,
        appliedTo: payment.appliedTo.map(applied => ({ ...applied, period: periodByUuid[applied.invoiceUuid] || null }))
      }))
      .reverse();

    const methods = {};
    rows.forEach(payment => {
      if (!methods[payment.method]) {
        methods[payment.method] = { method: payment.method, type: payment.type, total: 0, count: 0, firstUsed: payment.date, lastUsed: payment.date };
      }
      const method = methods[payment.method];
      method.total += payment.amount;
      method.count++;
      if (new Date(payment.date) < new Date(method.firstUsed)) method.firstUsed = payment.date;
      if (new Date(payment.date) > new Date(method.lastUsed)) method.lastUsed = payment.date;
    });

    res.json({
      payments: rows,
      methods: Object.values(methods).sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed)),
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching payment history:', error.response?.data || error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching billing history from DigitalOcean API',
        error: error.response.data
      });
    }

    res.status(500).json({ message: 'Error fetching payment history', error: error.message });
  }
});

module.exports = router;
