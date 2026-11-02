const express = require('express');
const router = express.Router();
const dns = require('node:dns').promises;
const authMiddleware = require('../middleware/authMiddleware');
const { fetchAllPages, fetchResourceProjects } = require('../utils/doApi');

const API = 'https://api.digitalocean.com/v2';
const PANEL = 'https://cloud.digitalocean.com';

// Each source is best-effort: one failing API (e.g. a product the account doesn't use) shouldn't break the page
const safeFetch = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error fetching ${label}:`, error.response?.data || error.message);
    return fallback;
  }
};

// Resolve a database hostname to its IPv4 address, giving up after a short timeout
const resolveHost = async (host) => {
  if (!host) return null;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    const addresses = await Promise.race([dns.resolve4(host), timeout]);
    return addresses[0] || null;
  } catch (error) {
    return null;
  }
};

// Get every IP address in the account: droplets, reserved IPs, load balancers, databases and Kubernetes
router.get('/ip-addresses', authMiddleware, async (req, res) => {
  const token = req.doAccessToken;

  try {
    const [droplets, reservedIps, reservedIpv6s, loadBalancers, databases, clusters, vpcs, regions, resourceProjects] = await Promise.all([
      fetchAllPages(`${API}/droplets?per_page=200`, 'droplets', token),
      safeFetch('reserved IPs', () => fetchAllPages(`${API}/reserved_ips?per_page=200`, 'reserved_ips', token), []),
      safeFetch('reserved IPv6s', () => fetchAllPages(`${API}/reserved_ipv6?per_page=200`, 'reserved_ipv6s', token), []),
      safeFetch('load balancers', () => fetchAllPages(`${API}/load_balancers?per_page=200`, 'load_balancers', token), []),
      safeFetch('databases', () => fetchAllPages(`${API}/databases`, 'databases', token), []),
      safeFetch('Kubernetes clusters', () => fetchAllPages(`${API}/kubernetes/clusters?per_page=200`, 'kubernetes_clusters', token), []),
      safeFetch('VPCs', () => fetchAllPages(`${API}/vpcs?per_page=200`, 'vpcs', token), []),
      safeFetch('regions', () => fetchAllPages(`${API}/regions?per_page=200`, 'regions', token), []),
      safeFetch('projects', () => fetchResourceProjects(token), {})
    ]);

    const regionNames = Object.fromEntries(regions.map(region => [region.slug, region.name]));
    const vpcById = Object.fromEntries(vpcs.map(vpc => [vpc.id, { id: vpc.id, name: vpc.name, ipRange: vpc.ip_range }]));
    const dropletById = Object.fromEntries(droplets.map(droplet => [droplet.id, droplet]));
    const regionInfo = (slug) => ({ region: slug || '', regionName: regionNames[slug] || slug || '' });

    const rows = [];
    const addRow = (row) => {
      rows.push({
        ip: null,
        host: null,
        port: null,
        version: 4,
        scope: 'public',
        reserved: false,
        idle: false,
        assignedTo: null,
        project: null,
        vpc: null,
        status: '',
        tags: [],
        note: '',
        ...row,
        key: `${row.resourceType}-${row.resourceId}-${row.ip || row.host}-${rows.length}`
      });
    };

    // Droplets: public/private IPv4 and IPv6 from the droplet's network interfaces
    droplets.forEach(droplet => {
      const base = {
        resourceType: 'Droplet',
        resourceId: droplet.id,
        resourceName: droplet.name,
        ...regionInfo(droplet.region?.slug),
        project: resourceProjects[`do:droplet:${droplet.id}`] || null,
        vpc: vpcById[droplet.vpc_uuid] || null,
        status: droplet.status,
        tags: droplet.tags || [],
        url: `${PANEL}/droplets/${droplet.id}`
      };

      (droplet.networks?.v4 || []).forEach(net => {
        addRow({ ...base, ip: net.ip_address, scope: net.type === 'private' ? 'private' : 'public', gateway: net.gateway, netmask: net.netmask });
      });
      (droplet.networks?.v6 || []).forEach(net => {
        addRow({ ...base, ip: net.ip_address, version: 6, scope: net.type === 'private' ? 'private' : 'public', gateway: net.gateway, netmask: net.netmask });
      });
    });

    // Reserved IPs: flag unassigned ones because DigitalOcean bills for them
    const addReserved = (reserved, version) => {
      const dropletId = reserved.droplet?.id;
      const droplet = dropletId ? dropletById[dropletId] || reserved.droplet : null;
      addRow({
        resourceType: 'Reserved IP',
        resourceId: reserved.ip,
        resourceName: droplet ? droplet.name : 'Unassigned',
        ip: reserved.ip,
        version,
        reserved: true,
        idle: !droplet,
        assignedTo: droplet ? { id: droplet.id, name: droplet.name } : null,
        ...regionInfo(reserved.region?.slug || reserved.region_slug),
        project: resourceProjects[`do:reservedip:${reserved.ip}`] || resourceProjects[`do:floatingip:${reserved.ip}`] || (droplet ? resourceProjects[`do:droplet:${droplet.id}`] : null) || null,
        status: droplet ? 'assigned' : 'unassigned',
        tags: droplet?.tags || [],
        note: droplet ? `Points to ${droplet.name}` : 'Not assigned to any droplet (still billed)',
        url: `${PANEL}/networking/reserved_ips`
      });
    };
    reservedIps.forEach(reserved => addReserved(reserved, 4));
    reservedIpv6s.forEach(reserved => addReserved(reserved, 6));

    // Load balancers: the LB's own IP, which is private for internal load balancers
    loadBalancers.forEach(lb => {
      const base = {
        resourceType: 'Load Balancer',
        resourceId: lb.id,
        resourceName: lb.name,
        ...regionInfo(lb.region?.slug),
        project: resourceProjects[`do:loadbalancer:${lb.id}`] || null,
        vpc: vpcById[lb.vpc_uuid] || null,
        status: lb.status,
        tags: lb.tag ? [lb.tag] : [],
        note: `${(lb.droplet_ids || []).length} droplet(s) behind it`,
        url: `${PANEL}/networking/load_balancers/${lb.id}`
      };
      const internal = lb.network === 'INTERNAL';
      if (lb.ip) addRow({ ...base, ip: lb.ip, scope: internal ? 'private' : 'public' });
      if (lb.ipv6) addRow({ ...base, ip: lb.ipv6, version: 6, scope: internal ? 'private' : 'public' });
    });

    // Databases: public and private (VPC) hostnames, resolved to IPs where DNS allows
    await Promise.all(databases.map(async (db) => {
      const base = {
        resourceType: 'Database',
        resourceId: db.id,
        resourceName: db.name,
        ...regionInfo(db.region),
        project: resourceProjects[`do:dbaas:${db.id}`] || null,
        vpc: vpcById[db.private_network_uuid] || null,
        status: db.status,
        tags: db.tags || [],
        note: `${db.engine}${db.version ? ` ${db.version}` : ''}`,
        url: `${PANEL}/databases/${db.id}`
      };
      const [publicIp, privateIp] = await Promise.all([
        resolveHost(db.connection?.host),
        resolveHost(db.private_connection?.host)
      ]);
      if (db.connection?.host) {
        addRow({ ...base, ip: publicIp, host: db.connection.host, port: db.connection.port, scope: 'public' });
      }
      if (db.private_connection?.host) {
        addRow({ ...base, ip: privateIp, host: db.private_connection.host, port: db.private_connection.port, scope: 'private' });
      }
    }));

    // Kubernetes: control plane endpoint plus the cluster's pod/service ranges (nodes appear as droplets)
    clusters.forEach(cluster => {
      const base = {
        resourceType: 'Kubernetes',
        resourceId: cluster.id,
        resourceName: cluster.name,
        ...regionInfo(cluster.region),
        project: resourceProjects[`do:kubernetes:${cluster.id}`] || null,
        vpc: vpcById[cluster.vpc_uuid] || null,
        status: cluster.status?.state || '',
        tags: (cluster.tags || []).filter(tag => !tag.startsWith('k8s')),
        url: `${PANEL}/kubernetes/clusters/${cluster.id}`
      };
      if (cluster.ipv4 || cluster.endpoint) {
        addRow({
          ...base,
          ip: cluster.ipv4 || null,
          host: cluster.endpoint ? cluster.endpoint.replace(/^https?:\/\//, '') : null,
          scope: 'public',
          note: `Control plane${cluster.cluster_subnet ? ` · pods ${cluster.cluster_subnet}` : ''}${cluster.service_subnet ? ` · services ${cluster.service_subnet}` : ''}`
        });
      }
    });

    res.json({
      addresses: rows,
      vpcs: Object.values(vpcById).map(vpc => ({
        ...vpc,
        ...regionInfo(vpcs.find(v => v.id === vpc.id)?.region)
      })),
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching IP addresses:', error.response?.data || error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        message: 'Error fetching IP addresses from DigitalOcean API',
        error: error.response.data
      });
    }

    res.status(500).json({
      message: 'Error fetching IP addresses',
      error: error.message
    });
  }
});

module.exports = router;
